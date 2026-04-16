"""Base class for OpenAI-compatible synthesis providers (Groq, Cerebras, Mistral, NVIDIA).

Each provider module becomes ~30 lines of configuration instead of ~250 lines
of duplicated _Tier, circuit breaker, cascade, and HTTP logic.

Usage:
    from .synthesis_provider_base import OpenAIProvider
    provider = OpenAIProvider(
        name="Groq", env_key="GROQ_API_KEY", base_url="https://api.groq.com/openai/v1/chat/completions",
        tiers=[("T1", "llama-3.3-70b-versatile"), ("T2", "moonshotai/kimi-k2-instruct-0905"), ...],
    )
    result = provider.cascade(prompt, system, max_tokens, temperature)
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

logger = logging.getLogger("HME")

# Shared grounding header — identical for all providers.
GROUNDING_HEADER = """\
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


class _Tier:
    __slots__ = ("label", "model", "daily_limit", "rpm_limit",
                 "tokens_used", "requests_today", "reset_ts", "timestamps",
                 "cb_failures", "cb_open_until")

    def __init__(self, label: str, model: str, daily_limit: int, rpm_limit: int, rpd_limit: int = 0):
        self.label = label
        self.model = model
        self.daily_limit = daily_limit
        self.rpm_limit = rpm_limit
        self.tokens_used = 0
        self.requests_today = 0
        self.reset_ts = 0.0
        self.timestamps: deque = deque(maxlen=rpm_limit + 5)
        self.cb_failures = 0
        self.cb_open_until = 0.0


