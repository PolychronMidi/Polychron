#!/usr/bin/env python3
"""HME local agentic research — replaces Claude subagents with llama.cpp + RAG + tools.

Read-only agentic loop: llama.cpp reasons over RAG context and can issue
grep/glob/read/kb commands, iterating until the answer is complete.

Advantages over Claude agents:
  - RAG context injected upfront (KB entries, architectural constraints)
  - Session narrative from recent conversation
  - No context window limit (can read as many files as needed)
  - Project-specific knowledge that Claude agents lack

Safety: NO edit, write, bash, or any mutation capability. Read-only research only.

Usage:
  python3 agent_local.py --prompt "where does X happen" [--project /path]
  echo '{"prompt":"..."}' | python3 agent_local.py --stdin
"""
import glob as _glob_mod
import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

logger = logging.getLogger("HME.agent_local")

PROJECT_ROOT = os.environ.get("PROJECT_ROOT", os.environ.get("CLAUDE_PROJECT_DIR", "/home/jah/Polychron"))
_SHIM_PORT = int(os.environ.get("HME_SHIM_PORT", "7734"))

# Model config — llama-server (OpenAI /v1/chat/completions) is the only backend.
_ARBITER_MODEL = os.environ.get("HME_ARBITER_MODEL", "hme-arbiter-v6")
_CODER_MODEL = os.environ.get("HME_LOCAL_MODEL", "qwen3-coder:30b")
_REASONER_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3-coder:30b")
_LLAMACPP_ARBITER_URL = os.environ.get("HME_LLAMACPP_ARBITER_URL", "http://127.0.0.1:8080")
_LLAMACPP_CODER_URL   = os.environ.get("HME_LLAMACPP_CODER_URL",   "http://127.0.0.1:8081")
# Deprecated port constants — kept only as placeholders for _route_model's
# (model, port, label) tuple shape; not used for actual HTTP dispatch under
# llama-server (which uses base URLs, not ports).
_ARBITER_PORT  = 8080
_CODER_PORT    = 8081
_REASONER_PORT = 8081

_MAX_TOOL_OUTPUT = 8000   # was 3000 — bigger tool outputs for comprehensive audits
_ARBITER_TIMEOUT = 120    # was 30 — CPU 4b model needs more time for JSON planning
_REASONER_TIMEOUT = 240   # was 180 — larger contexts need more generation budget
_TOTAL_TIMEOUT = 420      # was 300 — matches expanded per-stage budgets

# Query type signals for model routing
_CODE_SIGNALS = {"function", "implementation", "code", "how does", "logic",
                 "algorithm", "pattern", "method", "class", "module", "import",
                 "variable", "constant", "return", "parameter", "signature"}
_REASON_SIGNALS = {"why", "design", "architecture", "relationship", "trade-off",
                   "decision", "compare", "difference", "purpose", "motivation",
                   "when should", "pros and cons", "boundary", "constraint"}


def _route_model(prompt: str) -> tuple[str, int, str]:
    """Pick coder vs reasoner based on query intent. Returns (model, port, label)."""
    words = set(prompt.lower().split())
    code_score = len(words & _CODE_SIGNALS)
    reason_score = len(words & _REASON_SIGNALS)
    if reason_score > code_score:
        return _REASONER_MODEL, _REASONER_PORT, "reasoner"
    if code_score > reason_score:
        return _CODER_MODEL, _CODER_PORT, "coder"
    # Tie or no signals — default to reasoner (broader capability)
    return _REASONER_MODEL, _REASONER_PORT, "reasoner"


