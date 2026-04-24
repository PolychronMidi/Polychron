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

# English prose + language-keyword stop-words used by extract_diff_symbols
# to drop plain lowercase regex hits that have no identifier structure.
# Without this filter, docstring prose words ("the / its / own / across /
# whether / why") and Python keywords ("import / not / from") were landing
# in the "Allowed symbols" whitelist and polluting the reviewer prompt.
_PROSE_AND_KEYWORD_STOPWORDS = frozenset({
    # articles, conjunctions, prepositions, pronouns
    "the", "and", "but", "for", "nor", "yet", "not", "its", "our", "out",
    "own", "any", "all", "are", "was", "were", "been", "has", "had",
    "have", "from", "into", "onto", "upon", "with", "without", "about",
    "above", "across", "after", "again", "against", "along", "among",
    "around", "before", "behind", "below", "beneath", "beside", "between",
    "beyond", "during", "except", "inside", "outside", "over", "through",
    "throughout", "under", "until", "within", "this", "that", "these",
    "those", "there", "here", "where", "when", "which", "what", "whose",
    "whether", "while", "why", "how", "who", "whom", "than", "then",
    "because", "though", "although", "since", "unless", "until", "whenever",
    "wherever", "whereas", "whoever", "whatever", "both", "each", "every",
    "either", "neither", "some", "many", "most", "much", "few", "fewer",
    "none", "just", "also", "only", "such", "very", "quite",
    # generic verbs/adjectives commonly in docstrings
    "adapts", "actually", "applies", "applied", "awareness", "building",
    "causal", "changed", "checkpoints", "coherence", "compaction",
    "context", "conversation", "counterfactual", "diff", "effectiveness",
    "entanglement", "environmental", "extrospective", "facing", "hunks",
    "interventions", "layers", "lines", "load", "memory", "model",
    "narrator", "outcomes", "outward", "persists", "predicted",
    "prescriptive", "prevented", "reasoning", "relevant", "restarts",
    "self", "space", "state", "survives", "synthesizes", "system",
    "tracks", "file", "lib", "disk", "host",
    # Python keywords + common stdlib names we'd rather drop from the
    # whitelist unless the model genuinely uses them as identifiers
    "import", "from", "def", "return", "pass", "raise", "yield", "async",
    "await", "class", "global", "nonlocal", "lambda", "continue", "break",
    "true", "false", "none", "null",
    # misc words we saw dirty the whitelist in production reviews
    "python", "index", "git", "gpu", "home", "jah", "binary", "newline",
    "marker", "raw", "body", "source", "str", "tok", "keep",
})


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


# Race-mode threshold. Requests asking for ≤ RACE_MAX_TOKENS tokens are
# short enough that the local reasoner can answer them in ≤ ~2s on a warm
# GPU, while the cloud cascade adds ≥10s of slot-walking latency. For
# short requests we RACE both — fire them in parallel and take whichever
# returns first. Long requests keep the cloud-first path for quality.
_RACE_MAX_TOKENS = 800
_RACE_CLOUD_DELAY_DEFAULT_SEC = 2.5
_RACE_CLOUD_DELAY_MIN = 1.0
_RACE_CLOUD_DELAY_MAX = 6.0


