"""OpenRouter synthesis tier — free :free-suffix models via OpenAI-compatible endpoint.

OpenRouter aggregates many providers; models with ":free" suffix are genuinely
free with rate limits. Free tier: ~20 RPM, ~200 RPD per account (shared across
all :free models).

Free tier cascade (best-first):
    T1: deepseek/deepseek-r1:free            — full DeepSeek R1, top-tier reasoning
    T2: meta-llama/llama-3.3-70b-instruct:free — Meta 70B general fallback

Returns None when RPD exhausted — caller cascades to next provider / local.

Config (env vars):
    OPENROUTER_API_KEY   — required to enable
    OPENROUTER_MODEL_T1  — override T1
    OPENROUTER_MODEL_T2  — override T2
    OPENROUTER_RPD_LIMIT — account-wide RPD cap (default: 200, shared across tiers)
    OPENROUTER_RPM_LIMIT — account-wide RPM cap (default: 18)
"""
import json
import logging
import os
import threading
import time
import urllib.request
import urllib.error
from collections import deque

logger = logging.getLogger("HME.openrouter")

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

def _api_key() -> str:
    return os.environ.get("OPENROUTER_API_KEY", "")
_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"
_TIMEOUT = 90  # OpenRouter can be slower via upstream hops

_MODEL_T1 = os.environ.get("OPENROUTER_MODEL_T1", "deepseek/deepseek-r1:free")
_MODEL_T2 = os.environ.get("OPENROUTER_MODEL_T2", "meta-llama/llama-3.3-70b-instruct:free")

# OpenRouter rate-limits at the ACCOUNT level across :free models, so a single
# shared counter is more accurate than per-tier counters.
_RPD_LIMIT = int(os.environ.get("OPENROUTER_RPD_LIMIT", "200"))
_RPM_LIMIT = int(os.environ.get("OPENROUTER_RPM_LIMIT", "18"))

_quota_lock = threading.Lock()
_cb_lock = threading.Lock()

_requests_today = 0
_reset_ts = 0.0
_timestamps: deque = deque(maxlen=_RPM_LIMIT + 5)

_CB_THRESHOLD = 3
_CB_COOLDOWN = 300
_cb_failures = {"T1": 0, "T2": 0}
_cb_open_until = {"T1": 0.0, "T2": 0.0}


def _day_start_ts() -> float:
    import calendar
    t = time.gmtime()
    return calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))


def _reset_if_new_day() -> None:
    global _requests_today, _reset_ts
    today = _day_start_ts()
    if today > _reset_ts:
        _requests_today = 0
        _reset_ts = today


def _quota_ok() -> bool:
    with _quota_lock:
        _reset_if_new_day()
        return _requests_today < _RPD_LIMIT


def _record_request() -> None:
    global _requests_today
    with _quota_lock:
        _requests_today += 1
        _timestamps.append(time.monotonic())


def _rpm_wait() -> None:
    while True:
        now = time.monotonic()
        cutoff = now - 60.0
        recent = sum(1 for ts in _timestamps if ts > cutoff)
        if recent < _RPM_LIMIT:
            return
        oldest = min((ts for ts in _timestamps if ts > cutoff), default=now)
        wait = max(0.1, oldest + 60.0 - now)
        logger.debug(f"OpenRouter RPM throttle: {recent}/{_RPM_LIMIT} — sleep {wait:.1f}s")
        time.sleep(min(wait, 5.0))


def _cb_allow(label: str) -> bool:
    with _cb_lock:
        return _cb_open_until[label] <= time.monotonic()


def _cb_success(label: str) -> None:
    with _cb_lock:
        _cb_failures[label] = 0


def _cb_failure(label: str, model: str) -> None:
    with _cb_lock:
        _cb_failures[label] += 1
        if _cb_failures[label] >= _CB_THRESHOLD:
            _cb_open_until[label] = time.monotonic() + _CB_COOLDOWN
            logger.warning(f"OpenRouter {label} ({model}) circuit breaker OPEN for {_CB_COOLDOWN}s")


def get_quota_status() -> dict:
    with _quota_lock:
        _reset_if_new_day()
        ok = _requests_today < _RPD_LIMIT
        return {
            "any_available": ok,
            "requests_today": _requests_today,
            "rpd_limit": _RPD_LIMIT,
            "pct_used": round(_requests_today / _RPD_LIMIT * 100, 1),
            "tiers": [
                {"label": "T1", "model": _MODEL_T1, "available": ok and _cb_allow("T1")},
                {"label": "T2", "model": _MODEL_T2, "available": ok and _cb_allow("T2")},
            ],
        }


def _strip_think(text: str) -> str:
    if "</think>" in text:
        return text[text.rfind("</think>") + len("</think>"):].strip()
    return text.strip()


def _call_model(model: str, prompt: str, system: str,
                max_tokens: int, temperature: float) -> str | None:
    full_system = _GROUNDING_HEADER + ("\n\n" + system if system else "")
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": full_system},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    req = urllib.request.Request(
        _BASE_URL, data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_api_key()}",
            "User-Agent": "HME-Polychron/1.0",
            "HTTP-Referer": "https://github.com/anthropics/claude-code",
            "X-Title": "HME Polychron",
        }, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
        choices = data.get("choices", [])
        if not choices:
            return None
        text = choices[0].get("message", {}).get("content", "")
        return _strip_think(text) or None
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="ignore")[:200]
        logger.warning(f"OpenRouter {model} HTTP {e.code}: {err}")
        raise
    except Exception as e:
        logger.warning(f"OpenRouter {model} failed: {type(e).__name__}: {e}")
        raise


def available() -> bool:
    if not _api_key():
        return False
    if not _quota_ok():
        return False
    return _cb_allow("T1") or _cb_allow("T2")


def _mark_exhausted() -> None:
    global _requests_today
    with _quota_lock:
        _requests_today = _RPD_LIMIT


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3) -> str | None:
    if not _api_key():
        return None
    if not _quota_ok():
        logger.info("OpenRouter skipped: RPD hit")
        return None

    for label, model in (("T1", _MODEL_T1), ("T2", _MODEL_T2)):
        if not _cb_allow(label):
            logger.info(f"OpenRouter {label} ({model}) skipped: circuit open")
            continue

        _rpm_wait()
        try:
            text = _call_model(model, prompt, system, max_tokens, temperature)
            if text:
                _record_request()
                _cb_success(label)
                logger.info(f"OpenRouter {label} ({model}): ok ({_requests_today}/{_RPD_LIMIT} today)")
                return text
            _cb_failure(label, model)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                _mark_exhausted()
                logger.info(f"OpenRouter 429 — marking exhausted")
                return None
            _cb_failure(label, model)
            logger.info(f"OpenRouter {label} failed ({e.code}), trying next")
        except Exception:
            _cb_failure(label, model)
            logger.info(f"OpenRouter {label} failed, trying next")

    return None