def _infer_directories(prompt: str) -> list[str]:
    """Extract explicit path hints from the prompt so search scope matches
    what the user actually asked about. Without this, every query defaults
    to `src/` even when the prompt talks about `tools/HME/` or `doc/`."""
    dirs: list[str] = []
    lower = prompt.lower()
    # Direct path mentions — extract anything that looks like a / path
    for m in re.finditer(r'(?:^|[\s`])(tools/HME/\w*/?|src/\w*/?|doc/?|metrics/?|scripts/?|tmp/?|log/?)', prompt):
        p = m.group(1).rstrip("/") + "/"
        if p not in dirs:
            dirs.append(p)
    # Topical keyword → directory mapping
    if "hook" in lower or "pretooluse" in lower or "posttooluse" in lower or "sessionstart" in lower:
        if "tools/HME/hooks/" not in dirs:
            dirs.append("tools/HME/hooks/")
    if "mcp" in lower or "server" in lower or "llamacpp" in lower or "verifier" in lower or "onboard" in lower:
        if "tools/HME/mcp/" not in dirs:
            dirs.append("tools/HME/mcp/")
    if "chat" in lower or "typescript" in lower:
        if "tools/HME/chat/" not in dirs:
            dirs.append("tools/HME/chat/")
    if "skill" in lower:
        if "tools/HME/skills/" not in dirs:
            dirs.append("tools/HME/skills/")
    if "crosslayer" in lower or "cross-layer" in lower or "cross_layer" in lower:
        if "src/crossLayer/" not in dirs:
            dirs.append("src/crossLayer/")
    if "conductor" in lower or "signal" in lower or "coupling" in lower or "hypermeta" in lower:
        if "src/conductor/" not in dirs:
            dirs.append("src/conductor/")
    if "stutter" in lower or "fx" in lower:
        if "src/fx/" not in dirs:
            dirs.append("src/fx/")
    if "rhythm" in lower or "beat" in lower:
        if "src/rhythm/" not in dirs:
            dirs.append("src/rhythm/")
    if "doc" in lower or "readme" in lower or "claude.md" in lower:
        if "doc/" not in dirs:
            dirs.append("doc/")
    if "metrics" in lower or "journal" in lower:
        if "metrics/" not in dirs:
            dirs.append("metrics/")
    # Default fallback: if nothing matched, search src AND tools/HME so we
    # never accidentally scope away the audit target
    if not dirs:
        dirs = ["src/", "tools/HME/"]
    return dirs[:6]


def _strip_think(text: str) -> str:
    """Strip Qwen3 think tags."""
    if "</think>" in text:
        text = text[text.rfind("</think>") + len("</think>"):].strip()
    elif "<think>" in text:
        before = text[:text.find("<think>")].strip()
        text = before if before else ""
    return _dedup_output(text)


def _dedup_output(text: str, max_repeats: int = 2) -> str:
    """Detect and truncate consecutive repetition loops in model output.

    Only removes lines that repeat consecutively — scattered mentions of the
    same string are kept. Fixes runaway loops (550 identical lines) without
    stripping legitimate repeated references.
    """
    lines = text.split("\n")
    if len(lines) < 6:
        return text
    kept = []
    truncated = 0
    run_line: str | None = None
    run_count = 0
    for line in lines:
        stripped = line.strip()
        if stripped == run_line:
            run_count += 1
        else:
            run_line = stripped
            run_count = 1
        if run_count <= max_repeats:
            kept.append(line)
        else:
            truncated += 1
    if truncated > 0:
        kept.append(f"\n[{truncated} repetitive lines removed]")
    return "\n".join(kept)


def _llamacpp_base_for(model: str) -> str:
    """Pick the right llama-server URL for a given model name."""
    if model == _ARBITER_MODEL:
        return _LLAMACPP_ARBITER_URL
    return _LLAMACPP_CODER_URL


