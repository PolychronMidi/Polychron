"""Local model inference API — _local_think, _local_chat, compress_for_claude.

Split from synthesis_llamacpp.py for maintainability. All functions here
use the core infrastructure (circuit breaker, daemon routing, env config)
from synthesis_llamacpp.
"""
import json
import os
import re
import logging
import threading as _threading

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM
from .synthesis_llamacpp import (  # noqa: F401
    _get_circuit_breaker, _llamacpp_generate, _daemon_generate,
    _set_arbiter_busy, _llamacpp_url_for, _background_yield,
    _COOLDOWN_REFUSED, _KEEP_ALIVE, _NUM_CTX_4B,
    _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL,
    _LLAMACPP_ARBITER_URL, _num_ctx_for,
    _interactive_event,
)

logger = logging.getLogger("HME")


def _cancellable_urlopen(req_data, url, timeout, cancel_event):
    """Streaming urlopen that aborts when cancel_event fires.

    Full timeout for initial urlopen (llama.cpp queues requests and won't send headers
    until it starts processing ours). Then 2s socket timeout for reads so cancel_event
    is checked every 2s during prompt eval. Returns (response_bytes, None) or (None, exception).
    """
    import urllib.request
    payload = json.loads(req_data)
    payload["stream"] = True
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except Exception as e:
        return None, e
    try:
        resp.fp.raw._sock.settimeout(2.0)
    except (AttributeError, Exception):
        logger.debug("_cancellable_urlopen: could not set 2s socket timeout — cancel detection may be slow")
    try:
        chunks = []
        final_result = {}
        deadline = __import__("time").time() + timeout
        while True:
            if cancel_event.is_set():
                break
            if __import__("time").time() > deadline:
                resp.close()
                return None, TimeoutError(f"timed out after {timeout}s")
            try:
                raw_line = next(resp)
            except OSError as _sock_err:
                if cancel_event.is_set():
                    break
                if isinstance(_sock_err, TimeoutError):
                    continue
                raise
            except StopIteration:
                break
            except Exception as e:
                if cancel_event.is_set():
                    break
                raise
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            chunk = json.loads(line)
            text_piece = chunk.get("response", "")
            if text_piece:
                chunks.append(text_piece)
            if chunk.get("done"):
                final_result = chunk
                break
        if cancel_event.is_set():
            try:
                resp.close()
            except Exception as _err3:
                logger.debug(f"resp.close: {type(_err3).__name__}: {_err3}")
            logger.info("_cancellable_urlopen: cancelled in %.1fs", __import__("time").time() - (deadline - timeout))
            return None, InterruptedError("cancelled by interactive call")
        final_result["response"] = "".join(chunks)
        return json.dumps(final_result).encode(), None
    except Exception as e:
        if cancel_event.is_set():
            return None, InterruptedError("cancelled by interactive call")
        try:
            resp.close()
        except Exception as _err4:
            logger.debug(f"resp.close: {type(_err4).__name__}: {_err4}")
        return None, e


