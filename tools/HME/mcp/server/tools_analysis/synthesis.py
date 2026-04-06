"""HME synthesis engine — Claude API + Ollama local model."""
import json
import os
import re
import time
import logging
import threading

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, BUDGET_LIMITS
from symbols import find_callers as _find_callers
from lang_registry import ext_to_lang

logger = logging.getLogger("HME")

def _get_api_key() -> str:
    """Return Anthropic API key from env or common key file locations."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    for key_path in [
        os.path.expanduser("~/.anthropic/api_key"),
        os.path.expanduser("~/.config/anthropic/key"),
    ]:
        try:
            with open(key_path) as _f:
                key = _f.read().strip()
            if key:
                return key
        except Exception:
            pass
    return ""


_THINK_MODEL = os.environ.get("RAG_THINK_MODEL", "claude-sonnet-4-6")
# Deep reasoning model — used by think tool and causal_trace where Opus pays off
_DEEP_MODEL = os.environ.get("HME_DEEP_MODEL", "claude-opus-4-6")


def _build_think_system() -> str:
    project_name = os.path.basename(os.path.realpath(ctx.PROJECT_ROOT)) if ctx.PROJECT_ROOT else "project"
    return (
        f"You are a code-review assistant for the '{project_name}' codebase. "
        "You have deep knowledge of its architecture and conventions from the KB provided. "
        "Provide concise, actionable analysis grounded in the KB context. "
        "Focus on architectural boundaries, potential breakage, and concrete next steps. "
        "Be direct — no preamble, no trailing summaries."
    )


_THINK_SYSTEM = _build_think_system()


_BUDGET_TOKENS = {"greedy": 4096, "moderate": 2048, "conservative": 1024, "minimal": 256}


_BUDGET_EFFORT = {"greedy": "high", "moderate": "medium", "conservative": "low", "minimal": "low"}


_BUDGET_TOOL_CALLS = {"greedy": 12, "moderate": 6, "conservative": 3, "minimal": 0}


_SYNTHESIS_TOOLS = [
    {
        "name": "search_code",
        "description": "Semantic search for code by intent. Use to find implementations, call sites, or related patterns.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Natural language description of what to find"},
                "path": {"type": "string", "description": "Optional directory filter (e.g. 'src/crossLayer')"},
                "top_k": {"type": "integer", "description": "Number of results (default 5)", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_knowledge",
        "description": "Query the knowledge base for constraints, decisions, anti-patterns, and bugfixes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "top_k": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "find_callers",
        "description": "Find all files that call or reference a symbol by name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Symbol name to find callers of"},
                "path": {"type": "string", "description": "Optional directory filter"},
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "file_lines",
        "description": "Read a range of lines from a source file.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "start": {"type": "integer", "default": 1},
                "end": {"type": "integer", "description": "Last line to read (0 = EOF)", "default": 0},
            },
            "required": ["file_path"],
        },
    },
    {
        "name": "lookup_symbol",
        "description": "Find where a symbol is defined. Returns file, line, kind, and signature.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "kind": {"type": "string", "description": "Optional: 'global', 'function', 'class'", "default": ""},
            },
            "required": ["name"],
        },
    },
    {
        "name": "get_function_body",
        "description": "Extract the complete source of a named function with line numbers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "function_name": {"type": "string"},
                "file_path": {"type": "string", "description": "Optional file path to narrow search", "default": ""},
            },
            "required": ["function_name"],
        },
    },
]


def _get_max_tokens(default: int = 1024) -> int:
    """Scale max_tokens by remaining context window pressure."""
    budget = get_context_budget()
    return _BUDGET_TOKENS.get(budget, default)


def _get_effort() -> str:
    """Map context budget to output_config.effort level."""
    budget = get_context_budget()
    return _BUDGET_EFFORT.get(budget, "medium")


def _get_tool_budget() -> int:
    """Map context budget to synthesis tool-call ceiling."""
    return _BUDGET_TOOL_CALLS.get(get_context_budget(), 6)


def _dispatch_synthesis_tool(name: str, inp: dict) -> str:
    """Execute a read-only synthesis tool call and return a formatted text result.

    Called by _claude_think when Claude issues a tool_use block during synthesis.
    All tools are read-only — no KB mutations, no indexing operations.
    """
    try:
        ctx.ensure_ready_sync()

        if name == "search_code":
            query = inp.get("query", "")
            path_filter = inp.get("path", "") or ""
            top_k = min(int(inp.get("top_k", 5)), 10)
            # engine.search() only accepts query, top_k, language — path filter applied post-hoc
            results = ctx.project_engine.search(query, top_k=top_k * 2 if path_filter else top_k)
            if path_filter:
                results = [r for r in results if path_filter in r.get("source", "")]
            results = results[:top_k]
            if not results:
                return "No results."
            lines = []
            for r in results:
                rel = r.get("source", "").replace(ctx.PROJECT_ROOT + "/", "")
                snippet = r.get("content", "")[:120].replace("\n", " ")
                lines.append(f"{rel}:{r.get('start_line', '?')} ({fmt_score(r.get('score', 0))}) — {snippet}")
            return "\n".join(lines)

        if name == "search_knowledge":
            query = inp.get("query", "")
            top_k = min(int(inp.get("top_k", 5)), 10)
            results = ctx.project_engine.search_knowledge(query, top_k=top_k)
            if not results:
                return "No KB entries found."
            return "\n".join(
                f"[{r['category']}] {r['title']}: {r['content'][:300]}"
                for r in results
            )

        if name == "find_callers":
            symbol = inp.get("symbol", "")
            path_filter = inp.get("path", "")
            if not symbol:
                return "Error: symbol required."
            results = _find_callers(symbol, ctx.PROJECT_ROOT)
            if path_filter:
                results = [r for r in results if path_filter in r.get("file", "")]
            results = [r for r in results if symbol not in os.path.basename(r.get("file", ""))]
            if not results:
                return f"No callers found for '{symbol}'."
            caller_files = sorted(set(r["file"].replace(ctx.PROJECT_ROOT + "/", "") for r in results))
            return f"{len(caller_files)} caller files:\n" + "\n".join(f"  {f}" for f in caller_files[:25])

        if name == "file_lines":
            file_path = inp.get("file_path", "")
            start = max(1, int(inp.get("start", 1)))
            end = int(inp.get("end", 0))
            abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
            if abs_path is None:
                return "Error: path outside project root."
            if not os.path.isfile(abs_path):
                return f"File not found: {file_path}"
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                all_lines = f.readlines()
            total = len(all_lines)
            s = start - 1
            e = min(end if end > 0 else total, total, s + 200)  # cap at 200 lines per call
            selected = all_lines[s:e]
            rel = abs_path.replace(ctx.PROJECT_ROOT + "/", "")
            header = f"## {rel} (lines {s+1}-{e} of {total})\n"
            return header + "".join(f"{s+1+i:4d}  {ln.rstrip()}\n" for i, ln in enumerate(selected))

        if name == "lookup_symbol":
            sym_name = inp.get("name", "")
            kind = inp.get("kind", "") or ""
            if not sym_name:
                return "Error: name required."
            results = ctx.project_engine.lookup_symbol(sym_name, kind=kind)
            if not results:
                return f"Symbol '{sym_name}' not found."
            lines = []
            for r in results:
                sig = f" {r['signature']}" if r.get("signature") else ""
                rel = r.get("file", "").replace(ctx.PROJECT_ROOT + "/", "")
                lines.append(f"[{r['kind']}] {r['name']}{sig}  ({rel}:{r['line']})")
            return "\n".join(lines)

        if name == "get_function_body":
            fn_name = inp.get("function_name", "")
            file_path = inp.get("file_path", "") or ""
            if not fn_name:
                return "Error: function_name required."
            from .symbols import get_function_body
            return get_function_body(fn_name, file_path=file_path)

        return f"Unknown synthesis tool: {name}"

    except Exception as e:
        logger.warning(f"_dispatch_synthesis_tool {name}: {e}")
        return f"Tool error: {e}"


_KB_CATEGORY_ORDER = {"architecture": 0, "decision": 1, "pattern": 2, "bugfix": 3, "general": 4}


def _format_kb_corpus() -> str:
    """Dump all KB entries (project + global) as a cacheable context block.

    Sorted architecture → decision → pattern → bugfix → general for logical flow.
    """
    try:
        lines = []
        proj_rows = ctx.project_engine.list_knowledge_full() if ctx.project_engine else []
        if proj_rows:
            proj_rows = sorted(proj_rows, key=lambda r: _KB_CATEGORY_ORDER.get(r.get("category", "general"), 4))
            lines.append("# Project Knowledge Base\n")
            for r in proj_rows:
                lines.append(f"[{r['category']}] {r['title']}: {r['content'][:300]}")
        glob_rows = ctx.global_engine.list_knowledge_full() if ctx.global_engine else []
        if glob_rows:
            glob_rows = sorted(glob_rows, key=lambda r: _KB_CATEGORY_ORDER.get(r.get("category", "general"), 4))
            lines.append("\n# Global Knowledge Base\n")
            for r in glob_rows:
                lines.append(f"[global/{r['category']}] {r['title']}: {r['content'][:200]}")
        corpus = "\n".join(lines) if lines else ""
        # Guard: if corpus exceeds ~40k tokens (≈160k chars), trim from lowest-priority first.
        # Already sorted by category priority (architecture→general), so drop from the tail.
        if len(corpus) > 160_000:
            trimmed_proj = proj_rows[:]
            trimmed_glob = glob_rows[:]
            while len("\n".join(
                (["# Project Knowledge Base (trimmed)\n"] + [f"[{r['category']}] {r['title']}: {r['content'][:300]}" for r in trimmed_proj])
                + (["\n# Global Knowledge Base (trimmed)\n"] + [f"[global/{r['category']}] {r['title']}: {r['content'][:200]}" for r in trimmed_glob] if trimmed_glob else [])
            )) > 160_000:
                # Drop from global first (lower priority), then project general/bugfix tail
                if trimmed_glob:
                    trimmed_glob = trimmed_glob[:-1]
                elif trimmed_proj:
                    trimmed_proj = trimmed_proj[:-1]
                else:
                    break
            lines = []
            if trimmed_proj:
                lines.append("# Project Knowledge Base (trimmed)\n")
                for r in trimmed_proj:
                    lines.append(f"[{r['category']}] {r['title']}: {r['content'][:300]}")
            if trimmed_glob:
                lines.append("\n# Global Knowledge Base (trimmed)\n")
                for r in trimmed_glob:
                    lines.append(f"[global/{r['category']}] {r['title']}: {r['content'][:200]}")
            corpus = "\n".join(lines)
        return corpus
    except Exception:
        return ""


_LOCAL_MODEL = os.environ.get("HME_LOCAL_MODEL", "qwen2.5-coder:14b")
# Reasoning model for think/causal_trace/memory_dream — falls back to _LOCAL_MODEL
_REASONING_MODEL = os.environ.get("HME_REASONING_MODEL", "deepseek-r1:14b")


_LOCAL_URL = os.environ.get("HME_LOCAL_URL", "http://localhost:11434/api/generate")


def _local_think(prompt: str, max_tokens: int = 1024, model: str | None = None) -> str | None:
    """Call local Ollama model for synthesis tasks.

    Uses only stdlib -- no extra dependencies. Returns None if Ollama isn't running
    or the model isn't available, allowing callers to fall back gracefully.
    Pass model=_REASONING_MODEL for think/causal_trace/memory_dream tasks.
    """
    import urllib.request
    body = json.dumps({
        "model": model or _LOCAL_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": max_tokens},
    }).encode()
    req = urllib.request.Request(
        _LOCAL_URL, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        # 240s: at ~15 tok/s, 1024 tokens needs ~68s + deepseek-r1 reasoning overhead
        with urllib.request.urlopen(req, timeout=240) as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            if not text:
                return None
            # Quality gate: suppress hallucinated / low-value output
            _hallucination_markers = [
                "hypothetical", "as an AI", "I don't have access",
                "this document provides", "these documents provide",
                "in this hypothetical", "as a language model",
            ]
            text_lower = text.lower()
            if any(m in text_lower for m in _hallucination_markers):
                logger.info(f"_local_think: suppressed hallucinated output ({len(text)} chars)")
                return None
            # Strip non-ASCII (multilingual model leakage: CJK, emoji, etc.)
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            return text if text else None
    except Exception as e:
        logger.debug(f"_local_think unavailable: {e}")
        return None


def _read_module_source(module_name: str, max_chars: int = 3000) -> str:
    """Read the first N chars of a module's source file for grounding synthesis prompts."""
    import glob as _glob
    candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{module_name}.js"), recursive=True)
    if not candidates:
        candidates = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "tools", "**", f"{module_name}.py"), recursive=True)
    if not candidates:
        return ""
    try:
        with open(candidates[0], encoding="utf-8", errors="ignore") as _f:
            content = _f.read()
        return content[:max_chars]
    except Exception:
        return ""