class OpenAIProvider:
    """Generic OpenAI-compatible provider with tiered cascade, circuit breaker, and quota tracking."""

    CB_THRESHOLD = 3
    CB_COOLDOWN = 300

    def __init__(self, name: str, env_key: str, base_url: str,
                 tiers: list[tuple[str, str]],
                 timeout: int = 60,
                 default_daily: int = 200,
                 default_rpm: int = 30,
                 default_rpd: int = 200,
                 uses_rpd: bool = False):
        self.name = name
        self.env_key = env_key
        self.base_url = base_url
        self.timeout = timeout
        self.uses_rpd = uses_rpd
        self._lock = threading.Lock()
        self._cb_lock = threading.Lock()

        self.tiers = []
        for label, model in tiers:
            daily = ENV.optional_int(f"{name.upper()}_DAILY_LIMIT_{label}", default_daily)
            rpm = ENV.optional_int(f"{name.upper()}_RPM_LIMIT_{label}", default_rpm)
            rpd = ENV.optional_int(f"{name.upper()}_RPD_LIMIT_{label}", default_rpd) if uses_rpd else 0
            self.tiers.append(_Tier(label, model, daily, rpm, rpd))

    def _api_key(self) -> str:
        return ENV.optional(self.env_key, "")

    def available(self) -> bool:
        key = self._api_key()
        if not key:
            return False
        return any(self._quota_ok(t) and self._cb_allow(t) for t in self.tiers)

    def get_quota_status(self) -> dict:
        out: dict = {"any_available": False, "tiers": []}
        with self._lock:
            for tier in self.tiers:
                self._reset_if_new_day(tier)
                ok = (tier.tokens_used < tier.daily_limit if not self.uses_rpd
                      else tier.requests_today < (tier.daily_limit or 200))
                out["tiers"].append({
                    "label": tier.label, "model": tier.model,
                    "tokens_used": tier.tokens_used,
                    "requests_today": tier.requests_today,
                    "daily_limit": tier.daily_limit,
                    "available": ok,
                })
                if ok:
                    out["any_available"] = True
        return out

    # ── Internal quota/circuit methods ────────────────────────────────────

    def _day_start_ts(self) -> float:
        import calendar
        t = time.gmtime()
        return calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, 0))

    def _reset_if_new_day(self, tier: _Tier):
        today = self._day_start_ts()
        if today > tier.reset_ts:
            tier.tokens_used = 0
            tier.requests_today = 0
            tier.reset_ts = today

    def _quota_ok(self, tier: _Tier) -> bool:
        with self._lock:
            self._reset_if_new_day(tier)
            if self.uses_rpd:
                return tier.requests_today < (tier.daily_limit or 200)
            return tier.tokens_used < tier.daily_limit

    def _record_usage(self, tier: _Tier, tokens: int):
        with self._lock:
            tier.tokens_used += tokens
            tier.requests_today += 1
            tier.timestamps.append(time.monotonic())

    def _rpm_wait(self, tier: _Tier):
        while True:
            now = time.monotonic()
            cutoff = now - 60.0
            recent = sum(1 for ts in tier.timestamps if ts > cutoff)
            if recent < tier.rpm_limit:
                return
            oldest = min((ts for ts in tier.timestamps if ts > cutoff), default=now)
            wait = max(0.1, oldest + 60.0 - now)
            logger.debug(f"{self.name} {tier.label} RPM throttle: {recent}/{tier.rpm_limit} — sleep {wait:.1f}s")
            time.sleep(min(wait, 5.0))

    def _cb_allow(self, tier: _Tier) -> bool:
        with self._cb_lock:
            return tier.cb_open_until <= time.monotonic()

    def _cb_success(self, tier: _Tier):
        with self._cb_lock:
            tier.cb_failures = 0

    def _cb_failure(self, tier: _Tier):
        with self._cb_lock:
            tier.cb_failures += 1
            if tier.cb_failures >= self.CB_THRESHOLD:
                tier.cb_open_until = time.monotonic() + self.CB_COOLDOWN
                logger.warning(f"{self.name} {tier.label} ({tier.model}) circuit breaker OPEN for {self.CB_COOLDOWN}s")

    # ── Core HTTP call ────────────────────────────────────────────────────

    def _call_model(self, model: str, prompt: str, system: str,
                    max_tokens: int, temperature: float) -> str | None:
        from .synthesis_config import strip_thinking_tags as _strip_think
        from .synthesis_proxy_route import proxy_route as _proxy_route

        body = self._build_request_body(model, prompt, system, max_tokens, temperature)
        url = self._build_url(model)
        _proxy_url, _proxy_hdrs = _proxy_route(url)
        headers = {"Content-Type": "application/json"}
        headers.update(self._build_auth_header())
        req = urllib.request.Request(
            _proxy_url, data=json.dumps(body).encode(),
            headers=headers, method="POST",
        )
        for _pk, _pv in _proxy_hdrs.items():
            req.add_header(_pk, _pv)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read())
            text = self._parse_response(data)
            return _strip_think(text) if text else None
        except urllib.error.HTTPError as e:
            err = e.read().decode(errors="ignore")[:200]
            logger.warning(f"{self.name} {model} HTTP {e.code}: {err}")
            raise
        except Exception as e:
            logger.warning(f"{self.name} {model} failed: {type(e).__name__}: {e}")
            raise

    # ── Cascade ───────────────────────────────────────────────────────────

    def _build_request_body(self, model: str, prompt: str, system: str,
                            max_tokens: int, temperature: float) -> dict:
        """Build the request payload. Override for non-OpenAI formats."""
        full_system = GROUNDING_HEADER + ("\n\n" + system if system else "")
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": full_system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

    def _build_url(self, model: str) -> str:
        """Build the request URL. Override for per-model URL patterns (e.g. Gemini)."""
        return self.base_url

    def _build_auth_header(self) -> dict:
        """Build auth headers. Override for query-param auth (e.g. Gemini)."""
        return {"Authorization": f"Bearer {self._api_key()}"}

    def _parse_response(self, data: dict) -> str | None:
        """Extract text from response. Override for non-OpenAI formats."""
        choices = data.get("choices", [])
        if not choices:
            return None
        return choices[0].get("message", {}).get("content", "")

    def cascade(self, prompt: str, system: str = "",
                max_tokens: int = 4096, temperature: float = 0.2) -> str | None:
        """Try tiers in order until one succeeds or all exhaust."""
        if not self._api_key():
            return None
        for tier in self.tiers:
            if not self._quota_ok(tier):
                logger.info(f"{self.name} {tier.label} ({tier.model}) skipped: quota hit")
                continue
            if not self._cb_allow(tier):
                logger.info(f"{self.name} {tier.label} ({tier.model}) skipped: circuit open")
                continue
            try:
                self._rpm_wait(tier)
                result = self._call_model(tier.model, prompt, system, max_tokens, temperature)
                if result:
                    est_tokens = 500 + max_tokens
                    self._record_usage(tier, est_tokens)
                    self._cb_success(tier)
                    logger.info(f"{self.name} {tier.label} ({tier.model}): ~{est_tokens}tok")
                    return result
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    with self._lock:
                        tier.tokens_used = tier.daily_limit
                    logger.info(f"{self.name} {tier.label} 429 — marking exhausted, trying next")
                else:
                    self._cb_failure(tier)
                    logger.info(f"{self.name} {tier.label} failed ({e.code}), trying next")
            except Exception:
                self._cb_failure(tier)
                logger.info(f"{self.name} {tier.label} failed, trying next")
        return None
