"""NVIDIA NIM synthesis tier — free-tier cascade via integrate.api.nvidia.com.

NVIDIA NIM hosts 190+ open-weight models for free-tier inference. Free tier
defaults: 40 RPM, no hard RPD limit disclosed but practical quota exists.
OpenAI-compatible at https://integrate.api.nvidia.com/v1/chat/completions.

Strong flagship models that are NOT accessible on other free providers:
  - z-ai/glm5               — GLM-5 (paywalled on Z.ai direct)
  - qwen/qwen3-coder-480b-a35b-instruct — 480B Qwen3 coder (vs 30B local)
  - mistralai/mistral-large-3-675b-instruct-2512 — 675B Mistral Large 3
  - mistralai/devstral-2-123b-instruct-2512 — 123B agentic coder
  - nvidia/llama-3.1-nemotron-ultra-253b-v1 — 253B Nemotron Ultra

This module supports BOTH reasoning and coder profiles; ordering is done
per-profile in synthesis_reasoning._RANKINGS so the same provider's tiers
appear in different slots of each ranking.

Note on reasoning-format models: z-ai/glm4.7 and nvidia/nemotron-3-super
return reasoning_content separately from content. `_flatten_content` below
handles OpenAI-shape content (string or list) and `_call_model` supplies a
generous default max_tokens budget so reasoning models have room for both.

Config (env vars):
    NVIDIA_API_KEY         — required to enable
    NVIDIA_MODEL_T1..T8    — override tier model
    NVIDIA_RPD_LIMIT_*     — per-tier requests-per-day cap (default: 2000)
    NVIDIA_RPM_LIMIT_*     — per-tier requests-per-minute cap (default: 35)
"""
import json
import logging
import os
import threading
import time
import urllib.request
import urllib.error
from collections import deque

from hme_env import ENV

logger = logging.getLogger("HME.nvidia")

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
    return ENV.optional("NVIDIA_API_KEY", "")

_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
_TIMEOUT = 90  # NVIDIA NIM can be slow on cold starts; bigger budget needed

# Ordered best-first for both profiles. synthesis_reasoning picks which slots
# to fire based on the global ranking. Every entry was live-tested on the
# free tier; failing / gated models (deepseek-r1-distill, codestral-22b) are
# omitted. Reasoning-heavy models list the `needs_budget` flag so that if
# they're called with a tiny max_tokens the response would be empty.
_TIER_DEFS = [
    ("T1", ENV.optional("NVIDIA_MODEL_T1", "deepseek-ai/deepseek-v3.2")),
    ("T2", ENV.optional("NVIDIA_MODEL_T2", "mistralai/mistral-large-3-675b-instruct-2512")),
    ("T3", ENV.optional("NVIDIA_MODEL_T3", "qwen/qwen3-coder-480b-a35b-instruct")),
    ("T4", ENV.optional("NVIDIA_MODEL_T4", "z-ai/glm5")),
    ("T5", ENV.optional("NVIDIA_MODEL_T5", "nvidia/llama-3.1-nemotron-ultra-253b-v1")),
    ("T6", ENV.optional("NVIDIA_MODEL_T6", "mistralai/devstral-2-123b-instruct-2512")),
    ("T7", ENV.optional("NVIDIA_MODEL_T7", "qwen/qwen3.5-397b-a17b")),
    ("T8", ENV.optional("NVIDIA_MODEL_T8", "meta/llama-3.3-70b-instruct")),
]


class _Tier:
    __slots__ = ("label", "model", "rpd_limit", "rpm_limit",
                 "requests_today", "reset_ts", "timestamps",
                 "cb_failures", "cb_open_until")

    def __init__(self, label: str, model: str):
        self.label = label
        self.model = model
        self.rpd_limit = ENV.optional_int(f"NVIDIA_RPD_LIMIT_{label}", 2000)
        self.rpm_limit = ENV.optional_int(f"NVIDIA_RPM_LIMIT_{label}", 35)
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
        logger.debug(f"NVIDIA {tier.label} RPM throttle: {recent}/{tier.rpm_limit} — sleep {wait:.1f}s")
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
            logger.warning(f"NVIDIA {tier.label} ({tier.model}) circuit breaker OPEN for {_CB_COOLDOWN}s")


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


def _flatten_content(content) -> str:
    """Some NVIDIA-hosted models return content as a typed-block list
    (similar to Mistral magistral). Extract text blocks; drop thinking."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    out = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            out.append(block.get("text", ""))
    return "\n".join(out)


def _strip_think(text: str) -> str:
    if "</think>" in text:
        return text[text.rfind("</think>") + len("</think>"):].strip()
    return text.strip()


def _call_model(model: str, prompt: str, system: str,
                max_tokens: int, temperature: float) -> str | None:
    # Reasoning-format models (glm4.7, nemotron-3-super) need budget for the
    # hidden reasoning trace PLUS the actual response. Bump to ≥512.
    _effective_max = max(max_tokens, 512)
    full_system = _GROUNDING_HEADER + ("\n\n" + system if system else "")
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": full_system},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": _effective_max,
        "temperature": temperature,
    }
    req = urllib.request.Request(
        _BASE_URL, data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_api_key()}",
            "User-Agent": "HME-Polychron/1.0",
        }, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
        choices = data.get("choices", [])
        if not choices:
            return None
        raw = choices[0].get("message", {}).get("content", "")
        text = _flatten_content(raw)
        return _strip_think(text) or None
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="ignore")[:200]
        logger.warning(f"NVIDIA {model} HTTP {e.code}: {err}")
        raise
    except Exception as e:
        logger.warning(f"NVIDIA {model} failed: {type(e).__name__}: {e}")
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
            logger.info(f"NVIDIA {tier.label} ({tier.model}) skipped: RPD hit")
            continue
        if not _cb_allow(tier):
            logger.info(f"NVIDIA {tier.label} ({tier.model}) skipped: circuit open")
            continue

        _rpm_wait(tier)
        try:
            text = _call_model(tier.model, prompt, system, max_tokens, temperature)
            if text:
                _record_request(tier)
                _cb_success(tier)
                logger.info(f"NVIDIA {tier.label} ({tier.model}): ok ({tier.requests_today}/{tier.rpd_limit} today)")
                return text
            _cb_failure(tier)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                with _quota_lock:
                    tier.requests_today = tier.rpd_limit
                logger.info(f"NVIDIA {tier.label} 429 — marking exhausted")
            else:
                _cb_failure(tier)
                logger.info(f"NVIDIA {tier.label} failed ({e.code}), trying next")
        except Exception as _err:
            logger.debug(f"unnamed-except synthesis_nvidia.py:275: {type(_err).__name__}: {_err}")
            _cb_failure(tier)
            logger.info(f"NVIDIA {tier.label} failed, trying next")

    return None