def _call_model(prompt: str, model: str, port: int, system: str = "",
                max_tokens: int = 4096, temperature: float = 0.3, timeout: int = 180) -> str:
    """Unified model call with think-tag stripping.
    All dispatch uses llama-server /v1/chat/completions. The `port` argument
    is retained for legacy tuple shape but ignored — routing is by model name.
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "cache_prompt": True,
    }).encode()
    url = f"{_llamacpp_base_for(model)}/v1/chat/completions"
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    choices = data.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    text = (msg.get("content", "") or "").strip() if isinstance(msg, dict) else ""
    return _strip_think(text)


def _call_arbiter(prompt: str, system: str = "", max_tokens: int = 1024) -> str:
    return _call_model(prompt, _ARBITER_MODEL, _ARBITER_PORT,
                       system=system, max_tokens=max_tokens, temperature=0.0,
                       timeout=_ARBITER_TIMEOUT)


def _call_synthesizer(prompt: str, system: str = "", max_tokens: int = 4096,
                      query_prompt: str = "") -> tuple[str, str]:
    """Call the best model for this query. Returns (response, model_label)."""
    model, port, label = _route_model(query_prompt or prompt)
    response = _call_model(prompt, model, port, system=system,
                           max_tokens=max_tokens, timeout=_REASONER_TIMEOUT)
    return response, label


def _get_rag_context(query: str) -> str:
    """Get RAG context from HME shim — KB entries + code search."""
    parts = []
    # KB search
    try:
        payload = json.dumps({"engine": "project", "method": "search_knowledge",
                              "kwargs": {"query": query, "top_k": 6}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{_SHIM_PORT}/rag",
                                    data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            kb = json.loads(resp.read()).get("result", [])
        if kb:
            parts.append("=== Knowledge Base ===")
            for r in kb[:6]:
                title = r.get("title", "")
                content = r.get("content", "")[:300]
                parts.append(f"- {title}: {content}")
    except Exception:
        pass
    # Code search
    try:
        payload = json.dumps({"engine": "project", "method": "search",
                              "kwargs": {"query": query, "top_k": 5}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{_SHIM_PORT}/rag",
                                    data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            code = json.loads(resp.read()).get("result", [])
        if code:
            parts.append("\n=== Relevant Code Chunks ===")
            for r in code[:5]:
                meta = r.get("metadata", {})
                path = meta.get("path", r.get("path", "?"))
                text = r.get("text", r.get("chunk", ""))[:200]
                if path != "?":
                    parts.append(f"- {path}: {text}")
    except Exception:
        pass
    return "\n".join(parts) if parts else ""


def _validate_path(path: str) -> str | None:
    """Validate path is under PROJECT_ROOT. Returns absolute path or None."""
    if not path:
        return None
    abs_path = path if os.path.isabs(path) else os.path.join(PROJECT_ROOT, path)
    abs_path = os.path.realpath(abs_path)
    if not abs_path.startswith(os.path.realpath(PROJECT_ROOT) + os.sep):
        return None
    return abs_path


_GREP_BIN: str | None = None  # cached resolved binary


def _resolve_grep() -> str | None:
    """Find an available grep binary — prefer ripgrep, fall back to GNU grep.
    Cached after first resolution so we don't re-probe on every call."""
    global _GREP_BIN
    if _GREP_BIN is not None:
        return _GREP_BIN or None
    for candidate in ("rg", "grep"):
        try:
            subprocess.run([candidate, "--version"], capture_output=True, timeout=2)
            _GREP_BIN = candidate
            logger.info(f"agent_local: grep backend resolved to '{candidate}'")
            return _GREP_BIN
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    _GREP_BIN = ""  # sentinel: probed and failed
    return None


