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
        f"You are a structured reflection engine for the '{project_name}' codebase. "
        "Ground every claim in KB constraints or injected code — never speculate about "
        "tool capabilities or module behavior without evidence. Cite exact file paths, "
        "function names, and KB entry titles. No generic advice. No preamble. "
        "Max 4 concrete items per answer."
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


_LOCAL_MODEL = os.environ.get("HME_LOCAL_MODEL", "qwen3-coder:30b")
# Reasoning model: Qwen3-30B-A3B (MoE, 3B active params, hybrid thinking mode).
# Beats QwQ-32B and DeepSeek-R1 on reasoning benchmarks at lower compute.
# ~18.6GB Q4 — fits on one M40. qwen2.5-coder:14b (~9GB) on the other. Both loaded.
_REASONING_MODEL = os.environ.get("HME_REASONING_MODEL", "qwen3:30b-a3b")


_LOCAL_URL = os.environ.get("HME_LOCAL_URL", "http://localhost:11434/api/generate")
# Chat endpoint: Ollama /api/chat accepts messages=[{role,content}] (OpenAI-compatible).
# Prefer over /api/generate for multi-turn synthesis — model sees prior outputs as
# "assistant turns it already said", producing more coherent continuation than feeding
# them back as raw text. This is the equivalent of Claude's conversation memory.
_LOCAL_CHAT_URL = _LOCAL_URL.replace("/api/generate", "/api/chat")


# ── Ollama priority queue ──────────────────────────────────────────────────
# Ollama processes requests sequentially. Background pre-warm can queue 30+ calls.
# Interactive calls (think, before_editing on-demand) must pop to the top.
#
# Design: a threading.Event that background callers check before each Ollama call.
# When an interactive call arrives, it sets the event, background callers yield
# (sleep + re-check), and the interactive call proceeds immediately.
import threading as _threading

_ollama_interactive = _threading.Event()  # set = interactive call waiting
_ollama_lock = _threading.Lock()          # serializes actual Ollama calls (fallback)
# Per-GPU locks for multi-stage ping-pong: coder and reasoner can run simultaneously
_gpu0_lock = _threading.Lock()  # qwen3-coder:30b (extraction)
_gpu1_lock = _threading.Lock()  # qwen3:30b-a3b (reasoning)


def _ollama_background_yield():
    """Called by background tasks before each Ollama call. If an interactive call
    is waiting, yields by sleeping until it clears."""
    while _ollama_interactive.is_set():
        import time as _t
        _t.sleep(0.5)


