"""Groq synthesis tier — free-tier cascade via Groq's OpenAI-compatible endpoint.

Groq's custom silicon runs large open-weight models at extreme speed. Free tier
is throttled by RPM / RPD (requests per minute / day), NOT by token count —
so it degrades gracefully rather than cutting off hard.

Free tier cascade (best-first):
    T1: openai/gpt-oss-120b             — 120B OpenAI-open, strongest reasoning on Groq free
    T2: moonshotai/kimi-k2-instruct-0905 — Moonshot K2, 262k context, top-tier quality
    T3: llama-3.3-70b-versatile          — Meta 70B general, proven fallback

Returns None when RPM/RPD exhausted or quota hit — caller cascades to next provider.

Config (env vars):
    GROQ_API_KEY       — required to enable
    GROQ_MODEL_T1      — override T1 model
    GROQ_MODEL_T2      — override T2 model
    GROQ_RPD_LIMIT_*   — per-tier requests-per-day cap (default: 1000)
    GROQ_RPM_LIMIT_*   — per-tier requests-per-minute cap (default: 28)
"""
import json
import logging
import os
import threading
import time
import urllib.request
from .synthesis_proxy_route import proxy_route as _proxy_route
import urllib.error
from collections import deque

from hme_env import ENV

logger = logging.getLogger("HME.groq")

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
    """Read env on every call so keys added mid-session take effect as soon as
    .env is re-parsed by synthesis_reasoning._refresh_env."""
    return ENV.optional("GROQ_API_KEY", "")

_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"
_TIMEOUT = 60

_TIER_DEFS = [
    ("T1", ENV.optional("GROQ_MODEL_T1", "openai/gpt-oss-120b")),
    ("T2", ENV.optional("GROQ_MODEL_T2", "moonshotai/kimi-k2-instruct-0905")),
    ("T3", ENV.optional("GROQ_MODEL_T3", "llama-3.3-70b-versatile")),
]


class _Tier:
    __slots__ = ("label", "model", "rpd_limit", "rpm_limit",
                 "requests_today", "reset_ts", "timestamps",
                 "cb_failures", "cb_open_until")

    def __init__(self, label: str, model: str):
        self.label = label
        self.model = model
        self.rpd_limit = ENV.optional_int(f"GROQ_RPD_LIMIT_{label}", 1000)
        self.rpm_limit = ENV.optional_int(f"GROQ_RPM_LIMIT_{label}", 28)
        self.requests_today = 0
        self.reset_ts = 0.0
        self.timestamps: deque = deque(maxlen=self.rpm_limit + 5)
        self.cb_failures = 0
        self.cb_open_until = 0.0


_TIERS: list[_Tier] = [_Tier(lbl, mdl) for lbl, mdl in _TIER_DEFS]
_quota_lock = threading.Lock()
_cb_lock = threading.Lock()

_CB_THRESHOLD = 3
_CB_COOLDOWN = 300


def _day_start_ts() -> float:
    import calendar
    t = time.gmtime()
    return calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))


def _reset_if_new_day(tier: _Tier) -> None:
    today = _day_start_ts()
    if today > tier.reset_ts:
        tier.requests_today = 0
        tier.reset_ts = today


def _quota_ok(tier: _Tier) -> bool:
    with _quota_lock:
        _reset_if_new_day(tier)
        return tier.requests_today < tier.rpd_limit


def _record_request(tier: _Tier) -> None:
    with _quota_lock:
        tier.requests_today += 1
        tier.timestamps.append(time.monotonic())


def _rpm_wait(tier: _Tier) -> None:
    while True:
        now = time.monotonic()
        cutoff = now - 60.0
        recent = sum(1 for ts in tier.timestamps if ts > cutoff)
        if recent < tier.rpm_limit:
            return
        oldest = min((ts for ts in tier.timestamps if ts > cutoff), default=now)
        wait = max(0.1, oldest + 60.0 - now)
        logger.debug(f"Groq {tier.label} RPM throttle: {recent}/{tier.rpm_limit} — sleep {wait:.1f}s")
        time.sleep(min(wait, 5.0))


def _cb_allow(tier: _Tier) -> bool:
    with _cb_lock:
        return tier.cb_open_until <= time.monotonic()


def _cb_success(tier: _Tier) -> None:
    with _cb_lock:
        tier.cb_failures = 0


def _cb_failure(tier: _Tier) -> None:
    with _cb_lock:
        tier.cb_failures += 1
        if tier.cb_failures >= _CB_THRESHOLD:
            tier.cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(f"Groq {tier.label} ({tier.model}) circuit breaker OPEN for {_CB_COOLDOWN}s")


def get_quota_status() -> dict:
    out: dict = {"any_available": False, "tiers": []}
    with _quota_lock:
        for tier in _TIERS:
            _reset_if_new_day(tier)
            ok = tier.requests_today < tier.rpd_limit
            out["tiers"].append({
                "label": tier.label,
                "model": tier.model,
                "requests_today": tier.requests_today,
                "rpd_limit": tier.rpd_limit,
                "pct_used": round(tier.requests_today / tier.rpd_limit * 100, 1),
                "available": ok,
            })
            if ok:
                out["any_available"] = True
    return out


def _strip_think(text: str) -> str:
    """DeepSeek R1 emits <think>...</think> prefix — strip it for synthesis output."""
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
    _proxy_url, _proxy_hdrs = _proxy_route(_BASE_URL)
    req = urllib.request.Request(
        _proxy_url, data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_api_key()}",
            "User-Agent": "HME-Polychron/1.0",
        }, method="POST",
    )
    for _pk, _pv in _proxy_hdrs.items():
        req.add_header(_pk, _pv)
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
        logger.warning(f"Groq {model} HTTP {e.code}: {err}")
        raise
    except Exception as e:
        logger.warning(f"Groq {model} failed: {type(e).__name__}: {e}")
        raise


def available() -> bool:
    if not _api_key():
        return False
    return any(_quota_ok(t) and _cb_allow(t) for t in _TIERS)


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3) -> str | None:
    if not _api_key():
        return None

    for tier in _TIERS:
        if not _quota_ok(tier):
            logger.info(f"Groq {tier.label} ({tier.model}) skipped: RPD hit")
            continue
        if not _cb_allow(tier):
            logger.info(f"Groq {tier.label} ({tier.model}) skipped: circuit open")
            continue

        _rpm_wait(tier)
        try:
            text = _call_model(tier.model, prompt, system, max_tokens, temperature)
            if text:
                _record_request(tier)
                _cb_success(tier)
                logger.info(f"Groq {tier.label} ({tier.model}): ok ({tier.requests_today}/{tier.rpd_limit} today)")
                return text
            _cb_failure(tier)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                with _quota_lock:
                    tier.requests_today = tier.rpd_limit
                logger.info(f"Groq {tier.label} 429 — marking exhausted")
            else:
                _cb_failure(tier)
                logger.info(f"Groq {tier.label} failed ({e.code}), trying next")
        except Exception as _err:
            logger.debug(f"unnamed-except synthesis_groq.py:239: {type(_err).__name__}: {_err}")
            _cb_failure(tier)
            logger.info(f"Groq {tier.label} failed, trying next")

    return None
