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

_API_KEY = os.environ.get("GEMINI_API_KEY", "")
_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
_DAILY_TOKEN_LIMIT = int(os.environ.get("GEMINI_DAILY_LIMIT", "900000"))
_RPM_LIMIT = int(os.environ.get("GEMINI_RPM_LIMIT", "14"))
_TIMEOUT = 60  # seconds

# ── Quota tracking ────────────────────────────────────────────────────────────
_quota_lock = threading.Lock()
_tokens_used_today = 0
_quota_reset_ts = 0.0   # midnight UTC of current day
_request_timestamps: deque = deque(maxlen=_RPM_LIMIT + 5)  # for RPM throttle


def _day_start_ts() -> float:
    """UTC midnight timestamp for today."""
    import calendar
    t = time.gmtime()
    return calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))


def _reset_if_new_day() -> None:
    global _tokens_used_today, _quota_reset_ts
    today = _day_start_ts()
    if today > _quota_reset_ts:
        _tokens_used_today = 0
        _quota_reset_ts = today


def _record_usage(tokens: int) -> None:
    global _tokens_used_today
    with _quota_lock:
        _reset_if_new_day()
        _tokens_used_today += tokens
        _request_timestamps.append(time.monotonic())


def _quota_ok() -> bool:
    with _quota_lock:
        _reset_if_new_day()
        return _tokens_used_today < _DAILY_TOKEN_LIMIT


def _rpm_wait() -> None:
    """Block up to 60s until RPM slot is available."""
    while True:
        now = time.monotonic()
        cutoff = now - 60.0
        # Count requests in last 60s
        recent = sum(1 for ts in _request_timestamps if ts > cutoff)
        if recent < _RPM_LIMIT:
            return
        oldest = min((ts for ts in _request_timestamps if ts > cutoff), default=now)
        wait = max(0.1, oldest + 60.0 - now)
        logger.debug(f"Gemini RPM throttle: {recent}/{_RPM_LIMIT} — sleeping {wait:.1f}s")
        time.sleep(min(wait, 5.0))


def get_quota_status() -> dict:
    with _quota_lock:
        _reset_if_new_day()
        return {
            "tokens_used": _tokens_used_today,
            "daily_limit": _DAILY_TOKEN_LIMIT,
            "pct_used": round(_tokens_used_today / _DAILY_TOKEN_LIMIT * 100, 1),
            "available": _tokens_used_today < _DAILY_TOKEN_LIMIT,
            "model": _MODEL,
        }


# ── Circuit breaker ────────────────────────────────────────────────────────────
_cb_lock = threading.Lock()
_cb_failures = 0
_cb_open_until = 0.0
_CB_THRESHOLD = 3     # open after N consecutive failures
_CB_COOLDOWN = 300    # 5 min before retrying


def _cb_allow() -> bool:
    with _cb_lock:
        if _cb_open_until > time.monotonic():
            return False
        return True


def _cb_success() -> None:
    global _cb_failures
    with _cb_lock:
        _cb_failures = 0


def _cb_failure() -> None:
    global _cb_failures, _cb_open_until
    with _cb_lock:
        _cb_failures += 1
        if _cb_failures >= _CB_THRESHOLD:
            _cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(f"Gemini circuit breaker OPEN for {_CB_COOLDOWN}s")


# ── Core call ─────────────────────────────────────────────────────────────────

def available() -> bool:
    """True if Gemini tier is configured, quota remains, and circuit is closed."""
    return bool(_API_KEY) and _quota_ok() and _cb_allow()


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3) -> str | None:
    """
    Call Gemini 2.5 Flash. Returns response text or None on failure.
    Handles RPM throttle, quota tracking, and circuit breaker automatically.
    """
    if not _API_KEY:
        return None
    if not _quota_ok():
        logger.info(f"Gemini daily quota reached ({_tokens_used_today}/{_DAILY_TOKEN_LIMIT} tokens)")
        return None
    if not _cb_allow():
        logger.debug("Gemini circuit breaker open — skipping")
        return None

    _rpm_wait()

    url = f"{_BASE_URL}/{_MODEL}:generateContent?key={_API_KEY}"

    contents = [{"role": "user", "parts": [{"text": prompt}]}]
    body: dict = {
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        },
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())

        # Extract text
        candidates = data.get("candidates", [])
        if not candidates:
            logger.warning("Gemini: no candidates in response")
            _cb_failure()
            return None

        text = ""
        for part in candidates[0].get("content", {}).get("parts", []):
            text += part.get("text", "")

        if not text:
            logger.warning("Gemini: empty text in response")
            _cb_failure()
            return None

        # Track usage
        usage = data.get("usageMetadata", {})
        total_tokens = usage.get("totalTokenCount", max_tokens)
        _record_usage(total_tokens)
        _cb_success()

        logger.info(f"Gemini: {total_tokens} tokens used (daily: {_tokens_used_today}/{_DAILY_TOKEN_LIMIT})")
        return text.strip()

    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="ignore")[:300]
        if e.code == 429:
            logger.warning(f"Gemini 429 rate limit: {body_text}")
            # Don't trip CB for rate limits — just let RPM throttle handle it
        elif e.code in (401, 403):
            logger.error(f"Gemini auth error {e.code}: {body_text}")
            _cb_failure()
        else:
            logger.warning(f"Gemini HTTP {e.code}: {body_text}")
            _cb_failure()
        return None
    except Exception as e:
        logger.warning(f"Gemini call failed: {type(e).__name__}: {e}")
        _cb_failure()
        return None
