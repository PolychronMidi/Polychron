"""HME Claude API synthesis layer — _claude_think, _fast_claude, _format_kb_corpus, _warm_cache."""
import os
import logging

from server import context as ctx
from server.helpers import validate_project_path, fmt_score
from symbols import find_callers as _find_callers
from .synthesis_config import (
    _get_api_key, _THINK_MODEL, _DEEP_MODEL, _THINK_SYSTEM,
    _KB_CATEGORY_ORDER, _get_max_tokens, _get_effort, _get_tool_budget,
)

logger = logging.getLogger("HME")


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
            e = min(end if end > 0 else total, total, s + 200)
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
        if len(corpus) > 160_000:
            trimmed_proj = proj_rows[:]
            trimmed_glob = glob_rows[:]
            while len("\n".join(
                (["# Project Knowledge Base (trimmed)\n"] + [f"[{r['category']}] {r['title']}: {r['content'][:300]}" for r in trimmed_proj])
                + (["\n# Global Knowledge Base (trimmed)\n"] + [f"[global/{r['category']}] {r['title']}: {r['content'][:200]}" for r in trimmed_glob] if trimmed_glob else [])
            )) > 160_000:
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

        budget = max_tool_calls if max_tool_calls is not None else 0
        messages: list[dict] = [{"role": "user", "content": user_text}]
        tools_remaining = budget

        for _turn in range(budget + 2):
            active_tools = _SYNTHESIS_TOOLS if tools_remaining > 0 else []
            data = _call_api(messages, active_tools)
            if data is None:
                return None

            content_blocks = data.get("content", [])
            stop_reason = data.get("stop_reason", "end_turn")

            messages.append({"role": "assistant", "content": content_blocks})

            if stop_reason != "tool_use":
                return " ".join(
                    b["text"] for b in content_blocks if b.get("type") == "text"
                ).strip() or None

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
                    "content": result_text[:6000],
                })
                tools_remaining -= 1

            if not tool_results:
                break
            messages.append({"role": "user", "content": tool_results})
            if tools_remaining <= 0:
                tools_remaining = 0

    except Exception as e:
        logger.warning(f"_claude_think: {e}")
    return None


_FAST_MODEL = os.environ.get("HME_FAST_MODEL", "claude-haiku-4-5-20251001")


def _fast_claude(user_text: str, api_key: str, system_text: str = "", max_tokens: int = 400) -> str | None:
    """Fast Claude synthesis via Haiku — no extended thinking, no tools, no KB corpus.

    Used for high-frequency, low-stakes synthesis tasks (before_editing Edit Risks)
    where 3-5x speed matters more than depth. Haiku handles 3-bullet-point analysis
    fine and costs ~20x less than Sonnet with extended thinking.
    """
    if not api_key:
        return None
    try:
        import httpx
        import time as _time
        system = system_text or _THINK_SYSTEM
        body = {
            "model": _FAST_MODEL,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user_text}],
        }
        headers = {
            "x-api-key": api_key,
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
        }
        t0 = _time.monotonic()
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=body,
            timeout=30.0,
        )
        elapsed_ms = int((_time.monotonic() - t0) * 1000)
        if resp.status_code == 200:
            data = resp.json()
            usage = data.get("usage", {})
            logger.info(
                f"_fast_claude: model={_FAST_MODEL} "
                f"tokens={usage.get('input_tokens',0)}in/{usage.get('output_tokens',0)}out "
                f"latency={elapsed_ms}ms"
            )
            return " ".join(
                b["text"] for b in data.get("content", []) if b.get("type") == "text"
            ).strip() or None
        logger.warning(f"_fast_claude: HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    except Exception as e:
        logger.warning(f"_fast_claude: {e}")
        return None


def _warm_cache(api_key: str) -> None:
    """Pre-warm the system prompt + KB corpus cache in a background thread.

    Fires at startup (from context.py) so the first real tool call hits cached blocks.
    """
    import threading
    def _warm():
        try:
            kb = _format_kb_corpus()
            _claude_think("ping", api_key, max_tokens=10, kb_context=kb)
            logger.info("_warm_cache: system + KB corpus cache warmed")
        except Exception as e:
            logger.debug(f"_warm_cache: {e}")
    threading.Thread(target=_warm, daemon=True, name="cdr-cache-warm").start()