def _adaptive_cloud_delay() -> float:
    """Read recent race outcomes and adapt cloud-delay to observed local p50.

    Heuristic: cloud should fire ~0.5s AFTER local's typical finish time.
    That gives local a clean shot to win when healthy; cloud only kicks
    in when local genuinely stalls. If local p50 (last 100 races) is
    1.8s, delay = 2.3s. Clamped to [_MIN, _MAX] so pathological logs
    can't push the delay to 0 or 60s.

    Falls back to _RACE_CLOUD_DELAY_DEFAULT_SEC when no history exists."""
    try:
        import json as _json
        import os as _os
        from server import context as _ctx
        path = _os.path.join(
            _os.environ.get("METRICS_DIR") or _os.path.join(
                getattr(_ctx, "PROJECT_ROOT", "."), "output", "metrics"),
            "hme-race-outcomes.jsonl")
        if not _os.path.isfile(path):
            return _RACE_CLOUD_DELAY_DEFAULT_SEC
        size = _os.path.getsize(path)
        read_from = max(0, size - 64 * 1024)
        with open(path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()
            data = f.read().decode("utf-8", errors="replace")
        local_latencies: list[float] = []
        for line in data.splitlines():
            if not line.strip():
                continue
            try:
                e = _json.loads(line)
            except _json.JSONDecodeError:
                continue
            lm = e.get("local_ms")
            if isinstance(lm, (int, float)) and lm > 0:
                local_latencies.append(float(lm) / 1000.0)
        if len(local_latencies) < 10:
            return _RACE_CLOUD_DELAY_DEFAULT_SEC
        local_latencies.sort()
        p50 = local_latencies[len(local_latencies) // 2]
        # +0.5s head-start gives local a reliable win when healthy.
        candidate = p50 + 0.5
        return max(_RACE_CLOUD_DELAY_MIN, min(_RACE_CLOUD_DELAY_MAX, candidate))
    except Exception:
        return _RACE_CLOUD_DELAY_DEFAULT_SEC


# Legacy constant name — now defers to _adaptive_cloud_delay() at call site.
_RACE_CLOUD_DELAY_SEC = _RACE_CLOUD_DELAY_DEFAULT_SEC


def _reasoning_think(prompt: str, max_tokens: int = 8192, system: str = "",
                     temperature: float = 0.2, profile: str = "reasoning",
                     race_short: bool = True,
                     **kwargs) -> str | None:
    """Cloud cascade — quality-ranked fallback across free providers, with
    optional race-mode for short requests.

    profile='reasoning' (default): deep think, architecture, analysis.
        Local fallback: qwen3:30b-a3b (reasoner, GPU1 slot).
    profile='coder': structural code extraction, verified facts, file-aware.
        Local fallback: qwen3-coder:30b (coder, GPU0).

    Default path (long requests / race_short=False):
        Delegates to synthesis_reasoning.call(profile=...) which walks the
        ranked cloud list. Falls back to local when every cloud slot is
        exhausted. Pays cloud latency (10-15s) but gets frontier quality.

    Race path (race_short=True AND max_tokens ≤ _RACE_MAX_TOKENS):
        Fires local + cloud in parallel with a cloud head-start delay.
        Returns whichever finishes first; cancellation of the loser is
        best-effort (the winner's thread completes its response, the
        loser's may continue running but its result is discarded).
        Recovers local's <2s floor when cloud would have overpaid.
    """
    from .synthesis_config import _THINK_SYSTEM
    _sys = system or _THINK_SYSTEM
    _fallback_model = _LOCAL_MODEL if profile == "coder" else _REASONING_MODEL

    # Race-mode eligibility: small token budget + caller opted in.
    if race_short and max_tokens <= _RACE_MAX_TOKENS:
        return _race_local_vs_cloud(prompt, _sys, max_tokens, temperature,
                                     profile, _fallback_model, **kwargs)

    # Default: cloud cascade first, local fallback.
    try:
        from .synthesis_reasoning import call as _ranked_call
        result = _ranked_call(prompt, system=_sys, max_tokens=max_tokens,
                              temperature=temperature, profile=profile)
        if result:
            return result
    except Exception as e:
        logger.warning(f"_reasoning_think ({profile}) dispatcher error: {type(e).__name__}: {e}")

    return _local_think(prompt, max_tokens=max_tokens, model=_fallback_model,
                        system=_sys, temperature=temperature, **kwargs)


def _race_local_vs_cloud(prompt: str, system: str, max_tokens: int,
                          temperature: float, profile: str,
                          fallback_model: str, **kwargs) -> str | None:
    """Fire local + cloud in parallel. Local runs immediately; cloud is
    delayed by _RACE_CLOUD_DELAY_SEC so it only kicks in when local
    genuinely stalls. Returns the first non-empty result. Emits a
    telemetry line to hme-race-outcomes.jsonl so the 2.5s cloud-delay
    tuning is visible over time — previously we fired races blind."""
    import threading
    import queue
    import time as _t
    q: queue.Queue = queue.Queue(maxsize=2)
    t0 = _t.monotonic()
    latencies: dict[str, float] = {}

    def _local_worker() -> None:
        try:
            r = _local_think(prompt, max_tokens=max_tokens,
                             model=fallback_model, system=system,
                             temperature=temperature, **kwargs)
            latencies["local"] = _t.monotonic() - t0
            q.put(("local", r))
        except Exception as e:
            latencies["local"] = _t.monotonic() - t0
            q.put(("local", None))
            logger.debug(f"race local worker error: {type(e).__name__}: {e}")

    _delay = _adaptive_cloud_delay()

    def _cloud_worker() -> None:
        # Head-start delay: adaptive per observed local p50 + buffer.
        _t.sleep(_delay)
        try:
            from .synthesis_reasoning import call as _ranked_call
            r = _ranked_call(prompt, system=system, max_tokens=max_tokens,
                             temperature=temperature, profile=profile)
            latencies["cloud"] = _t.monotonic() - t0
            q.put(("cloud", r))
        except Exception as e:
            latencies["cloud"] = _t.monotonic() - t0
            q.put(("cloud", None))
            logger.debug(f"race cloud worker error: {type(e).__name__}: {e}")

    t_local = threading.Thread(target=_local_worker, daemon=True, name="race-local")
    t_cloud = threading.Thread(target=_cloud_worker, daemon=True, name="race-cloud")
    t_local.start()
    t_cloud.start()

    # Collect up to 2 results. Return the first non-empty; if first is
    # empty, wait for the other (it might succeed where the first didn't).
    winner_source: str | None = None
    winner_result: str | None = None
    for _ in range(2):
        try:
            source, result = q.get(timeout=60.0)
        except Exception:
            break
        if result:
            winner_source = source
            winner_result = result
            break
        # Empty result from this racer — keep waiting for the other.
    if winner_result:
        logger.info(f"race winner: {winner_source} ({len(winner_result)}c, profile={profile})")
        _emit_race_outcome(profile, max_tokens, winner_source, latencies, bool(winner_result))
        return winner_result
    # Both racers returned empty — final safety-net local call (no delay,
    # no parallel fire, direct path). Fires if both workers returned None.
    logger.warning(f"race both-empty fallback (profile={profile})")
    _emit_race_outcome(profile, max_tokens, "both_empty", latencies, False)
    return _local_think(prompt, max_tokens=max_tokens, model=fallback_model,
                        system=system, temperature=temperature, **kwargs)


def _emit_race_outcome(profile: str, max_tokens: int, winner: str | None,
                       latencies: dict, had_result: bool) -> None:
    """Append one JSONL line to output/metrics/hme-race-outcomes.jsonl so
    `status mode=race_stats` can summarize local-vs-cloud win rates over
    time. Bounded-logged via common.bounded_log."""
    import json as _json
    import os as _os
    import time as _time
    try:
        from common.bounded_log import maybe_trim_append
        from server import context as _ctx
        out_dir = _os.environ.get("METRICS_DIR") or _os.path.join(
            getattr(_ctx, "PROJECT_ROOT", "."), "output", "metrics")
        _os.makedirs(out_dir, exist_ok=True)
        out = _os.path.join(out_dir, "hme-race-outcomes.jsonl")
        entry = {
            "ts": _time.time(),
            "profile": profile,
            "max_tokens": max_tokens,
            "winner": winner or "unknown",
            "had_result": had_result,
            # Presence-first then index — avoids the .get-with-default pattern
            # that hides a missing key as 0 (would be indistinguishable from
            # a legitimate ~0ms latency).
            "local_ms": int(latencies["local"] * 1000) if "local" in latencies else None,
            "cloud_ms": int(latencies["cloud"] * 1000) if "cloud" in latencies else None,
        }
        with open(out, "a") as f:
            f.write(_json.dumps(entry) + "\n")
        maybe_trim_append(out, max_lines=10_000)
    except Exception as _err:
        logger.debug(f"race outcome emit failed: {type(_err).__name__}: {_err}")


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


def filter_ungrounded_bullets(synthesis: str, source_text: str,
                              symbol_whitelist: set | None = None,
                              log_label: str = "synthesis") -> str:
    """Drop LLM synthesis bullets whose cited identifiers are not grounded
    in the source material. Generalization of workflow_audit's
    _drop_hallucinated_bullets — any adaptive-synthesis call site can
    pipe its output through this filter to suppress the "correctly-cites-
    file, invents-symbol" hallucination class.

    Two layers:
      1. FILE PATHS — must appear in source_text verbatim. Citing a file
         that isn't in the source is pure invention.
      2. BACKTICKED IDENTIFIERS — each backticked token must appear in
         source_text OR in symbol_whitelist (arbiter-extracted set from
         extract_diff_symbols). Supports dotted-access component-wise
         check for `foo.bar.baz`.

    Bullets with zero refs (pure prose) pass. On parse error: return
    synthesis unchanged (fail-open, never make synthesis WORSE).
    """
    if not synthesis:
        return synthesis
    try:
        import re as _re
        source_blob = (source_text or "").lower()
        whitelist = {s.lower() for s in (symbol_whitelist or set())}
        lines = synthesis.split("\n")
        bullets: list[list[str]] = []
        current: list[str] = []
        bullet_head = _re.compile(
            r'^(?:\s*\*\*\d+\.|\s*\d+\.|\s*[-*]\s|\s*\*\*[A-Z][^*]*\*\*)'
        )
        for ln in lines:
            if bullet_head.match(ln) and current:
                bullets.append(current)
                current = [ln]
            else:
                current.append(ln)
        if current:
            bullets.append(current)

        path_re = _re.compile(r'[\w./-]+\.(?:js|ts|py|md|json|sh|yml|yaml|html)')
        tick_re = _re.compile(r'`([^`\n]{3,120})`')
        _log = logging.getLogger("HME")
        kept: list[str] = []
        for b in bullets:
            text = "\n".join(b)
            paths = [p.strip().lower() for p in path_re.findall(text) if p.strip()]
            ticks = [s.strip().lower() for s in tick_re.findall(text) if s.strip()]

            bad_paths = [p for p in paths if p not in source_blob]
            if bad_paths:
                _log.info(f"{log_label}: dropped bullet, unreferenced path(s) {bad_paths[:3]}")
                continue

            if ticks and (whitelist or source_blob.strip()):
                ungrounded = []
                for t in ticks:
                    bare = t.rstrip("()[]{},.;:!?")
                    if bare in source_blob or bare in whitelist:
                        continue
                    parts = [p for p in bare.split(".") if len(p) >= 3]
                    if parts and all(
                        (p in source_blob) or (p in whitelist) for p in parts
                    ):
                        continue
                    ungrounded.append(bare)
                if ungrounded:
                    _log.info(f"{log_label}: dropped bullet, ungrounded identifier(s) {ungrounded[:3]}")
                    continue
            kept.extend(b)
        filtered = "\n".join(kept).strip()
        return filtered if filtered else synthesis
    except Exception as _fe:
        logging.getLogger("HME").debug(
            f"filter_ungrounded_bullets: filter skipped: {type(_fe).__name__}: {_fe}"
        )
        return synthesis


def ground_synthesis(synthesis: str, source_text: str,
                     log_label: str = "synthesis") -> str:
    """One-shot convenience: extract symbols from source_text via arbiter
    (with regex fallback), then filter synthesis bullets against that
    whitelist + raw source. Use this at any adaptive-synthesis site that
    can hallucinate identifiers — e.g. `diagnose_error`, `module_story`,
    `tools_knowledge` cluster analysis, `drama_map`, etc.

    Call shape: `synthesis = ground_synthesis(synthesis, source_text,
    log_label="diagnose_error")`.
    """
    if not synthesis or not source_text:
        return synthesis
    whitelist = extract_diff_symbols(source_text, "", "")
    return filter_ungrounded_bullets(synthesis, source_text,
                                     symbol_whitelist=whitelist,
                                     log_label=log_label)


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
    # Strip diff metadata BEFORE extraction so git noise doesn't pollute
    # the whitelist. The noise that landed in production reviews:
    #   - diff --git a/... b/...     (path headers with a/, b/ prefixes)
    #   - index 7c169164..fdd82f1d   (SHA hashes leak through the digit filter)
    #   - --- a/file / +++ b/file    (file markers)
    #   - @@ -N,M +N,M @@            (hunk headers)
    # Only lines that represent actual code changes (+/-) or filenames
    # contribute tokens. Context lines (leading space) skipped too: they
    # are prose-heavy (docstrings around the hunk) and not part of the
    # change itself.
    import re as _re_sx

    def _strip_diff_noise(raw: str) -> str:
        kept = []
        for ln in (raw or "").splitlines():
            if not ln:
                continue
            if ln.startswith(('diff --git', 'index ', '--- ', '+++ ',
                              '@@', 'Binary files', '\\ No newline')):
                continue
            if ln.startswith(('+', '-')):
                body = ln[1:]  # strip the +/- marker
                # Drop comment lines — they're prose-heavy and would
                # pollute the whitelist with every English word in the
                # author's explanation ("accept", "actual", "covers",
                # "production", "reviews"…). Language-agnostic heuristic:
                # a line whose first non-space chars are a comment prefix.
                stripped = body.lstrip()
                if stripped.startswith(('#', '//', '/*', '*', '--')):
                    continue
                kept.append(body)
        return "\n".join(kept)

    diff_code_only = _strip_diff_noise(diff_context or "")
    source = "\n".join([changed_files or "", diff_code_only])
    if not source.strip():
        return set()

    # Regex-based fallback — always produced, merged with arbiter output.
    # Catches most identifiers without a model round-trip, so the filter
    # keeps working even if the daemon is down.
    fallback: set[str] = set()

    def _looks_identifier(tok: str) -> bool:
        # Reject stop-words + language keywords (English prose,
        # "import/the/why/across"). Accept plain lowercase single words
        # too: `json`, `shutil`, `os`, `sys`, `threading` etc. are real
        # module names. The stop-word list is the primary filter here;
        # structural hints (underscore/dot/case/digit) are secondary.
        if tok.lower() in _PROSE_AND_KEYWORD_STOPWORDS:
            return False
        # Drop regex-fragment / metadata noise: anything containing
        # obvious non-identifier characters is garbage from the source.
        # `@` rejects git hunk markers like `@@`. Do NOT reject on `/` —
        # real file paths (tools/HME/foo.py) must pass this filter.
        if any(c in tok for c in '\\[](){}<>^$|?*+=@'):
            return False
        # Drop pure-hex-looking git SHA fragments (7-40 hex chars, no
        # non-hex letters). Covers `fdd82f1d`, `7c169164`, `61c94716`.
        if 6 <= len(tok) <= 40 and all(c in '0123456789abcdef' for c in tok.lower()):
            return False
        return True

    # identifiers (snake_case, camelCase, dotted.access), 3+ chars
    for tok in _re_sx.findall(r'\b[A-Za-z_][A-Za-z0-9_.]{2,}\b', source):
        if _looks_identifier(tok):
            fallback.add(tok.lower())
    # code-shaped quoted strings only: reject anything containing a space
    # (those are prose sentences, not code literals like "utf-8" or ".env")
    for tok in _re_sx.findall(r'"([^"\n]{2,40})"|\'([^\'\n]{2,40})\'|`([^`\n]{2,40})`', source):
        for grp in tok:
            if grp and ' ' not in grp and _looks_identifier(grp.strip()):
                fallback.add(grp.strip().lower())
    # file paths (a/b/c.ext) — strip git a/ b/ prefixes that survive
    # because changed_files and diff headers reference them.
    for tok in _re_sx.findall(r'[\w./-]+\.(?:js|ts|py|md|json|sh|yml|yaml|html)', source):
        _path = _re_sx.sub(r'^[ab]/', '', tok.lower())
        if _looks_identifier(_path):
            fallback.add(_path)

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
        return {t for t in fallback if _looks_identifier(t)}
    daemon_result = _daemon_generate(payload, wall_timeout=8)
    if not daemon_result:
        return {t for t in fallback if _looks_identifier(t)}
    from .synthesis_config import clean_model_output
    raw = clean_model_output(daemon_result.get("response", "")) or ""
    _cb.record_success()
    extracted: set[str] = set()
    for ln in raw.splitlines():
        tok = ln.strip().strip("-*• \t`\"'")
        if not tok or len(tok) < 3:
            continue
        # Reject outputs with spaces — those are fabricated prose
        # ("a Python script", "the diff"), not identifiers.
        if " " in tok:
            continue
        # Apply the same structural filter as the fallback path. Without
        # this, the LLM arbiter was shoving `import`, `file`, `the`, `why`,
        # git SHAs like `fdd82f1d`, regex fragments, and hunk markers into
        # the whitelist — all the junk the post-filter is supposed to
        # reject for the reasoning model's output.
        if not _looks_identifier(tok):
            continue
        extracted.add(tok.lower())
    # Final sweep: post-filter the UNION too, in case _looks_identifier
    # changes later or the fallback regex somehow accepted a stop-word.
    merged = {t for t in (fallback | extracted) if _looks_identifier(t)}
    return merged


