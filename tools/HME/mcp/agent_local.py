#!/usr/bin/env python3
"""HME local agentic research — replaces Claude subagents with Ollama + RAG + tools.

Read-only agentic loop: Ollama reasons over RAG context and can issue
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

# Model config — shared with synthesis_ollama.py when running inside MCP,
# standalone-capable when called from hooks
_ARBITER_PORT = int(os.environ.get("HME_OLLAMA_PORT_CPU", "11436"))
_ARBITER_MODEL = os.environ.get("HME_ARBITER_MODEL", "qwen3:4b")
_CODER_PORT = int(os.environ.get("HME_OLLAMA_PORT_GPU0", "11434"))
_CODER_MODEL = os.environ.get("HME_LOCAL_MODEL", "qwen3-coder:30b")
_REASONER_PORT = int(os.environ.get("HME_OLLAMA_PORT_GPU1", "11435"))
_REASONER_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3:30b-a3b")

_MAX_TOOL_OUTPUT = 3000
_ARBITER_TIMEOUT = 30
_REASONER_TIMEOUT = 180
_TOTAL_TIMEOUT = 300

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


def _strip_think(text: str) -> str:
    """Strip Qwen3 think tags."""
    if "</think>" in text:
        text = text[text.rfind("</think>") + len("</think>"):].strip()
    elif "<think>" in text:
        before = text[:text.find("<think>")].strip()
        text = before if before else ""
    return text


def _call_model(prompt: str, model: str, port: int, system: str = "",
                max_tokens: int = 4096, temperature: float = 0.3, timeout: int = 180) -> str:
    """Unified Ollama call with think-tag stripping."""
    num_ctx = 8192 if model == _ARBITER_MODEL else 16384
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "keep_alive": "10m",
        "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": num_ctx},
    }).encode()
    req = urllib.request.Request(
        f"http://localhost:{port}/api/generate",
        data=payload, headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        result = json.loads(resp.read())
    return _strip_think(result.get("response", "").strip())


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


def _exec_grep(pattern: str, path: str = "src/") -> str:
    """Execute ripgrep search — read-only."""
    target = _validate_path(path)
    if not target:
        return f"ERROR: path '{path}' is outside project root"
    try:
        result = subprocess.run(
            ["rg", "-n", "--max-count=30", "--max-columns=200", pattern, target],
            capture_output=True, text=True, timeout=10,
        )
        output = result.stdout.strip()
        if not output:
            return f"No matches for '{pattern}' in {path}"
        # Trim project root prefix for readability
        output = output.replace(PROJECT_ROOT + "/", "")
        return output[:_MAX_TOOL_OUTPUT]
    except subprocess.TimeoutExpired:
        return "ERROR: grep timed out"
    except FileNotFoundError:
        return "ERROR: ripgrep (rg) not found"


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


def _extract_search_terms(prompt: str) -> list[str]:
    """Extract key search terms from the research prompt."""
    # Remove common words and extract meaningful terms
    stop = {"the", "a", "an", "in", "of", "to", "for", "is", "are", "how", "does",
            "what", "where", "when", "which", "this", "that", "from", "with", "all",
            "key", "list", "find", "show", "get", "codebase", "polychron", "files",
            "functions", "involved", "happen", "happens", "code", "project"}
    words = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', prompt)
    terms = []
    for w in words:
        if w.lower() not in stop and len(w) > 2:
            terms.append(w)
    # Deduplicate preserving order
    seen = set()
    unique = []
    for t in terms:
        low = t.lower()
        if low not in seen:
            seen.add(low)
            unique.append(t)
    return unique[:6]


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


def run_agent(prompt: str, project_root: str = None) -> dict:
    """Two-stage local research: arbiter plans, tools execute, reasoner synthesizes."""
    global PROJECT_ROOT
    if project_root:
        PROJECT_ROOT = project_root

    t0 = time.time()
    tools_used = []
    arbiter_plan = None

    # ── Stage 1: Arbiter plans the research strategy ──
    # Fast (4b CPU, ~2-5s): extracts search terms, grep patterns, file globs
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

    # Parse arbiter's plan or fall back to keyword extraction
    search_terms = []
    grep_patterns = []
    glob_patterns = []
    directories = ["src/"]

    if arbiter_plan:
        try:
            # Extract JSON from response (may have surrounding text)
            json_match = re.search(r'\{[^{}]*\}', arbiter_plan, re.DOTALL)
            if json_match:
                plan = json.loads(json_match.group())
                search_terms = plan.get("terms", [])[:6]
                grep_patterns = plan.get("grep_patterns", [])[:6]
                glob_patterns = plan.get("glob_patterns", [])[:4]
                directories = plan.get("directories", ["src/"])[:4]
        except (json.JSONDecodeError, AttributeError):
            pass

    # Fall back to keyword extraction if arbiter didn't produce useful terms
    if not search_terms and not grep_patterns:
        search_terms = _extract_search_terms(prompt)
    if not grep_patterns:
        grep_patterns = search_terms[:4]

    # ── Stage 2: Execute tools (parallel-safe, pure I/O) ──
    sections = []

    # KB search
    kb_context = _get_rag_context(prompt)
    if kb_context:
        sections.append(f"=== Knowledge Base ===\n{kb_context}")
        tools_used.append("KB(query)")

    # Grep with arbiter-planned patterns
    grep_results = {}
    for pattern in grep_patterns[:5]:
        for directory in directories[:3]:
            result = _exec_grep(pattern, directory)
            if not result.startswith("No matches") and not result.startswith("ERROR"):
                key = f"{pattern} in {directory}"
                grep_results[key] = result
                tools_used.append(f"GREP({pattern}, {directory})")

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

    # Read key files found in grep (first 80 lines of top matches)
    files_seen = set()
    files_to_read = []
    for result in grep_results.values():
        for line in result.split("\n")[:20]:
            match = re.match(r'^([^:]+\.[a-z]+):\d+:', line)
            if match:
                fpath = match.group(1)
                if fpath not in files_seen and len(files_to_read) < 6:
                    files_seen.add(fpath)
                    files_to_read.append(fpath)

    for fpath in files_to_read:
        read_result = _exec_read(fpath, 1, 80)
        if not read_result.startswith("ERROR"):
            sections.append(f"=== {fpath} (lines 1-80) ===\n{read_result}")
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

    # ── Stage 3: Synthesize (routed: coder for code queries, reasoner for architecture) ──
    synth_prompt = f"""{research_context}

