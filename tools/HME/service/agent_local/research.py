"""Research loop: stop-word learning, pre-research, main run_agent orchestrator."""
from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.request

from . import _base as _base_module  # for live PROJECT_ROOT reads after mutation
from ._base import (
    _SHIM_PORT, _TOTAL_TIMEOUT, _MAX_TOOL_OUTPUT, PROJECT_ROOT,  # noqa: F401
    _ARBITER_MODEL, _CODER_MODEL, _REASONER_MODEL,
    _ARBITER_PORT, _CODER_PORT, _REASONER_PORT,
    _ARBITER_TIMEOUT, _REASONER_TIMEOUT,
)
from .models import (
    _route_model, _infer_directories, _call_model, _call_arbiter,
    _call_synthesizer, _get_rag_context, _strip_think, _dedup_output,
)
from .tools import (
    _parse_tool_calls, _execute_tool, _exec_grep, _exec_glob, _exec_read,
)

logger = logging.getLogger("HME.agent")


def _load_learned_stopwords() -> None:
    """H7: load stopwords mined from prompt history.
    Augments the hardcoded list without replacing it."""
    global _LEARNED_STOPWORDS
    path = os.path.join(PROJECT_ROOT, "tools", "models", "training", "hme-learned-stopwords.json")
    if not os.path.isfile(path):
        return
    try:
        with open(path) as f:
            data = json.load(f)
        _LEARNED_STOPWORDS = set(data.get("candidates", []))
    except Exception:
        _LEARNED_STOPWORDS = set()


_load_learned_stopwords()


def _extract_search_terms(prompt: str) -> list[str]:
    """Extract key search terms from the research prompt.

    Aggressive stopword list eliminates conversational scaffolding so only
    meaningful identifiers, keywords, and domain terms survive as search
    targets. Prioritizes: snake_case / camelCase identifiers > PascalCase
    > plain words. Identifiers are strong signals; words are noise.

    The hardcoded stopword set is augmented at load time by learned
    stopwords from tools/models/training/hme-learned-stopwords.json (H7 — prompt-history-
    driven stopword tuning). To refresh: run learn-stopwords.py.
    """
    stop = {
        # Articles / prepositions
        "the", "a", "an", "in", "of", "to", "for", "from", "with", "on", "at",
        "by", "into", "onto", "via", "as", "this", "that", "these", "those",
        "and", "or", "but", "nor", "if", "then", "else", "than",
        # Question words
        "how", "what", "where", "when", "which", "who", "whom", "why",
        "does", "do", "did", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "can", "could", "should", "would", "will", "may",
        # Imperatives / conversational fillers
        "list", "find", "show", "get", "tell", "give", "provide", "explain",
        "describe", "detail", "identify", "locate", "search", "look", "check",
        "count", "verify", "confirm", "plan", "design", "implement",
        # Meta / project-wide
        "codebase", "polychron", "project", "code", "file", "files", "function",
        "functions", "module", "modules", "system", "systems", "all", "every",
        "any", "some", "many", "most",
        # Domain conversational
        "actively", "used", "using", "uses", "source", "sources", "reference",
        "references", "consumer", "consumers", "defined", "implementation",
        "implementations", "purpose", "role", "happen", "happens", "happened",
        "involved", "key", "says", "said", "mentions", "mentioned", "claim",
        "claims", "state", "states", "stated",
        # Pronouns / adverbs / connectors
        "it", "its", "they", "them", "their", "we", "us", "our", "you", "your",
        "he", "she", "his", "her", "him", "me", "my", "mine",
        "also", "only", "just", "even", "still", "well", "here", "there",
        "much", "more", "less", "very", "such", "each", "other", "another",
    }
    # Merge hardcoded stop set with learned stopwords (H7)
    stop = stop | _LEARNED_STOPWORDS
    # First pass: preserve identifiers (snake_case, camelCase, has _ or mixed case)
    identifiers = []
    plain_words = []
    for w in re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', prompt):
        if w.lower() in stop or len(w) <= 2:
            continue
        if "_" in w or re.search(r'[a-z][A-Z]|[A-Z][a-z]', w):
            identifiers.append(w)
        else:
            plain_words.append(w)
    # Identifiers first, then plain words (prioritizes real symbols)
    combined = identifiers + plain_words
    # Deduplicate preserving order
    seen = set()
    unique = []
    for t in combined:
        low = t.lower()
        if low not in seen:
            seen.add(low)
            unique.append(t)
    return unique[:8]  # cap 8 instead of 6 — more signal when arbiter skipped


