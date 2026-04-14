"""Gemini 2.5 Flash synthesis tier — T3 gap-filler between local models and Claude.

Slots in ABOVE local (T0) when local quality is insufficient, using the free
Gemini 2.5 Flash tier (15 req/min, 1M tok/day free via Google AI Studio).

Fallback chain: Gemini 2.5 Flash → local (if quota hit or circuit open)

Config (env vars):
    GEMINI_API_KEY         — Google AI Studio API key (required to enable)
    GEMINI_MODEL           — default: gemini-2.5-flash-preview-05-20
    GEMINI_DAILY_LIMIT     — soft daily token cap before falling back (default: 900000)
    GEMINI_RPM_LIMIT       — requests-per-minute cap (default: 14)
"""
import json
import logging
import os
import threading
import time
import urllib.request
import urllib.error
from collections import deque

logger = logging.getLogger("HME.gemini")

# Grounding header prepended to every system prompt.
# Purpose: prevent cold-start hallucination (inventing .cpp/.py files, wrong architecture).
# HME is named explicitly because it's the analytical lens — Gemini needs to know
# it's operating as part of HME, not as a generic code assistant.
# VERIFIED FACTS contract is the most important line: cascade stage 2 already extracted
# real paths/names from source; Gemini must trust those and not override them.
_GROUNDING_HEADER = """\
You are operating as the HME (Hybrid Model Engine) synthesis tier for the Polychron project.
Polychron is a JavaScript algorithmic composition system: all source files are .js IIFEs \
under src/, organized as globals (no imports/exports). Subsystems load in order: \
utils → conductor → rhythm → time → composers → fx → crossLayer → writer → play.
HME is the evolutionary nervous system: a 6-tool MCP server that enriches queries with \
KB constraints, source code, and caller graphs before synthesis. You receive pre-extracted \
VERIFIED FACTS from real source files — treat them as ground truth.
CRITICAL: never invent file paths, function names, or module names. \
If a name does not appear in VERIFIED FACTS, do not use it.\
"""

_API_KEY = os.environ.get("GEMINI_API_KEY", "")
_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
_TIMEOUT = 60  # seconds

# Tier 1: Gemini 2.5 Flash — best quality, 1M tok/day free, 15 RPM
_MODEL_T1 = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
_DAILY_LIMIT_T1 = int(os.environ.get("GEMINI_DAILY_LIMIT", "900000"))
_RPM_LIMIT_T1 = int(os.environ.get("GEMINI_RPM_LIMIT", "14"))

# Tier 2: Gemini 2.0 Flash — overflow when T1 quota hit, 1M tok/day free, 15 RPM
_MODEL_T2 = os.environ.get("GEMINI_MODEL_T2", "gemini-2.0-flash")
_DAILY_LIMIT_T2 = int(os.environ.get("GEMINI_DAILY_LIMIT_T2", "900000"))
_RPM_LIMIT_T2 = int(os.environ.get("GEMINI_RPM_LIMIT_T2", "14"))

# ── Per-model quota + RPM state ───────────────────────────────────────────────
_quota_lock = threading.Lock()

# T1 state
_t1_tokens_used = 0
_t1_reset_ts = 0.0
_t1_timestamps: deque = deque(maxlen=_RPM_LIMIT_T1 + 5)

# T2 state
_t2_tokens_used = 0
_t2_reset_ts = 0.0
_t2_timestamps: deque = deque(maxlen=_RPM_LIMIT_T2 + 5)


def _day_start_ts() -> float:
    """UTC midnight timestamp for today."""
    import calendar
    t = time.gmtime()
    return calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))


def _reset_tier(used_ref: list, reset_ref: list) -> None:
    today = _day_start_ts()
    if today > reset_ref[0]:
        used_ref[0] = 0
        reset_ref[0] = today


# Mutable containers so inner functions can mutate scalar state
_t1_used = [0]; _t1_rst = [0.0]
_t2_used = [0]; _t2_rst = [0.0]