---
Question: {prompt}

Based on the search results above, provide a thorough answer. List every relevant file path and function name. Distinguish primary implementations from consumers/downstream effects."""

    try:
        answer, model_label = _call_synthesizer(
            synth_prompt,
            system="You are a code research expert. Synthesize the search results into a comprehensive answer. List exact file paths and function signatures. Be thorough and precise.",
            max_tokens=4096,
            query_prompt=prompt,
        )
        tools_used.append(f"{model_label.upper()}(synthesize)")
    except Exception as e:
        answer = f"[Synthesis failed: {e}]\n\nRaw research:\n{research_context[:3000]}"
        model_label = "failed"

    if not answer:
        answer = f"[Synthesizer produced empty output]\n\nRaw research:\n{research_context[:3000]}"
        model_label = "empty"

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
    args = parser.parse_args()

    if args.stdin:
        data = json.load(sys.stdin)
        prompt = data.get("prompt", "")
    elif args.prompt:
        prompt = args.prompt
    else:
        parser.error("--prompt or --stdin required")
        return

    result = run_agent(prompt, project_root=args.project)

    if args.json:
        print(json.dumps(result))
    else:
        print(result["answer"])
        print(f"\n---\n[{result['model']} | {result['iterations']} iterations | "
              f"{len(result['tools_used'])} tools | {result['elapsed_s']}s]")


if __name__ == "__main__":
    main()