def _local_think(prompt: str, max_tokens: int = 8192, model: str | None = None,
                 priority: str = "interactive", system: str = "",
                 temperature: float = 0.3, context: list | None = None,
                 return_context: bool = False) -> str | tuple | None:
    """Call local llama.cpp model for synthesis tasks.

    Returns None if llama.cpp isn't running. Returns (text, context_array) when
    return_context=True — context_array is the llama.cpp KV cache state for reuse.
    On empty text (model used all tokens for thinking), returns (None, context_array)
    so warm priming can capture the KV state even without visible output.
    system: auto-swapped for warm KV context when system==_THINK_SYSTEM (transparent speedup).
    """
    import urllib.request
    import time as _time_mod

    _effective_model_early = model or _LOCAL_MODEL
    _cb = _get_circuit_breaker(_effective_model_early)
    if not _cb.allow():
        if priority != "background":
            logger.warning(f"_local_think REFUSED — circuit breaker OPEN for {_effective_model_early}")
        return (_COOLDOWN_REFUSED, []) if return_context else None

    # "parallel" = two threads hitting different GPUs simultaneously. Treated like
    # interactive (no yielding, uses interactive timeout) but does NOT set the
    # interactive preemption flag (which would block the sibling parallel thread).
    if priority == "background":
        _background_yield()
    elif priority == "interactive":
        _interactive_event.set()

    _effective_model = model or _LOCAL_MODEL

    # Lazy warm: kick off background priming on first interactive/parallel call
    if priority in ("interactive", "parallel") and system == _THINK_SYSTEM:
        from .synthesis_warm import ensure_warm
        ensure_warm(_effective_model)

    # Auto-warm: swap system= for warm KV context when available and fresh
    if system == _THINK_SYSTEM and context is None:
        from .synthesis_warm import _warm_ctx, _warm_ctx_kb_ver
        warm = _warm_ctx.get(_effective_model)
        kb_ver = getattr(ctx, "_kb_version", 0)
        if warm and _warm_ctx_kb_ver.get(_effective_model) == kb_ver:
            context = warm
            system = ""
            logger.debug(f"_local_think: warm ctx hit ({len(warm)} tokens, {_effective_model})")

    # Inject session narrative — filtered by relevance to the call type.
    if priority != "background" and (system == _THINK_SYSTEM or (system == "" and context is not None)):
        from .synthesis_session import get_session_narrative
        _narrative_cats = ["think", "edit", "search"] if "callers" in prompt.lower() or "find" in prompt.lower() else None
        narrative = get_session_narrative(max_entries=5, categories=_narrative_cats)
        if narrative and not prompt.startswith("Session narrative"):
            prompt = narrative + prompt

    payload: dict = {
        "model": _effective_model,
        "prompt": prompt,
        "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "num_ctx": _num_ctx_for(_effective_model),
        },
    }
    if system:
        payload["system"] = system
    if context:
        payload["context"] = context
    body = json.dumps(payload).encode()

    # All dispatch goes through llama-server (Vulkan) via OpenAI chat-completions.
    # Wall-clock is enforced inside _llamacpp_generate via thread-abandonment.
    _wall = 30 if priority == "background" else (20 if _effective_model == _ARBITER_MODEL else 30)
    result = _llamacpp_generate(payload, wall_timeout=_wall, priority=priority)
    if result is None:
        logger.warning(f"_local_think: llamacpp unavailable, skipping synthesis ({_effective_model})")
        if priority == "interactive":
            _interactive_event.clear()
        return (None, []) if return_context else None

    if priority == "interactive":
        _interactive_event.clear()

    try:
        from .synthesis_config import clean_model_output
        text = clean_model_output(result.get("response", ""))
        if not text:
            thinking = result.get("thinking", "").strip()
            if thinking:
                text = thinking
            else:
                # Return context even on empty text — warm priming needs KV state
                return (None, result.get("context", [])) if return_context else None
        _hallucination_markers = [
            "in this hypothetical scenario", "as an AI", "I don't have access",
            "this document provides", "these documents provide",
            "as a language model", "i cannot determine",
        ]
        if any(m in text.lower() for m in _hallucination_markers):
            logger.info(f"_local_think: suppressed hallucinated output ({len(text)} chars)")
            return None
        _reasoning_markers = [
            "but note:", "however,", "let's look", "we are to", "given the above",
            "so we", "but we don't know", "we have to", "let's consider",
            "we need to find", "we can assume", "first, note that",
            "let me ", "let's form", "we can list", "we don't have",
            "the problem ", "how to be specific", "we must not speculate",
            "okay,", "hmm,", "the challenge is", "double-check",
            "*final polish*", "making sure each", "should i check",
        ]
        reasoning_hits = sum(1 for m in _reasoning_markers if m in text.lower())
        if reasoning_hits >= 2 and len(text) > 400:
            for marker in ["therefore,", "so the answer", "in summary", "the next two", "answer:",
                          "the key ", "the most critical", "in conclusion", "to summarize",
                          "here's the", "the fix ", "the result"]:
                idx = text.lower().rfind(marker)
                if idx != -1:
                    text = text[idx:].strip()
                    break
            else:
                text = text[len(text) * 3 // 4:].strip()
        from .synthesis_config import strip_non_ascii
        text = strip_non_ascii(text)
        _filler_phrases = [
            "enhancing the alien", "creating a rich tapestry",
            "a fascinating interplay", "this creates a dynamic",
        ]
        sentences = re.split(r'(?<=[.!])\s+', text)
        text = " ".join(s for s in sentences if not any(fp in s.lower() for fp in _filler_phrases)).strip()
        if not text:
            return (None, []) if return_context else None
        _cb.record_success()
        # Trim verbose output before returning — callers shouldn't receive
        # unbounded text that inflates Claude's context window.
        from .. import BUDGET_LOCAL_THINK
        if len(text) > BUDGET_LOCAL_THINK:
            from .. import _budget_local_think
            text = _budget_local_think(text)
        if return_context:
            return (text, result.get("context", []))
        return text
    except Exception as e:
        if priority == "interactive":
            _interactive_event.clear()
        _err_str = str(e).lower()
        _is_timeout = ("timed out" in _err_str or "timeout" in type(e).__name__.lower()
                       or "urlopen error" in _err_str)
        _is_critical = ("cuda" in _err_str or "500" in _err_str or "oom" in _err_str
                        or "out of memory" in _err_str or "killed" in _err_str
                        or "internal server error" in _err_str or "panic" in _err_str)
        if _is_critical:
            ctx.register_critical_failure(
                f"_local_think({_effective_model})",
                f"{type(e).__name__}: {e}",
            )
        _cb.record_failure(is_timeout=_is_timeout)
        if _is_timeout:
            if priority != "background":
                logger.warning(
                    f"_local_think TIMEOUT ({_effective_model}) — circuit breaker: {_cb.state}. "
                    f"Error: {type(e).__name__}: {e}"
                )
        elif not _is_critical:
            logger.warning(f"_local_think unavailable ({_effective_model}): {type(e).__name__}: {e}")
        return (None, []) if return_context else None


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
            return _f.read()[:max_chars]
    except Exception as e:
        logger.warning(f"source_context: failed to read {candidates[0]}: {e}")
        return ""


def _local_chat(messages: list[dict], model: str | None = None,
                max_tokens: int = 4096, temperature: float = 0.2) -> str | None:
    """Call a local model with a multi-turn messages array.

    Model sees prior outputs as assistant turns — better coherence for multi-stage synthesis.
    Wall-clock enforcement lives in llamacpp_daemon.py — this function never sets its own timeout.
    """
    _m = model or _REASONING_MODEL
    _cb = _get_circuit_breaker(_m)
    if not _cb.allow():
        logger.warning(f"_local_chat REFUSED — circuit breaker OPEN for {_m}")
        return None
    _is_arbiter_request = (_llamacpp_url_for(_m) == _LLAMACPP_ARBITER_URL)
    try:
        if _is_arbiter_request:
            _set_arbiter_busy(True)
        result = _daemon_generate({
            "model": _m,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }, wall_timeout=60.0)
    finally:
        if _is_arbiter_request:
            _set_arbiter_busy(False)
    if result is None:
        _cb.record_failure(is_timeout=True)
        logger.warning(f"_local_chat wall timeout or unavailable ({_m})")
        return None
    from .synthesis_config import clean_model_output
    text = clean_model_output(result.get("response", ""))
    _cb.record_success()
    return text if text else None


def _reasoning_think(prompt: str, max_tokens: int = 8192, system: str = "",
                     temperature: float = 0.2, profile: str = "reasoning",
                     **kwargs) -> str | None:
    """Cloud cascade — quality-ranked fallback across free providers.

    profile='reasoning' (default): deep think, architecture, analysis.
        Local fallback: qwen3:30b-a3b (reasoner, GPU1 slot).
    profile='coder': structural code extraction, verified facts, file-aware.
        Local fallback: qwen3-coder:30b (coder, GPU0).

    Delegates to synthesis_reasoning.call(profile=...) which walks the matching
    ranked list. Each slot checks its own quota/RPM/circuit. Falls back to the
    local model for the profile when every ranked slot is exhausted.
    """
    from .synthesis_config import _THINK_SYSTEM
    _sys = system or _THINK_SYSTEM

    try:
        from .synthesis_reasoning import call as _ranked_call
        result = _ranked_call(prompt, system=_sys, max_tokens=max_tokens,
                              temperature=temperature, profile=profile)
        if result:
            return result
    except Exception as e:
        logger.warning(f"_reasoning_think ({profile}) dispatcher error: {type(e).__name__}: {e}")

    _fallback_model = _LOCAL_MODEL if profile == "coder" else _REASONING_MODEL
    return _local_think(prompt, max_tokens=max_tokens, model=_fallback_model,
                        system=_sys, temperature=temperature, **kwargs)


def _local_think_with_system(prompt: str, system: str, max_tokens: int = 1024,
                              model: str | None = None) -> str | None:
    """Call a local model with an explicit system prompt (no warm ctx)."""
    import urllib.request
    _m = model or _LOCAL_MODEL
    _cb = _get_circuit_breaker(_m)
    if not _cb.allow():
        logger.warning(f"_local_think_with_system REFUSED — circuit breaker OPEN for {_m}")
        return None

    payload = {
        "model": _m, "system": system, "prompt": prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.3, "num_predict": max_tokens, "num_ctx": _num_ctx_for(_m)},
    }

    result = _llamacpp_generate(payload, wall_timeout=60.0)
    if result is None:
        _cb.record_failure(is_timeout=True)
        logger.warning(f"_local_think_with_system unavailable ({_m}): llamacpp generate returned None")
        return None
    from .synthesis_config import clean_model_output
    text = clean_model_output(result.get("response", ""))
    _cb.record_success()
    return text if text else None