def _exec_grep(pattern: str, path: str = "src/") -> str:
    """Execute grep search — read-only. Uses ripgrep if available, falls
    back to GNU grep. Both produce comparable output for the common case."""
    target = _validate_path(path)
    if not target:
        return f"ERROR: path '{path}' is outside project root"
    binary = _resolve_grep()
    if binary is None:
        return "ERROR: no grep backend available (tried rg, grep)"
    try:
        if binary == "rg":
            cmd = ["rg", "-n", "--max-count=30", "--max-columns=200", pattern, target]
        else:
            # GNU grep: -r recursive, -n line numbers, --include for source files,
            # --max-count limits per file. Some output formatting differs but the
            # path:line:content shape that downstream parsing expects is preserved.
            cmd = [
                "grep", "-rn", "--max-count=30",
                "--include=*.js", "--include=*.py", "--include=*.sh",
                "--include=*.ts", "--include=*.md", "--include=*.json",
                "--exclude-dir=node_modules", "--exclude-dir=.git",
                "--exclude-dir=__pycache__", "--exclude-dir=tmp",
                pattern, target,
            ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        output = result.stdout.strip()
        if not output:
            return f"No matches for '{pattern}' in {path}"
        # Trim project root prefix for readability
        output = output.replace(PROJECT_ROOT + "/", "")
        # GNU grep lines may be very long — cap each line at 200 chars so the
        # synthesizer doesn't choke on a single huge minified blob.
        capped = []
        for ln in output.split("\n"):
            if len(ln) > 220:
                capped.append(ln[:220] + " ...[truncated]")
            else:
                capped.append(ln)
        return "\n".join(capped)[:_MAX_TOOL_OUTPUT]
    except subprocess.TimeoutExpired:
        return "ERROR: grep timed out"
    except FileNotFoundError:
        return "ERROR: grep backend disappeared"


def _exec_glob(pattern: str) -> str:
    """Execute glob search — read-only."""
    if not pattern.startswith("/"):
        pattern = os.path.join(PROJECT_ROOT, pattern)
    matches = sorted(_glob_mod.glob(pattern, recursive=True))
    # Filter to project root
    root = os.path.realpath(PROJECT_ROOT) + os.sep
    matches = [m for m in matches if os.path.realpath(m).startswith(root)]
    if not matches:
        return f"No files matching '{pattern}'"
    output = "\n".join(m.replace(PROJECT_ROOT + "/", "") for m in matches[:50])
    return output[:_MAX_TOOL_OUTPUT]


def _exec_read(filepath: str, start: int = 0, end: int = 0) -> str:
    """Read file contents — read-only."""
    abs_path = _validate_path(filepath)
    if not abs_path:
        return f"ERROR: path '{filepath}' is outside project root"
    if not os.path.exists(abs_path):
        return f"ERROR: file not found: {filepath}"
    try:
        with open(abs_path) as f:
            lines = f.readlines()
        if start > 0 or end > 0:
            start = max(0, start - 1)  # 1-indexed to 0-indexed
            end = end if end > 0 else len(lines)
            lines = lines[start:end]
        else:
            lines = lines[:100]  # default: first 100 lines
        output = "".join(f"{i+max(start,0)+1:4d}  {line}" for i, line in enumerate(lines))
        return output[:_MAX_TOOL_OUTPUT]
    except Exception as e:
        return f"ERROR reading {filepath}: {e}"


def _exec_kb(query: str) -> str:
    """Search project knowledge base."""
    try:
        payload = json.dumps({"engine": "project", "method": "search_knowledge",
                              "kwargs": {"query": query, "top_k": 8}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{_SHIM_PORT}/rag",
                                    data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            results = json.loads(resp.read()).get("result", [])
        if not results:
            return f"No KB entries for '{query}'"
        parts = []
        for r in results:
            title = r.get("title", "")
            content = r.get("content", "")[:250]
            cat = r.get("category", "")
            parts.append(f"[{cat}] {title}: {content}")
        return "\n".join(parts)[:_MAX_TOOL_OUTPUT]
    except Exception as e:
        return f"KB search failed: {e}"


def _parse_tool_calls(text: str) -> list[dict]:
    """Parse >>> TOOL arg1 arg2 lines from model output."""
    calls = []
    for line in text.split("\n"):
        line = line.strip()
        if not line.startswith(">>>"):
            continue
        line = line[3:].strip()
        if line.upper().startswith("ANSWER"):
            calls.append({"tool": "ANSWER", "args": []})
            continue
        parts = line.split(None, 1)
        if not parts:
            continue
        tool = parts[0].upper()
        raw_args = parts[1] if len(parts) > 1 else ""
        # Parse args: respect quoted strings
        args = []
        if raw_args:
            # Simple quote-aware split
            in_quote = False
            current = []
            for ch in raw_args:
                if ch == '"' and not in_quote:
                    in_quote = True
                elif ch == '"' and in_quote:
                    in_quote = False
                elif ch == ' ' and not in_quote and current:
                    args.append("".join(current))
                    current = []
                else:
                    current.append(ch)
            if current:
                args.append("".join(current))
        calls.append({"tool": tool, "args": args})
    return calls


def _execute_tool(call: dict) -> str | None:
    """Execute a single tool call. Returns result string or None for ANSWER."""
    tool = call["tool"]
    args = call["args"]
    if tool == "ANSWER":
        return None
    elif tool == "GREP":
        pattern = args[0] if args else ""
        path = args[1] if len(args) > 1 else "src/"
        return _exec_grep(pattern, path)
    elif tool == "GLOB":
        pattern = args[0] if args else ""
        return _exec_glob(pattern)
    elif tool == "READ":
        filepath = args[0] if args else ""
        start = int(args[1]) if len(args) > 1 and args[1].isdigit() else 0
        end = int(args[2]) if len(args) > 2 and args[2].isdigit() else 0
        return _exec_read(filepath, start, end)
    elif tool == "KB":
        query = " ".join(args) if args else ""
        return _exec_kb(query)
    else:
        return f"Unknown tool: {tool}. Available: GREP, GLOB, READ, KB"


_LEARNED_STOPWORDS: set = set()


def _load_learned_stopwords() -> None:
    """H7: load stopwords mined from prompt history.
    Augments the hardcoded list without replacing it."""
    global _LEARNED_STOPWORDS
    path = os.path.join(PROJECT_ROOT, "metrics", "hme-learned-stopwords.json")
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
    stopwords from metrics/hme-learned-stopwords.json (H7 — prompt-history-
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
            parts.append(f"--- grep '{term}' ---\n{result}")
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
    global PROJECT_ROOT
    if project_root:
        PROJECT_ROOT = project_root
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

    # ── Stage 1: Arbiter plans the research strategy ──
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
        except (json.JSONDecodeError, AttributeError):
            pass

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

    # ── Stage 2: Execute tools (parallel-safe, pure I/O) ──
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
        parts = [f"--- {key} ---\n{result}" for key, result in grep_results.items()]
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

    # ── Stage 3: Synthesize. System prompt + instructions vary by mode.
    synth_prompt = f"""{research_context}

---
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


def main():
    import argparse
    parser = argparse.ArgumentParser(description="HME local agentic research")
    parser.add_argument("--prompt", help="Research prompt")
    parser.add_argument("--stdin", action="store_true", help="Read JSON from stdin")
    parser.add_argument("--project", default=PROJECT_ROOT, help="Project root")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument(
        "--mode", default="explore", choices=list(_MODE_CONFIGS.keys()),
        help="Subagent mode: explore (code research), plan (architecture plan)",
    )
    args = parser.parse_args()

    if args.stdin:
        data = json.load(sys.stdin)
        prompt = data.get("prompt", "")
        mode = data.get("mode", args.mode)
    elif args.prompt:
        prompt = args.prompt
        mode = args.mode
    else:
        parser.error("--prompt or --stdin required")
        return

    result = run_agent(prompt, project_root=args.project, mode=mode)
    result["mode"] = mode

    if args.json:
        print(json.dumps(result))
    else:
        print(result["answer"])
        print(f"\n---\n[mode={mode} | {result['model']} | {result['iterations']} iterations | "
              f"{len(result['tools_used'])} tools | {result['elapsed_s']}s]")


if __name__ == "__main__":
    main()