def _quota_ok_t1() -> bool:
    with _quota_lock:
        _reset_tier(_t1_used, _t1_rst)
        return _t1_used[0] < _DAILY_LIMIT_T1


def _quota_ok_t2() -> bool:
    with _quota_lock:
        _reset_tier(_t2_used, _t2_rst)
        return _t2_used[0] < _DAILY_LIMIT_T2


def _record_usage_t1(tokens: int) -> None:
    with _quota_lock:
        _t1_used[0] += tokens
        _t1_timestamps.append(time.monotonic())


def _record_usage_t2(tokens: int) -> None:
    with _quota_lock:
        _t2_used[0] += tokens
        _t2_timestamps.append(time.monotonic())


def _rpm_wait_for(timestamps: deque, limit: int, label: str) -> None:
    """Block until an RPM slot is available for the given tier."""
    while True:
        now = time.monotonic()
        cutoff = now - 60.0
        recent = sum(1 for ts in timestamps if ts > cutoff)
        if recent < limit:
            return
        oldest = min((ts for ts in timestamps if ts > cutoff), default=now)
        wait = max(0.1, oldest + 60.0 - now)
        logger.debug(f"Gemini {label} RPM throttle: {recent}/{limit} — sleeping {wait:.1f}s")
        time.sleep(min(wait, 5.0))


def get_quota_status() -> dict:
    with _quota_lock:
        _reset_tier(_t1_used, _t1_rst)
        _reset_tier(_t2_used, _t2_rst)
        t1_ok = _t1_used[0] < _DAILY_LIMIT_T1
        t2_ok = _t2_used[0] < _DAILY_LIMIT_T2
        return {
            "t1_model": _MODEL_T1,
            "t1_tokens_used": _t1_used[0],
            "t1_daily_limit": _DAILY_LIMIT_T1,
            "t1_pct_used": round(_t1_used[0] / _DAILY_LIMIT_T1 * 100, 1),
            "t1_available": t1_ok,
            "t2_model": _MODEL_T2,
            "t2_tokens_used": _t2_used[0],
            "t2_daily_limit": _DAILY_LIMIT_T2,
            "t2_pct_used": round(_t2_used[0] / _DAILY_LIMIT_T2 * 100, 1),
            "t2_available": t2_ok,
            "any_available": t1_ok or t2_ok,
        }


# ── Per-tier circuit breakers ─────────────────────────────────────────────────
_CB_THRESHOLD = 3
_CB_COOLDOWN = 300

_cb_lock = threading.Lock()
_t1_cb_failures = 0; _t1_cb_open_until = 0.0
_t2_cb_failures = 0; _t2_cb_open_until = 0.0


def _cb_allow_t1() -> bool:
    with _cb_lock:
        return _t1_cb_open_until <= time.monotonic()


def _cb_allow_t2() -> bool:
    with _cb_lock:
        return _t2_cb_open_until <= time.monotonic()


def _cb_success_t1() -> None:
    global _t1_cb_failures
    with _cb_lock:
        _t1_cb_failures = 0


def _cb_success_t2() -> None:
    global _t2_cb_failures
    with _cb_lock:
        _t2_cb_failures = 0


def _cb_failure_t1() -> None:
    global _t1_cb_failures, _t1_cb_open_until
    with _cb_lock:
        _t1_cb_failures += 1
        if _t1_cb_failures >= _CB_THRESHOLD:
            _t1_cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(f"Gemini T1 ({_MODEL_T1}) circuit breaker OPEN for {_CB_COOLDOWN}s")


def _cb_failure_t2() -> None:
    global _t2_cb_failures, _t2_cb_open_until
    with _cb_lock:
        _t2_cb_failures += 1
        if _t2_cb_failures >= _CB_THRESHOLD:
            _t2_cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(f"Gemini T2 ({_MODEL_T2}) circuit breaker OPEN for {_CB_COOLDOWN}s")