def _pre_research(prompt: str) -> tuple[str, list[str]]:
    """Pre-compute research results: KB + grep + glob + file reads."""
    tools_used = []
    sections = []

    terms = _extract_search_terms(prompt)

    # Phase 1: KB search
    kb_context = _get_rag_context(prompt)
    if kb_context:
        sections.append(f"=== Knowledge Base Results ===\n{kb_context}")
        tools_used.append("KB(query)")

    # Phase 2: Grep for each search term
    grep_results = {}
    for term in terms[:4]:
        result = _exec_grep(term, "src/")
        if not result.startswith("No matches"):
            grep_results[term] = result
            tools_used.append(f"GREP({term}, src/)")
        # Also search tools/HME for infrastructure queries
        if any(w in prompt.lower() for w in ["hme", "hook", "mcp", "server", "shim", "proxy"]):
            result2 = _exec_grep(term, "tools/HME/")
            if not result2.startswith("No matches"):
                grep_results[f"{term}(HME)"] = result2
                tools_used.append(f"GREP({term}, tools/HME/)")

    if grep_results:
        parts = []
        for term, result in grep_results.items():
            parts.append(f" grep '{term}' \n{result}")
        sections.append(f"=== Grep Results ===\n" + "\n".join(parts))

    # Phase 3: Glob for related files
    for term in terms[:3]:
        glob_result = _exec_glob(f"src/**/*{term}*")
        if not glob_result.startswith("No files"):
            sections.append(f"=== Files matching '*{term}*' ===\n{glob_result}")
            tools_used.append(f"GLOB(*{term}*)")

    # Phase 4: Read key files found in grep (first 80 lines of top matches)
    files_seen = set()
    files_to_read = []
    for result in grep_results.values():
        for line in result.split("\n")[:20]:
            # Extract file path from grep output (format: path:line:content)
            match = re.match(r'^([^:]+\.[a-z]+):\d+:', line)
            if match:
                fpath = match.group(1)
                if fpath not in files_seen and len(files_to_read) < 5:
                    files_seen.add(fpath)
                    files_to_read.append(fpath)

    for fpath in files_to_read:
        read_result = _exec_read(fpath, 1, 80)
        if not read_result.startswith("ERROR"):
            sections.append(f"=== {fpath} (lines 1-80) ===\n{read_result}")
            tools_used.append(f"READ({fpath})")

    return "\n\n".join(sections), tools_used


_MODE_CONFIGS = {
    # explore: code research (existing behavior, default)
    "explore": {
        "system": (
            "You are a code research expert. Synthesize the search results into a comprehensive answer. "
            "Critical rule: GREP RESULTS ARE GROUND TRUTH. Knowledge Base entries are metadata and may be "
            "incomplete — never say 'no info' just because the KB is silent if there are grep results. "
            "Always cite exact file paths and line numbers from grep matches. Count matches when asked."
        ),
        "synth_suffix": (
            "INSTRUCTIONS:\n"
            "- Answer the question using the search results above.\n"
            "- 'Grep Results' are LITERAL file:line:content — ground truth.\n"
            "- 'Knowledge Base' entries are metadata, may be incomplete. KB silence means 'unknown', NOT 'absent'.\n"
            "- Cite every relevant file, line number, and function. Count matches when asked.\n"
        ),
        "max_files": 6,
        "file_lines": 80,
        # Fast mode: skip arbiter (10-30s saved) and use keyword extraction
        # + directory inference as the planning substitute. Arbiter JSON
        # planning is mostly redundant with the improved _extract_search_terms
        # + _infer_directories and the CPU 4b model is slow.
        "skip_arbiter": True,
    },
    # plan: architecture-level implementation planner
    "plan": {
        "system": (
            "You are a software architect creating implementation plans. Produce a STEP-BY-STEP plan with: "
            "(1) numbered implementation steps in execution order, "
            "(2) critical files that will be touched (exact paths from grep results), "
            "(3) architectural tradeoffs and risks, "
            "(4) verification criteria (how will we know this worked). "
            "Do NOT write code. Propose the plan; the human will implement. "
            "GREP RESULTS are ground truth — every file path you mention must come from the search results."
        ),
        "synth_suffix": (
            "INSTRUCTIONS — PLANNING MODE:\n"
            "Produce a structured implementation plan:\n"
            "## Summary\n"
            "1-3 sentences describing the proposed change\n\n"
            "## Critical files (quote exact paths from grep results)\n"
            "Bulleted list with file:line where each change lands\n\n"
            "## Implementation steps\n"
            "Numbered steps in execution order. Each step: what + where + why\n\n"
            "## Architectural tradeoffs\n"
            "What this approach costs. What alternatives were considered. Why this one.\n\n"
            "## Risks\n"
            "What could go wrong. How to detect it.\n\n"
            "## Verification\n"
            "How we know it worked. Specific tests/checks.\n"
        ),
        "max_files": 12,       # read more files for planning
        "file_lines": 150,     # deeper reads
    },
}