def _local_think(prompt: str, max_tokens: int = 8192, model: str | None = None,
                 priority: str = "interactive", system: str = "",
                 temperature: float = 0.3) -> str | None:
    """Call local Ollama model for synthesis tasks.

    Uses only stdlib -- no extra dependencies. Returns None if Ollama isn't running
    or the model isn't available, allowing callers to fall back gracefully.
    Pass model=_REASONING_MODEL for think/causal_trace/memory_dream tasks.
    system: optional system prompt for role-setting.
    temperature: 0.1 for deterministic extraction, 0.3 for balanced, 0.5 for creative.
    """
    import urllib.request

    # Priority queue: interactive calls signal background callers to yield.
    # Background callers check _ollama_interactive before proceeding.
    # "parallel": used inside _parallel_two_stage_think threads — skip event management
    #   entirely (caller manages interactive flag before/after launching threads).
    if priority == "background":
        _ollama_background_yield()
    elif priority == "interactive":
        _ollama_interactive.set()  # signal background to pause
    # priority == "parallel": no event set/clear, no background yield

    payload: dict = {
        "model": model or _LOCAL_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    if system:
        payload["system"] = system
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        _LOCAL_URL, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        # 420s: 70b at ~5-8 tok/s on 2x M40 → 512 tokens needs ~64-102s + reasoning overhead.
        # 14b at ~15 tok/s → 512 tokens needs ~34s. Timeout covers both with margin.
        # Per-GPU lock: coder (GPU 0) and reasoner (GPU 1) can run simultaneously.
        # Falls back to global lock for unknown models.
        active_lock = (_gpu0_lock if (model or _LOCAL_MODEL) == _LOCAL_MODEL
                       else _gpu1_lock if (model or _LOCAL_MODEL) == _REASONING_MODEL
                       else _ollama_lock)
        with active_lock:
            resp_obj = urllib.request.urlopen(req, timeout=420)
        if priority == "interactive":
            _ollama_interactive.clear()  # release background callers
        # priority == "parallel": caller manages clear() after all threads join
        with resp_obj as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            # qwen3 embeds thinking in <think>...</think> in the response field.
            # Strip it and use only the final answer after </think>.
            if "</think>" in text:
                text = text[text.rfind("</think>") + len("</think>"):].strip()
            elif "<think>" in text:
                # Thinking started but was cut off by max_tokens — use thinking content
                text = text[text.find("<think>") + len("<think>"):].strip()
            # deepseek-r1 puts reasoning in "thinking" field, final answer in "response".
            # If response is empty (ran out of tokens during thinking), use thinking content.
            if not text:
                thinking = result.get("thinking", "").strip()
                if thinking:
                    text = thinking
                else:
                    return None
            # Quality gate: suppress hallucinated / low-value output
            _hallucination_markers = [
                "in this hypothetical scenario", "as an AI", "I don't have access",
                "this document provides", "these documents provide",
                "as a language model", "i cannot determine",
            ]
            text_lower = text.lower()
            if any(m in text_lower for m in _hallucination_markers):
                logger.info(f"_local_think: suppressed hallucinated output ({len(text)} chars)")
                if priority == "interactive":
                    _ollama_interactive.clear()
                return None
            # Reasoning-leak gate: detect chain-of-thought that leaked into response.
            # qwen3 sometimes outputs internal reasoning instead of a direct answer.
            _reasoning_markers = [
                "but note:", "however,", "let's look", "we are to", "given the above",
                "so we", "but we don't know", "we have to", "let's consider",
                "we need to find", "we can assume", "first, note that",
            ]
            reasoning_hits = sum(1 for m in _reasoning_markers if m in text_lower)
            if reasoning_hits >= 4 and len(text) > 1500:
                # Try to extract just the conclusion (after "therefore" or "so the answer")
                for marker in ["therefore,", "so the answer", "in summary", "the next two", "answer:"]:
                    idx = text_lower.rfind(marker)
                    if idx != -1:
                        text = text[idx:].strip()
                        break
                else:
                    # No conclusion marker — take last 25% as likely conclusion
                    text = text[len(text) * 3 // 4:].strip()
                logger.info(f"_local_think: trimmed reasoning leak ({reasoning_hits} markers, kept {len(text)} chars)")
            # Strip non-ASCII (multilingual model leakage: CJK, emoji, etc.)
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            # Strip generic filler sentences that add no information
            _filler_phrases = [
                # NOTE: "dynamic interplay between/of" intentionally NOT listed --
                # it's a valid music criticism phrase (only strip HME-specific filler).
                "enhancing the alien", "creating a rich tapestry",
                "a fascinating interplay", "this creates a dynamic",
            ]
            sentences = re.split(r'(?<=[.!])\s+', text)
            sentences = [s for s in sentences
                         if not any(fp in s.lower() for fp in _filler_phrases)]
            text = " ".join(sentences).strip()
            if priority == "interactive":
                _ollama_interactive.clear()
            return text if text else None
    except Exception as e:
        if priority == "interactive":
            _ollama_interactive.clear()
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


def _think_local_or_claude(prompt: str, api_key: str,
                           local_model: str | None = None,
                           local_temperature: float = 0.3,
                           **claude_kwargs) -> str | None:
    """Try local model first for mechanical tasks. Fall back to Claude if unavailable.

    local_model: override the default _LOCAL_MODEL (e.g. pass _REASONING_MODEL for creative prose).
    local_temperature: override default 0.3 (use 0.5+ for creative/critique tasks).
    """
    result = _local_think(prompt, model=local_model, temperature=local_temperature)
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


def _two_stage_think(raw_context: str, question: str, max_tokens: int = 8192) -> str | None:
    """Multi-stage convergent synthesis: coder and reasoner ping-pong until answer converges.

    Stage 1 (qwen3-coder:30b, GPU 0): Extract and structure relevant facts into a brief.
    Stage 2 (qwen3:30b-a3b, GPU 1): Identify gaps in the brief — what's missing?
    Stage 3 (qwen3-coder:30b, GPU 0): Targeted re-extraction for just the gaps.
    Stage 4 (qwen3:30b-a3b, GPU 1): Final answer from accumulated brief.

    Convergence: if Stage 2 finds no gaps, skip Stage 3 and answer immediately.
    Falls back to single-stage reasoning if Stage 1 fails.
    """
    _STAGE1_SYSTEM = (
        "You are a code extraction assistant for the Polychron music synthesis project. "
        "Extract code facts only. No reasoning, no analysis, no opinions. "
        "Output: file paths, function names, signal fields, correlation values, bridge status."
    )
    # Stage 1: Coder extracts (GPU 0, fast, deterministic)
    frame_prompt = (
        "Extract ONLY the facts relevant to answering this question:\n"
        f"  {question}\n\n"
        "Rules:\n"
        "- Preserve EXACT file paths (src/crossLayer/...), function names, signal field names, and KB entry titles\n"
        "- For each relevant module: state its file, its coupling dimensions, and its antagonist pair\n"
        "- Mark pairs as VIRGIN (0 bridges), PARTIAL (1-2), or SATURATED (3+)\n"
        "- Preserve code snippets that directly relate\n"
        "- Max 500 words\n\n"
        "Raw project context:\n" + raw_context[:8000]
    )
    frame = _local_think(frame_prompt, max_tokens=2000, model=_LOCAL_MODEL,
                         system=_STAGE1_SYSTEM, temperature=0.1)

    # Quality gate: frame must contain at least one src/ path to be useful
    if not frame or len(frame) < 40 or "src/" not in frame:
        return _local_think(
            raw_context[:6000] + "\n\n" + question,
            max_tokens=max_tokens, model=_REASONING_MODEL
        )

    # Stage 2: Reasoner identifies gaps (GPU 1, cheap — just gap detection)
    gap_prompt = (
        "Brief about the Polychron codebase:\n\n" + frame + "\n\n"
        "Question to answer: " + question + "\n\n"
        "What SPECIFIC facts are MISSING from this brief that are needed to answer the question?\n"
        "List each gap as: NEED: <what is missing>\n"
        "If the brief has everything needed, respond with exactly: NO GAPS\n"
        "Max 5 gaps. /no_think"
    )
    gaps = _local_think(gap_prompt, max_tokens=500, model=_REASONING_MODEL, temperature=0.2)

    # Convergence check: if no gaps found, skip Stage 3
    if gaps and "NO GAP" not in gaps.upper() and "NEED:" in gaps:
        # Stage 3: Coder does targeted re-extraction for identified gaps (GPU 0)
        supplement_prompt = (
            "The following information is MISSING from a previous extraction.\n"
            "Extract ONLY these specific facts from the raw context:\n\n"
            + gaps + "\n\n"
            "Raw project context:\n" + raw_context[:8000] + "\n\n"
            "Output only the missing facts. Max 300 words."
        )
        supplement = _local_think(supplement_prompt, max_tokens=1000, model=_LOCAL_MODEL,
                                  system=_STAGE1_SYSTEM, temperature=0.1)
        if supplement and len(supplement) > 20:
            frame = frame + "\n\n## Supplemental extraction:\n" + supplement
            logger.info(f"_two_stage_think: gap-fill round added {len(supplement)} chars")

    # Stage 4 (or Stage 2 if no gaps): Final answer from accumulated brief
    # /no_think on final stage — gap-fill already did the deep analysis;
    # final stage just formats the answer cleanly.
    abbreviated_context = raw_context[:2000]
    reason_prompt = (
        "Structured brief about the Polychron codebase:\n\n"
        + frame + "\n\n"
        "Additional raw context (cross-reference only):\n" + abbreviated_context + "\n\n"
        "Question: " + question + "\n\n"
        "Answer using ONLY modules, files, signals, and functions named in the brief. "
        "Do NOT invent names. "
        "Format each item as:\n"
        "  FILE: path, FUNCTION: name, SIGNAL: field, EFFECT: one sentence.\n"
        "Max 4 items. No prose paragraphs. /no_think"
    )
    return _local_think(reason_prompt, max_tokens=max_tokens, model=_REASONING_MODEL)


def _parallel_two_stage_think(raw_context: str, question: str, max_tokens: int = 8192) -> str | None:
    """True parallel two-GPU synthesis. GPU 0 and GPU 1 run simultaneously in Stage 1.

    Stage 1A (qwen3-coder:30b, GPU 0): Extract structured code facts — file paths,
      function names, signal fields, bridge status. Deterministic (temp=0.1).
    Stage 1B (qwen3:30b-a3b, GPU 1): Independent first-pass analysis — coupling
      patterns, musical effects, antagonism logic. Speculative (temp=0.2).
    Both run simultaneously via threading.Thread with per-GPU locks.

    Stage 2 (GPU 1): Final synthesis from merged Stage 1A + 1B briefs.

    Performance: ~max(GPU0_time, GPU1_time) instead of sum — roughly 2× faster
    than the 4-stage sequential flow for most questions.
    Falls back to _two_stage_think if threading fails.
    """
    import threading

    # Detect question type for format routing
    _q_lower = question.lower()
    _is_evolution_q = any(k in _q_lower for k in [
        "next bridge", "r86", "r87", "r88", "r89", "antagonist", "leverage",
        "which pair", "best signal", "next evolution", "virgin pair", "best next"
    ])

    _EXTRACT_SYSTEM = (
        "You are a code extraction assistant for the Polychron music synthesis project. "
        "Extract code facts only. No reasoning, no analysis, no opinions. "
        "Output: file paths, signal fields, correlation values, bridge status. NO function names."
    )

    # Signal interactive to pause background callers before launching threads.
    _ollama_interactive.set()

    results = [None, None]  # index 0 = GPU 0 result, index 1 = GPU 1 result

    def _gpu0_extract():
        if _is_evolution_q:
            prompt = (
                "Extract antagonist pair data relevant to:\n"
                f"  {question}\n\n"
                "For each relevant PAIR: module names, r-value, already-bridged signals, "
                "candidate unused signals with directions (A does X / B does Y opposing).\n"
                "Mark pairs: VIRGIN (0 bridges), PARTIAL (1-2), SATURATED (3+).\n"
                "Max 400 words. NO function names.\n\n"
                "Raw context:\n" + raw_context[:8000]
            )
        else:
            prompt = (
                "Extract ONLY the facts relevant to answering:\n"
                f"  {question}\n\n"
                "Rules:\n"
                "- EXACT file paths (src/crossLayer/...), signal field names\n"
                "- For each relevant module: file path, coupling dimensions, antagonist pair\n"
                "- Mark pairs: VIRGIN (0 bridges), PARTIAL (1-2), SATURATED (3+)\n"
                "- Code snippets that directly relate\n"
                "- Max 400 words. NO function names.\n\n"
                "Raw context:\n" + raw_context[:8000]
            )
        results[0] = _local_think(prompt, max_tokens=2000, model=_LOCAL_MODEL,
                                   system=_EXTRACT_SYSTEM, temperature=0.1,
                                   priority="parallel")

    def _gpu1_analyze():
        prompt = (
            "Question: " + question + "\n\n"
            "Analyze this Polychron codebase context. What coupling patterns, antagonism "
            "bridges, or signal flows directly answer this question?\n"
            "Be specific: name modules, exact fields, and effects.\n"
            "Max 300 words. /no_think\n\n"
            "Context:\n" + raw_context[:6000]
        )
        results[1] = _local_think(prompt, max_tokens=1200, model=_REASONING_MODEL,
                                   temperature=0.2, priority="parallel")

    try:
        t0 = threading.Thread(target=_gpu0_extract, daemon=True)
        t1 = threading.Thread(target=_gpu1_analyze, daemon=True)
        t0.start()
        t1.start()
        t0.join(timeout=450)
        t1.join(timeout=450)
    finally:
        _ollama_interactive.clear()  # clear after ALL threads done

    gpu0_out, gpu1_out = results[0], results[1]

    # If both failed, fall back to sequential
    if not gpu0_out and not gpu1_out:
        logger.warning("_parallel_two_stage_think: both stages failed, falling back to sequential")
        return _two_stage_think(raw_context, question, max_tokens)

    # Build merged brief from both perspectives
    merged_parts = []
    if gpu0_out and len(gpu0_out) > 30:
        merged_parts.append("## Structural Facts (extracted)\n" + gpu0_out)
    if gpu1_out and len(gpu1_out) > 30:
        merged_parts.append("## Coupling Analysis (reasoned)\n" + gpu1_out)
    merged = "\n\n".join(merged_parts) if merged_parts else (gpu0_out or gpu1_out or "")

    # Stage 2: Final synthesis via /api/chat — model sees merged analysis as its own
    # prior assistant turn, producing coherent continuation rather than re-reading text.
    if _is_evolution_q:
        _fmt_instruction = (
            "Format each recommendation as:\n"
            "  PAIR: moduleA↔moduleB (r=value), SIGNAL: fieldName, "
            "DIRECTION: moduleA raises X when field high / moduleB lowers Y when field high."
        )
    else:
        _fmt_instruction = (
            "Format each finding as:\n"
            "  FILE: path, SIGNAL: field, EFFECT: one sentence."
        )
    chat_messages = [
        {
            "role": "system",
            "content": (
                "You are a Polychron music synthesis codebase expert. "
                "Answer only from facts in the conversation. Do NOT invent module names, "
                "function names, or signal fields. /no_think"
            )
        },
        {
            "role": "user",
            "content": (
                f"Analyze the Polychron codebase for:\n  {question}\n\n"
                "Context:\n" + raw_context[:2000]
            )
        },
        {
            "role": "assistant",
            "content": merged  # model sees this as "what I already concluded"
        },
        {
            "role": "user",
            "content": (
                "Based on your analysis, answer the question:\n  " + question + "\n\n"
                "Use ONLY modules and signals from your analysis above. " + _fmt_instruction + "\n"
                "Max 4 items. No prose. /no_think"
            )
        },
    ]
    result = _local_chat(chat_messages, model=_REASONING_MODEL, max_tokens=max_tokens, temperature=0.15)
    if not result:
        # Fallback: single-stage generate if chat endpoint unavailable
        fallback_prompt = ("Based on this analysis:\n\n" + merged + "\n\nAnswer: " + question +
                           "\n\n" + _fmt_instruction + "\nMax 4 items. /no_think")
        result = _local_think(fallback_prompt, max_tokens=max_tokens, model=_REASONING_MODEL)
    if result:
        logger.info(f"_parallel_two_stage_think: merged {len(gpu0_out or '')}+{len(gpu1_out or '')} chars → {len(result)} chars answer (chat)")
    return result or merged  # return merged brief as fallback if final stage fails


def _local_chat(messages: list[dict], model: str | None = None,
                max_tokens: int = 4096, temperature: float = 0.2) -> str | None:
    """Call Ollama /api/chat with a messages array (OpenAI-compatible multi-turn format).

    The model sees prior outputs as assistant turns it already produced, giving it a
    'continuation' mental model rather than treating prior context as external text.
    This is the Ollama equivalent of Claude's conversation memory — better coherence
    for multi-stage synthesis where each stage builds on the previous.

    messages: [{role: 'system'|'user'|'assistant', content: str}]
    Falls back to None if chat endpoint unavailable (caller should degrade gracefully).
    """
    import urllib.request
    active_lock = (_gpu0_lock if (model or _LOCAL_MODEL) == _LOCAL_MODEL
                   else _gpu1_lock if (model or _LOCAL_MODEL) == _REASONING_MODEL
                   else _ollama_lock)
    payload = {
        "model": model or _REASONING_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        _LOCAL_CHAT_URL, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with active_lock:
            resp_obj = urllib.request.urlopen(req, timeout=420)
        with resp_obj as resp:
            result = json.loads(resp.read())
            # /api/chat response: {"message": {"role": "assistant", "content": "..."}}
            msg = result.get("message", {})
            text = msg.get("content", "").strip() if isinstance(msg, dict) else ""
            # Strip <think>...</think> blocks (qwen3 chain-of-thought in chat mode)
            if "</think>" in text:
                text = text[text.rfind("</think>") + len("</think>"):].strip()
            elif "<think>" in text:
                text = text[text.find("<think>") + len("<think>"):].strip()
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            return text if text else None
    except Exception as e:
        logger.debug(f"_local_chat unavailable: {e}")
        return None


def _local_think_with_system(prompt: str, system: str, max_tokens: int = 1024,
                              model: str | None = None) -> str | None:
    """Call local Ollama model with an explicit system prompt."""
    import urllib.request
    body = json.dumps({
        "model": model or _LOCAL_MODEL,
        "system": system,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": max_tokens},
    }).encode()
    req = urllib.request.Request(
        _LOCAL_URL, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            result = json.loads(resp.read())
            text = result.get("response", "").strip()
            if not text:
                return None
            text = re.sub(r'[^\x00-\x7F]+', '', text).strip()
            return text if text else None
    except Exception as e:
        logger.debug(f"_local_think_with_system unavailable: {e}")
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