def _think_local_or_claude(prompt: str, api_key: str, **claude_kwargs) -> str | None:
    """Try local model first for mechanical tasks. Fall back to Claude if unavailable."""
    result = _local_think(prompt)
    if result:
        return result
    if api_key:
        return _claude_think(prompt, api_key, **claude_kwargs)
    return None


def _claude_think(user_text: str, api_key: str, max_tokens: int | None = None,
                  kb_context: str = "", effort: str | None = None,
                  max_tool_calls: int | None = None, model: str | None = None) -> str | None:
    """Call Claude with adaptive thinking + two-level prompt caching.

    Cache breakpoints:
      1. _THINK_SYSTEM (stable across all calls) — cached as first system block
      2. kb_context (stable content, 1h TTL) — cached as second system block when provided

    max_tokens and output_config.effort both scale with context window pressure.
    Pass effort='high' to override for explicit reasoning calls (e.g. think tool).
    Thinking blocks use display='omitted' — tokens are processed but not streamed,
    reducing TTFT. We only extract the text blocks from the response.

    When max_tool_calls > 0, enables a hybrid kickstart + agentic loop: Claude receives
    the pre-assembled kickstart context AND a set of read-only tools it can invoke to
    chase down anything the kickstart doesn't cover. The loop continues until Claude
    stops requesting tools or the budget is exhausted, at which point tools are
    removed from the request to force a final synthesis turn.
    """
    if max_tokens is None:
        max_tokens = _get_max_tokens()
    if effort is None:
        effort = _get_effort()
    try:
        import httpx
        import time as _time

        system_blocks: list[dict] = [
            {"type": "text", "text": _THINK_SYSTEM, "cache_control": {"type": "ephemeral"}},
        ]
        if kb_context:
            system_blocks.append(
                {"type": "text", "text": kb_context, "cache_control": {"type": "ephemeral", "ttl": "1h"}}
            )
        headers = {
            "x-api-key": api_key,
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            # extended-cache-ttl-2025-04-11 required for "ttl": "1h" to take effect
            "anthropic-beta": "prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11",
        }

        def _call_api(messages: list, tools: list) -> dict | None:
            """Single API call with one retry on transient errors."""
            body: dict = {
                "model": model or _THINK_MODEL,
                "max_tokens": max_tokens,
                "thinking": {"type": "adaptive", "display": "omitted"},
                "output_config": {"effort": effort},
                "system": system_blocks,
                "messages": messages,
            }
            if tools:
                body["tools"] = tools
            for attempt in range(2):
                t0 = _time.monotonic()
                resp = httpx.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=headers,
                    json=body,
                    timeout=60.0,
                )
                elapsed_ms = int((_time.monotonic() - t0) * 1000)
                if resp.status_code == 200:
                    data = resp.json()
                    usage = data.get("usage", {})
                    logger.info(
                        f"_claude_think: effort={effort} turn={len(messages)} "
                        f"tokens={usage.get('input_tokens',0)}in/{usage.get('output_tokens',0)}out "
                        f"cache_read={usage.get('cache_read_input_tokens',0)} "
                        f"cache_write={usage.get('cache_creation_input_tokens',0)} "
                        f"latency={elapsed_ms}ms"
                    )
                    return data
                if resp.status_code in (429, 500, 529) and attempt == 0:
                    retry_after = int(resp.headers.get("retry-after", "5"))
                    logger.warning(f"_claude_think: HTTP {resp.status_code}, retrying in {retry_after}s")
                    _time.sleep(min(retry_after, 10))
                    continue
                logger.warning(f"_claude_think: HTTP {resp.status_code}: {resp.text[:200]}")
                return None
            return None

        # ── Hybrid kickstart + agentic loop ──────────────────────────────────
        budget = max_tool_calls if max_tool_calls is not None else 0
        messages: list[dict] = [{"role": "user", "content": user_text}]
        tools_remaining = budget

        # Allow up to budget+2 turns: tool-call turns + forced final synthesis turn
        for _turn in range(budget + 2):
            active_tools = _SYNTHESIS_TOOLS if tools_remaining > 0 else []
            data = _call_api(messages, active_tools)
            if data is None:
                return None

            content_blocks = data.get("content", [])
            stop_reason = data.get("stop_reason", "end_turn")

            # Always append the full assistant response (incl. thinking blocks for multi-turn)
            messages.append({"role": "assistant", "content": content_blocks})

            if stop_reason != "tool_use":
                # Done — extract text blocks as synthesis result
                return " ".join(
                    b["text"] for b in content_blocks if b.get("type") == "text"
                ).strip() or None

            # Execute tool calls and build tool_result user turn
            tool_results = []
            for block in content_blocks:
                if block.get("type") != "tool_use":
                    continue
                tool_id = block.get("id", "")
                tool_name = block.get("name", "")
                tool_input = block.get("input", {})
                logger.info(f"_claude_think: tool_use {tool_name} input_keys={list(tool_input.keys())}")
                result_text = _dispatch_synthesis_tool(tool_name, tool_input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result_text[:6000],  # cap to keep context bounded
                })
                tools_remaining -= 1

            if not tool_results:
                break
            messages.append({"role": "user", "content": tool_results})
            # If budget exhausted, next turn gets no tools — forces end_turn synthesis
            if tools_remaining <= 0:
                tools_remaining = 0

    except Exception as e:
        logger.warning(f"_claude_think: {e}")
    return None


def _warm_cache(api_key: str) -> None:
    """Pre-warm the system prompt + KB corpus cache in a background thread.

    Fires at startup (from context.py) so the first real tool call hits cached blocks.
    """
    import threading
    def _warm():
        try:
            kb = _format_kb_corpus()
            # min 10 tokens: adaptive thinking needs room for a valid text response block
            _claude_think("ping", api_key, max_tokens=10, kb_context=kb)
            logger.info("_warm_cache: system + KB corpus cache warmed")
        except Exception as e:
            logger.debug(f"_warm_cache: {e}")
    threading.Thread(target=_warm, daemon=True, name="cdr-cache-warm").start()