def run_agent(prompt: str, project_root: str = None, mode: str = "explore") -> dict:
    """Local research subagent. Modes:
        explore (default): code research, read-only, matches Explore subagent
        plan: architecture-level planner, matches Plan subagent
    """
    if project_root:
        # Mutate at module level so tools.py's PROJECT_ROOT reads see the
        # updated value. Direct rebinding of the local `PROJECT_ROOT` name
        # imported from _base wouldn't propagate across submodules.
        _base_module.PROJECT_ROOT = project_root
    mode_cfg = _MODE_CONFIGS.get(mode, _MODE_CONFIGS["explore"])

    # Guard: trivially short/empty prompts cannot produce useful research.
    # Early-exit so we don't waste 120s on an arbiter call that can't succeed.
    stripped = (prompt or "").strip()
    if len(stripped) < 3 or len(stripped.split()) < 2:
        return {
            "answer": (
                "[agent declined: prompt too short to research]\n\n"
                f"Received: {stripped!r}\n\n"
                "Provide a question with at least 2 words so the research planner "
                "can extract search terms."
            ),
            "iterations": 0,
            "tools_used": ["guard(short_prompt)"],
            "elapsed_s": 0.0,
            "model": "guard",
            "mode": mode,
        }

    t0 = time.time()
    tools_used = []
    arbiter_plan = None

    # Stage 1: Arbiter plans the research strategy
    # The CPU 4b model takes 10-60s on amateur hardware. For most queries,
    # _extract_search_terms + _infer_directories produces an equivalent plan
    # in 0ms. The arbiter is only genuinely useful for Plan mode where
    # architectural disambiguation matters. Skip it when the mode says so.
    skip_arbiter = mode_cfg.get("skip_arbiter", False)
    if not skip_arbiter:
        try:
            arbiter_plan = _call_arbiter(
                prompt,
                system=("You are a research planner. Given a question about a JavaScript/Python codebase, "
                        "output a JSON research plan. Format:\n"
                        '{"terms": ["term1", "term2"], '
                        '"grep_patterns": ["pattern1"], '
                        '"glob_patterns": ["src/**/*pattern*"], '
                        '"directories": ["src/crossLayer/", "src/conductor/"]}\n'
                        "Output ONLY valid JSON, nothing else."),
                max_tokens=512,
            )
            tools_used.append("ARBITER(plan)")
        except Exception as e:
            logger.warning(f"Arbiter failed ({e}), falling back to keyword extraction")
    else:
        tools_used.append("ARBITER(skipped:fast_path)")

    # Parse arbiter's plan or fall back to keyword extraction
    search_terms = []
    grep_patterns = []
    glob_patterns = []
    # Always include directories inferred from the prompt as a baseline,
    # then let the arbiter ADD to that set. Prevents the "arbiter failed →
    # default to src/ only" failure mode where audits targeting tools/HME/
    # silently search the wrong place.
    inferred_dirs = _infer_directories(prompt)
    directories = list(inferred_dirs)

    if arbiter_plan:
        try:
            # Extract JSON from response (may have surrounding text)
            json_match = re.search(r'\{[^{}]*\}', arbiter_plan, re.DOTALL)
            if json_match:
                plan = json.loads(json_match.group())
                search_terms = plan.get("terms", [])[:6]
                grep_patterns = plan.get("grep_patterns", [])[:6]
                glob_patterns = plan.get("glob_patterns", [])[:4]
                # Union arbiter-proposed dirs with inferred dirs — never
                # shrink the search scope below what the prompt implies
                arbiter_dirs = plan.get("directories", []) or []
                for d in arbiter_dirs[:4]:
                    if d not in directories:
                        directories.append(d)
        except (json.JSONDecodeError, AttributeError) as _plan_err:
            # Arbiter plan malformed — we just lost its directory scope
            # hints and will search the fallback set instead, which is
            # often the wrong directories for the query. This is a real
            # arbiter regression signal, not a benign miss.
            logger.error(f"arbiter plan parse FAILED — search scope degraded to keyword fallback: {type(_plan_err).__name__}: {_plan_err}")

    # Fall back to keyword extraction if arbiter didn't produce useful terms
    if not search_terms and not grep_patterns:
        search_terms = _extract_search_terms(prompt)
    if not grep_patterns:
        grep_patterns = search_terms[:4]
    # Also use explicit symbol/path names from the prompt as grep patterns
    for sym_match in re.finditer(r'`([^`]+)`|\b([_a-zA-Z][\w.]*\.\w+)\b', prompt):
        sym = sym_match.group(1) or sym_match.group(2)
        if sym and len(sym) >= 4 and sym not in grep_patterns:
            grep_patterns.append(sym)
    grep_patterns = grep_patterns[:8]  # cap

    # Stage 2: Execute tools (parallel-safe, pure I/O)
    sections = []

    # KB search
    kb_context = _get_rag_context(prompt)
    if kb_context:
        sections.append(f"=== Knowledge Base ===\n{kb_context}")
        tools_used.append("KB(query)")

    # Grep with arbiter-planned patterns across inferred directories.
    # Parallel: 6 patterns × 4 directories = 24 possible greps. I/O bound,
    # thread-safe (subprocess), safe to parallelize. Typical saving: 5-10s
    # per query on warm cache. ThreadPoolExecutor bounds at 8 concurrent so
    # we don't blow out file descriptors.
    from concurrent.futures import ThreadPoolExecutor
    grep_tasks = []
    for pattern in grep_patterns[:6]:
        for directory in directories[:4]:
            grep_tasks.append((pattern, directory))
    grep_results = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            pool.submit(_exec_grep, p, d): (p, d) for p, d in grep_tasks
        }
        for fut in futures:
            pattern, directory = futures[fut]
            try:
                result = fut.result(timeout=15)
            except Exception:
                continue
            if not result.startswith("No matches") and not result.startswith("ERROR"):
                key = f"{pattern} in {directory}"
                grep_results[key] = result
                tools_used.append(f"GREP({pattern}, {directory})")

    # Iteration: if first pass returned NOTHING, broaden to the full project
    # root and retry with the original patterns. Many audit questions target
    # paths outside src/, and this second pass catches them even if the
    # inferred-directories heuristic missed them.
    if not grep_results and grep_patterns:
        for pattern in grep_patterns[:6]:
            result = _exec_grep(pattern, ".")
            if not result.startswith("No matches") and not result.startswith("ERROR"):
                key = f"{pattern} in ./ (broadened)"
                grep_results[key] = result
                tools_used.append(f"GREP_BROAD({pattern})")

    if grep_results:
        parts = [f" {key} \n{result}" for key, result in grep_results.items()]
        sections.append("=== Grep Results ===\n" + "\n".join(parts))

    # Glob with arbiter-planned patterns
    for pattern in glob_patterns[:4]:
        result = _exec_glob(pattern)
        if not result.startswith("No files"):
            sections.append(f"=== Files: {pattern} ===\n{result}")
            tools_used.append(f"GLOB({pattern})")

    # Also glob for search terms if arbiter didn't provide glob patterns
    if not glob_patterns:
        for term in search_terms[:3]:
            result = _exec_glob(f"src/**/*{term}*")
            if not result.startswith("No files"):
                sections.append(f"=== Files matching '*{term}*' ===\n{result}")
                tools_used.append(f"GLOB(*{term}*)")

    # Read key files found in grep. Budget varies by mode: explore=6×80, plan=12×150.
    _max_files = mode_cfg.get("max_files", 6)
    _file_lines = mode_cfg.get("file_lines", 80)
    files_seen = set()
    files_to_read = []
    for result in grep_results.values():
        for line in result.split("\n")[:20]:
            match = re.match(r'^([^:]+\.[a-z]+):\d+:', line)
            if match:
                fpath = match.group(1)
                if fpath not in files_seen and len(files_to_read) < _max_files:
                    files_seen.add(fpath)
                    files_to_read.append(fpath)

    for fpath in files_to_read:
        read_result = _exec_read(fpath, 1, _file_lines)
        if not read_result.startswith("ERROR"):
            sections.append(f"=== {fpath} (lines 1-{_file_lines}) ===\n{read_result}")
            tools_used.append(f"READ({fpath})")

    research_context = "\n\n".join(sections)

    if not research_context:
        return {
            "answer": "[No results found for this query]",
            "iterations": 0,
            "tools_used": tools_used,
            "elapsed_s": round(time.time() - t0, 1),
            "model": f"{_ARBITER_MODEL} + {_REASONER_MODEL}",
        }

    # Stage 3: Synthesize. System prompt + instructions vary by mode.
    synth_prompt = f"""{research_context}


Question: {prompt}

{mode_cfg["synth_suffix"]}"""

    try:
        answer, model_label = _call_synthesizer(
            synth_prompt,
            system=mode_cfg["system"],
            max_tokens=4096 if mode == "explore" else 6144,  # plans need more tokens
            query_prompt=prompt,
        )
        tools_used.append(f"{model_label.upper()}(synthesize)")
    except Exception as e:
        answer = ""
        model_label = "failed"
        logger.warning(f"Primary synthesizer failed: {e}")

    # Fallback 1: swap models if the primary synthesizer returned empty
    if not answer or not answer.strip():
        try:
            # Swap — if we routed to reasoner, try coder (and vice versa)
            primary_model, _port, primary_label = _route_model(prompt)
            if primary_label == "reasoner":
                fallback_model, fallback_port, fallback_label = (_CODER_MODEL, _CODER_PORT, "coder")
            else:
                fallback_model, fallback_port, fallback_label = (_REASONER_MODEL, _REASONER_PORT, "reasoner")
            fallback_answer = _call_model(
                synth_prompt, fallback_model, fallback_port,
                system="You are a code research expert. Synthesize the search results into a thorough answer with exact file paths.",
                max_tokens=4096, timeout=_REASONER_TIMEOUT,
            )
            if fallback_answer and fallback_answer.strip():
                answer = fallback_answer
                model_label = f"{fallback_label}(fallback)"
                tools_used.append(f"FALLBACK({fallback_label})")
        except Exception as e:
            logger.warning(f"Fallback synthesizer failed: {e}")

    # Fallback 2: if BOTH models returned empty, produce an extractive
    # summary from the raw research. Better than admitting defeat.
    if not answer or not answer.strip():
        extractive_parts = [
            "[Both synthesizer models produced empty output. Extractive summary of raw research:]",
            "",
        ]
        # List every file mentioned in grep/read results
        mentioned_files = set()
        for line in research_context.split("\n"):
            for fm in re.finditer(r'([a-zA-Z0-9_/.-]+\.(?:js|py|sh|md|json|ts))', line):
                mentioned_files.add(fm.group(1))
        if mentioned_files:
            extractive_parts.append(f"Files referenced in search results ({len(mentioned_files)}):")
            for f in sorted(mentioned_files)[:30]:
                extractive_parts.append(f"  - {f}")
            extractive_parts.append("")
        extractive_parts.append("Raw research:")
        extractive_parts.append(research_context[:6000])
        answer = "\n".join(extractive_parts)
        model_label = "extractive"

    elapsed = time.time() - t0

    return {
        "answer": answer,
        "iterations": 1,
        "tools_used": tools_used,
        "elapsed_s": round(elapsed, 1),
        "model": f"{_ARBITER_MODEL} → {model_label}({_route_model(prompt)[0]})",
    }


