"""Tool execution — grep / glob / read / kb (read-only)."""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import urllib.request

import glob as _glob_mod

from . import _base as _base_module  # live PROJECT_ROOT reads after run_agent mutation
from ._base import _SHIM_PORT, _MAX_TOOL_OUTPUT


def _project_root() -> str:
    """Read PROJECT_ROOT fresh from _base so run_agent(project_root=X)
    mutations are visible inside every tool in this module."""
    return _base_module.PROJECT_ROOT


logger = logging.getLogger("HME.agent")


def _validate_path(path: str) -> str | None:
    """Validate path is under _project_root(). Returns absolute path or None."""
    if not path:
        return None
    abs_path = path if os.path.isabs(path) else os.path.join(_project_root(), path)
    abs_path = os.path.realpath(abs_path)
    if not abs_path.startswith(os.path.realpath(_project_root()) + os.sep):
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
        output = output.replace(_project_root() + "/", "")
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
        pattern = os.path.join(_project_root(), pattern)
    matches = sorted(_glob_mod.glob(pattern, recursive=True))
    # Filter to project root
    root = os.path.realpath(_project_root()) + os.sep
    matches = [m for m in matches if os.path.realpath(m).startswith(root)]
    if not matches:
        return f"No files matching '{pattern}'"
    output = "\n".join(m.replace(_project_root() + "/", "") for m in matches[:50])
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