# ── Core REST call ────────────────────────────────────────────────────────────

def _call_model(model: str, prompt: str, system: str,
                max_tokens: int, temperature: float) -> str | None:
    """Raw call to a specific Gemini model. No quota/CB logic — caller handles that."""
    full_system = _GROUNDING_HEADER + ("\n\n" + system if system else "")
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": full_system}]},
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    url = f"{_BASE_URL}/{model}:generateContent?key={_API_KEY}"
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
        candidates = data.get("candidates", [])
        if not candidates:
            return None
        text = "".join(p.get("text", "") for p in candidates[0].get("content", {}).get("parts", []))
        return text.strip() or None
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="ignore")[:200]
        logger.warning(f"Gemini {model} HTTP {e.code}: {err}")
        raise
    except Exception as e:
        logger.warning(f"Gemini {model} failed: {type(e).__name__}: {e}")
        raise


# ── Public API ────────────────────────────────────────────────────────────────

def available() -> bool:
    """True if any Gemini tier has quota and an open circuit."""
    if not _API_KEY:
        return False
    return (_quota_ok_t1() and _cb_allow_t1()) or (_quota_ok_t2() and _cb_allow_t2())


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3) -> str | None:
    """
    Call Gemini with automatic T1→T2→None tier cascade.

    T1 (gemini-2.5-flash): tried first — best quality, 1M tok/day free.
    T2 (gemini-2.0-flash): overflow when T1 quota hit or circuit open.
    Returns None when both tiers exhausted — caller falls back to local.
    """
    if not _API_KEY:
        return None

    full_system = _GROUNDING_HEADER + ("\n\n" + system if system else "")

    # ── T1: Gemini 2.5 Flash ──
    if _quota_ok_t1() and _cb_allow_t1():
        _rpm_wait_for(_t1_timestamps, _RPM_LIMIT_T1, "T1")
        try:
            text = _call_model(_MODEL_T1, prompt, system, max_tokens, temperature)
            if text:
                usage_tokens = max_tokens  # conservative estimate; real usage from metadata below
                # Re-fetch usage from last response isn't possible here without refactoring,
                # so estimate conservatively: prompt ~500 + output max_tokens
                _record_usage_t1(500 + max_tokens)
                _cb_success_t1()
                logger.info(f"Gemini T1: ~{500+max_tokens} tokens (daily: {_t1_used[0]}/{_DAILY_LIMIT_T1})")
                return text
            _cb_failure_t1()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                _cb_failure_t1()
            logger.info(f"Gemini T1 failed ({e.code}), trying T2")
        except Exception:
            _cb_failure_t1()
            logger.info("Gemini T1 failed, trying T2")
    else:
        reason = "quota" if not _quota_ok_t1() else "circuit open"
        logger.info(f"Gemini T1 unavailable ({reason}), trying T2")

    # ── T2: Gemini 2.0 Flash ──
    if _quota_ok_t2() and _cb_allow_t2():
        _rpm_wait_for(_t2_timestamps, _RPM_LIMIT_T2, "T2")
        try:
            text = _call_model(_MODEL_T2, prompt, system, max_tokens, temperature)
            if text:
                _record_usage_t2(500 + max_tokens)
                _cb_success_t2()
                logger.info(f"Gemini T2: ~{500+max_tokens} tokens (daily: {_t2_used[0]}/{_DAILY_LIMIT_T2})")
                return text
            _cb_failure_t2()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                _cb_failure_t2()
            logger.info(f"Gemini T2 failed ({e.code}), falling back to local")
        except Exception:
            _cb_failure_t2()
            logger.info("Gemini T2 failed, falling back to local")
    else:
        reason = "quota" if not _quota_ok_t2() else "circuit open"
        logger.info(f"Gemini T2 unavailable ({reason}), falling back to local")

    return None
