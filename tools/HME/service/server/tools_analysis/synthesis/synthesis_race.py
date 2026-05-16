"""Local model inference API -- _local_think, _local_chat, compress_for_claude.

Split from synthesis_llamacpp.py for maintainability. All functions here
use the core infrastructure (circuit breaker, daemon routing, env config)
from synthesis_llamacpp.
"""
import json
import os
import re
import logging
import threading as _threading

from hme_env import ENV
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
# synthesis_inference imports US at line 371 -- top-level back-import would
# partial-load. Lazy lookup at call time keeps bare-name resolution working.
def _local_think(*a, **kw):
    from . import synthesis_inference as _si
    return _si._local_think(*a, **kw)

logger = logging.getLogger("HME")

# English prose + language-keyword stop-words used by extract_diff_symbols


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
        path = _os.path.join(ENV.require("METRICS_DIR"), "hme-race-outcomes.jsonl")
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
        # silent-ok: optional fallback path.
        return _RACE_CLOUD_DELAY_DEFAULT_SEC


# Legacy constant name -- now defers to _adaptive_cloud_delay() at call site.
_RACE_CLOUD_DELAY_SEC = _RACE_CLOUD_DELAY_DEFAULT_SEC


def _reasoning_think(prompt: str, max_tokens: int = 8192, system: str = "",
                     temperature: float = 0.2, profile: str = "reasoning",
                     race_short: bool = True,
                     **kwargs) -> str | None:
    """Cloud cascade -- quality-ranked fallback across free providers, with
    optional race-mode for short requests.

    profile='reasoning' (default): deep think, architecture, analysis.
        Local fallback: qwen3:30b-a3b (reasoner, GPU1 slot).
    profile='coder': structural code extraction, verified facts, file-aware.
        Local fallback: qwen3-coder:30b (coder, GPU0).

    Default path (long requests / race_short=False):
        Delegates to synthesis_reasoning.call(profile=...) which walks the
        ranked cloud list. Falls back to local when every cloud slot is
        exhausted. Pays cloud latency (10-15s) but gets frontier quality.

    Race path (race_short=True AND max_tokens <= _RACE_MAX_TOKENS):
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
    tuning is visible over time -- previously we fired races blind."""
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
            # silent-ok: optional fallback path.
            break
        if result:
            winner_source = source
            winner_result = result
            break
        # Empty result from this racer -- keep waiting for the other.
    if winner_result:
        logger.info(f"race winner: {winner_source} ({len(winner_result)}c, profile={profile})")
        _emit_race_outcome(profile, max_tokens, winner_source, latencies, bool(winner_result))
        return winner_result
    # Both racers returned empty -- final safety-net local call (no delay,
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
        from common import maybe_trim_append
        from server import context as _ctx
        out_dir = ENV.require("METRICS_DIR")
        _os.makedirs(out_dir, exist_ok=True)
        out = _os.path.join(out_dir, "hme-race-outcomes.jsonl")
        entry = {
            "ts": _time.time(),
            "profile": profile,
            "max_tokens": max_tokens,
            "winner": winner or "unknown",
            "had_result": had_result,
            # Presence-first then index -- avoids the .get-with-default pattern
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
        logger.warning(f"_local_think_with_system REFUSED -- circuit breaker OPEN for {_m}")
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