def compress_for_claude(text: str, max_chars: int = 600, hint: str = "") -> str:
    """Compress verbose tool output via arbiter before returning to Claude's context window.

    Preserves: file paths (src/...), signal field names, module names, numbers, action verbs.
    Strips: prose preamble, redundant explanation, verbose 'why' sections.
    Falls back to truncation if arbiter unavailable or too slow.
    """
    if len(text) <= max_chars:
        return text
    import urllib.request
    from .synthesis_warm import _warm_ctx, _warm_ctx_kb_ver
    hint_prefix = f"Context: {hint}\n\n" if hint else ""
    prompt = (
        hint_prefix +
        f"Compress the following to ≤{max_chars} characters. "
        "Preserve: file paths (src/...), signal field names, module names, numbers, "
        "and concrete action verbs. Remove: prose preamble, redundant explanation, "
        "verbose 'why' sections that repeat what the action already implies. "
        "Output the compressed version ONLY — no meta-commentary.\n\n"
        f"INPUT:\n{text[:4000]}"
    )
    payload = {
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.0, "num_predict": max(200, max_chars // 2), "num_ctx": _NUM_CTX_4B},
    }
    arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
    if arbiter_ctx and _warm_ctx_kb_ver.get(_ARBITER_MODEL) == getattr(ctx, "_kb_version", 0):
        payload["context"] = arbiter_ctx
    _cb = _get_circuit_breaker(_ARBITER_MODEL)
    if not _cb.allow():
        return text[:max_chars] + f"…(+{len(text) - max_chars} chars)"
    # Daemon-only: wall-clock enforced, no direct llama.cpp fallback.
    daemon_result = _daemon_generate(payload, wall_timeout=10)
    if daemon_result:
        from .synthesis_config import clean_model_output
        compressed = clean_model_output(daemon_result.get("response", ""))
        if compressed and len(compressed) < len(text):
            _cb.record_success()
            if len(compressed) > max_chars:
                return compressed[:max_chars] + f"…(+{len(compressed) - max_chars} chars)"
            return compressed
    return text[:max_chars] + f"…(+{len(text) - max_chars} chars)"


def extract_diff_symbols(diff_context: str, hunk_context: str = "",
                         changed_files: str = "") -> set[str]:
    """Use the arbiter to enumerate identifiers that ACTUALLY appear in a
    diff, producing an authoritative whitelist for downstream grounding.

    Motivation: the reasoning model occasionally confabulates plausible-but-
    absent symbols inside a correctly-cited file (e.g. claims a Python
    script "uses pathlib.Path.glob()" when it actually uses os.walk, or
    calls `output_tokens` an "environment variable" when it's a JSON field).
    A path-citation filter alone can't catch these because the FILE path
    is real. Solving this by (a) asking the arbiter for a constrained
    extraction pass first, then (b) passing the whitelist into the reasoning
    prompt as a grounding constraint AND into the post-synthesis filter.

    Returns a lowercased set of candidate identifiers (function names,
    variable names, quoted strings, backticked tokens). Conservative: if
    the arbiter is unavailable or the output is unparseable, falls back to
    regex-based extraction over the raw diff so the downstream filter still
    has something to check against.
    """
    source = "\n".join([changed_files or "", diff_context or "", hunk_context or ""])
    if not source.strip():
        return set()

    # Regex-based fallback — always produced, merged with arbiter output.
    # Catches most identifiers without a model round-trip, so the filter
    # keeps working even if the daemon is down.
    fallback: set[str] = set()
    import re as _re_sx
    # identifiers (snake_case, camelCase, dotted.access), 3+ chars
    for tok in _re_sx.findall(r'\b[A-Za-z_][A-Za-z0-9_.]{2,}\b', source):
        fallback.add(tok.lower())
    # quoted strings (single, double, backtick)
    for tok in _re_sx.findall(r'"([^"\n]{2,80})"|\'([^\'\n]{2,80})\'|`([^`\n]{2,80})`', source):
        for grp in tok:
            if grp:
                fallback.add(grp.strip().lower())
    # file paths (a/b/c.ext)
    for tok in _re_sx.findall(r'[\w./-]+\.(?:js|ts|py|md|json|sh|yml|yaml|html)', source):
        fallback.add(tok.lower())

    # Arbiter pass — augment with model-extracted symbols. Bounded prompt
    # size + temperature=0 keeps latency low and output deterministic.
    prompt = (
        "Extract every identifier that APPEARS VERBATIM in the following "
        "diff. Include: function names, variable names, file paths, quoted "
        "string literals, backticked tokens, config keys. One per line, no "
        "bullets, no prose, no explanation. Do NOT invent or normalize — "
        "only tokens you can point to in the diff text. Cap output at 200 "
        "lines.\n\nDIFF:\n" + source[:6000]
    )
    payload = {
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.0, "num_predict": 600, "num_ctx": _NUM_CTX_4B},
    }
    arbiter_ctx = None
    try:
        from .synthesis_warm import _warm_ctx, _warm_ctx_kb_ver
        arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
        if arbiter_ctx and _warm_ctx_kb_ver.get(_ARBITER_MODEL) == getattr(ctx, "_kb_version", 0):
            payload["context"] = arbiter_ctx
    except Exception as _wmerr:
        logging.getLogger("HME").debug(
            f"extract_diff_symbols: warm-ctx lookup skipped: {type(_wmerr).__name__}: {_wmerr}"
        )
    _cb = _get_circuit_breaker(_ARBITER_MODEL)
    if not _cb.allow():
        return fallback
    daemon_result = _daemon_generate(payload, wall_timeout=8)
    if not daemon_result:
        return fallback
    from .synthesis_config import clean_model_output
    raw = clean_model_output(daemon_result.get("response", "")) or ""
    _cb.record_success()
    extracted: set[str] = set()
    for ln in raw.splitlines():
        tok = ln.strip().strip("-*• \t`\"'")
        if not tok or len(tok) < 3:
            continue
        # Reject obvious prose-like outputs — tokens with spaces are almost
        # always fabrications ("a Python script", "the diff").
        if " " in tok and len(tok) > 40:
            continue
        extracted.add(tok.lower())
    return fallback | extracted


