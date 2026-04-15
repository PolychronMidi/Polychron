"""Gemini synthesis tiers — free-tier cascade, best quality first.

Free tier cascade (Google AI Studio free, 15 RPM, ~1M tok/day per model):
    T1: gemini-3-flash-preview   — newest, strongest free flash
    T2: gemini-flash-latest      — floating alias to current flagship flash
    T3: gemini-2.5-flash         — stable 2.5 flash
    T4: gemini-2.0-flash         — older overflow
    T5: gemini-2.5-flash-lite    — lite fallback (still better than local 30b for short synth)

Returns None when all tiers exhausted — caller cascades to next provider or local.

Config (env vars):
    GEMINI_API_KEY       — required to enable
    GEMINI_DAILY_LIMIT_* — per-tier soft daily token cap (default: 900000)
    GEMINI_RPM_LIMIT_*   — per-tier requests-per-minute cap (default: 14)
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
# HME is named explicitly because it's the analytical lens — the model needs to know
# it's operating as part of HME, not as a generic code assistant.
# VERIFIED FACTS contract is the most important line: cascade stage 2 already extracted
# real paths/names from source; the model must trust those and not override them.
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
    return os.environ.get("GEMINI_API_KEY", "")
_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
_TIMEOUT = 60  # seconds

# ── Tier registry ─────────────────────────────────────────────────────────────
# Ordered best-first. Each entry defines the cascade slot.
# Daily limits are conservative estimates of Google AI Studio free-tier quota.
_DEFAULT_DAILY = 900_000
_DEFAULT_RPM = 14

_TIER_DEFS = [
    ("T1", os.environ.get("GEMINI_MODEL_T1", "gemini-3-flash-preview")),
    ("T2", os.environ.get("GEMINI_MODEL_T2", "gemini-flash-latest")),
    ("T3", os.environ.get("GEMINI_MODEL_T3", "gemini-2.5-flash")),
    ("T4", os.environ.get("GEMINI_MODEL_T4", "gemini-2.0-flash")),
    ("T5", os.environ.get("GEMINI_MODEL_T5", "gemini-2.5-flash-lite")),
]


class _Tier:
    __slots__ = ("label", "model", "daily_limit", "rpm_limit",
                 "tokens_used", "reset_ts", "timestamps",
                 "cb_failures", "cb_open_until")

    def __init__(self, label: str, model: str):
        self.label = label
        self.model = model
        self.daily_limit = int(os.environ.get(f"GEMINI_DAILY_LIMIT_{label}", _DEFAULT_DAILY))
        self.rpm_limit = int(os.environ.get(f"GEMINI_RPM_LIMIT_{label}", _DEFAULT_RPM))
        self.tokens_used = 0
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
    """UTC midnight timestamp for today."""
    import calendar
    t = time.gmtime()
    return calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))


def _reset_if_new_day(tier: _Tier) -> None:
    today = _day_start_ts()
    if today > tier.reset_ts:
        tier.tokens_used = 0
        tier.reset_ts = today


def _quota_ok(tier: _Tier) -> bool:
    with _quota_lock:
        _reset_if_new_day(tier)
        return tier.tokens_used < tier.daily_limit


def _record_usage(tier: _Tier, tokens: int) -> None:
    with _quota_lock:
        tier.tokens_used += tokens
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
        logger.debug(f"Gemini {tier.label} RPM throttle: {recent}/{tier.rpm_limit} — sleep {wait:.1f}s")
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
            logger.warning(f"Gemini {tier.label} ({tier.model}) circuit breaker OPEN for {_CB_COOLDOWN}s")


def get_quota_status() -> dict:
    out: dict = {"any_available": False, "tiers": []}
    with _quota_lock:
        for tier in _TIERS:
            _reset_if_new_day(tier)
            ok = tier.tokens_used < tier.daily_limit
            out["tiers"].append({
                "label": tier.label,
                "model": tier.model,
                "tokens_used": tier.tokens_used,
                "daily_limit": tier.daily_limit,
                "pct_used": round(tier.tokens_used / tier.daily_limit * 100, 1),
                "available": ok,
            })
            if ok:
                out["any_available"] = True
    return out


# ── Core REST call ────────────────────────────────────────────────────────────

def _call_model(model: str, prompt: str, system: str,
                max_tokens: int, temperature: float) -> str | None:
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
    url = f"{_BASE_URL}/{model}:generateContent?key={_api_key()}"
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
    if not _api_key():
        return False
    return any(_quota_ok(t) and _cb_allow(t) for t in _TIERS)


def call(prompt: str, system: str = "", max_tokens: int = 2048,
         temperature: float = 0.3) -> str | None:
    """
    Try tiers in order. Returns None when every tier exhausted —
    caller falls back to next provider or local.
    """
    if not _api_key():
        return None

    for tier in _TIERS:
        if not _quota_ok(tier):
            logger.info(f"Gemini {tier.label} ({tier.model}) skipped: quota hit")
            continue
        if not _cb_allow(tier):
            logger.info(f"Gemini {tier.label} ({tier.model}) skipped: circuit open")
            continue

        _rpm_wait(tier)
        try:
            text = _call_model(tier.model, prompt, system, max_tokens, temperature)
            if text:
                _record_usage(tier, 500 + max_tokens)  # conservative estimate
                _cb_success(tier)
                logger.info(f"Gemini {tier.label} ({tier.model}): ~{500+max_tokens}tok (daily {tier.tokens_used}/{tier.daily_limit})")
                return text
            _cb_failure(tier)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                # quota exhausted for this tier today — burn it
                with _quota_lock:
                    tier.tokens_used = tier.daily_limit
                logger.info(f"Gemini {tier.label} 429 — marking exhausted, trying next")
            else:
                _cb_failure(tier)
                logger.info(f"Gemini {tier.label} failed ({e.code}), trying next")
        except Exception as _err:
            logger.debug(f"unnamed-except synthesis_gemini.py:247: {type(_err).__name__}: {_err}")
            _cb_failure(tier)
            logger.info(f"Gemini {tier.label} failed, trying next")

    return None
