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
    _WORKER_PORT, _TOTAL_TIMEOUT, _MAX_TOOL_OUTPUT, PROJECT_ROOT,  # noqa: F401
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

# research.py imports US at line 234 (run_agent re-export), so a top-level
# back-import would partial-load. Lazy shims keep bare-name resolution working.
def _extract_search_terms(prompt):
    from . import research as _r; return _r._extract_search_terms(prompt)
def _MODE_CONFIGS():
    from . import research as _r; return _r._MODE_CONFIGS

logger = logging.getLogger("HME.agent")




def run_agent(prompt: str, project_root: str = None, mode: str = "explore") -> dict:
    """Local research subagent. Modes:
        explore (default): code research, read-only, matches Explore subagent
        plan: architecture-level planner, matches Plan subagent
    """
    if project_root:
        # Mutate at module level so tools.py's PROJECT_ROOT reads see the
        _base_module.PROJECT_ROOT = project_root
    _mc = _MODE_CONFIGS()
    mode_cfg = _mc.get(mode, _mc["explore"])

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
                # Union arbiter-proposed dirs with inferred dirs -- never
                # shrink the search scope below what the prompt implies
                arbiter_dirs = plan.get("directories", []) or []
                for d in arbiter_dirs[:4]:
                    if d not in directories:
                        directories.append(d)
        except (json.JSONDecodeError, AttributeError) as _plan_err:
            # Arbiter plan malformed -- we just lost its directory scope
            logger.error(f"arbiter plan parse FAILED -- search scope degraded to keyword fallback: {type(_plan_err).__name__}: {_plan_err}")

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
        sections.append(f"Knowledge Base\n{kb_context}")
        tools_used.append("KB(query)")

    # Grep with arbiter-planned patterns across inferred directories.
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
                # silent-ok: optional fallback path.
                continue
            if not result.startswith("No matches") and not result.startswith("ERROR"):
                key = f"{pattern} in {directory}"
                grep_results[key] = result
                tools_used.append(f"GREP({pattern}, {directory})")

    # Iteration: if first pass returned NOTHING, broaden to the full project
    if not grep_results and grep_patterns:
        for pattern in grep_patterns[:6]:
            result = _exec_grep(pattern, ".")
            if not result.startswith("No matches") and not result.startswith("ERROR"):
                key = f"{pattern} in ./ (broadened)"
                grep_results[key] = result
                tools_used.append(f"GREP_BROAD({pattern})")

    if grep_results:
        parts = [f" {key} \n{result}" for key, result in grep_results.items()]
        sections.append("Grep Results\n" + "\n".join(parts))

    # Glob with arbiter-planned patterns
    for pattern in glob_patterns[:4]:
        result = _exec_glob(pattern)
        if not result.startswith("No files"):
            sections.append(f"Files: {pattern}\n{result}")
            tools_used.append(f"GLOB({pattern})")

    # Also glob for search terms if arbiter didn't provide glob patterns
    if not glob_patterns:
        for term in search_terms[:3]:
            result = _exec_glob(f"src/**/*{term}*")
            if not result.startswith("No files"):
                sections.append(f"Files matching '*{term}*'\n{result}")
                tools_used.append(f"GLOB(*{term}*)")

    # Read key files found in grep. Budget varies by mode: explore=6*80, plan=12*150.
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
            sections.append(f"{fpath} (lines 1-{_file_lines})\n{read_result}")
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
            # Swap -- if we routed to reasoner, try coder (and vice versa)
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
        "model": f"{_ARBITER_MODEL} -> {model_label}({_route_model(prompt)[0]})",
    }
