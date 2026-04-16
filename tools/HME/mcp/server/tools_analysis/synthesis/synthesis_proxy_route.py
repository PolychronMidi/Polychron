"""Proxy-aware HTTP routing for synthesis modules.

When HME_PROXY_ENABLED=1 and the proxy is healthy, rewrites outbound
requests to route through http://127.0.0.1:{proxy_port} with an
X-HME-Upstream header carrying the original target URL. This makes the
proxy the authoritative filter for ALL inference — not just Anthropic.

When the proxy is down or disabled, returns the original URL unchanged
so synthesis modules degrade to direct calls automatically.

Usage in synthesis_*.py:
    from .synthesis_proxy_route import proxy_route
    url, extra_headers = proxy_route("https://api.groq.com/openai/v1/chat/completions")
    req = urllib.request.Request(url, ...)
    for k, v in extra_headers.items():
        req.add_header(k, v)
"""
import os
import urllib.request
import logging

logger = logging.getLogger("HME.proxy_route")

_PROXY_PORT = None
_PROXY_HEALTHY = None
_PROXY_CHECKED_AT = 0
_CHECK_INTERVAL = 30  # seconds


def _load_proxy_port():
    global _PROXY_PORT
    try:
        from .synthesis_config import ENV
        _PROXY_PORT = ENV.optional_int("HME_PROXY_PORT", 9099)
    except Exception:
        _PROXY_PORT = int(os.environ.get("HME_PROXY_PORT", "9099"))


def _is_proxy_enabled():
    try:
        from .synthesis_config import ENV
        return ENV.optional("HME_PROXY_ENABLED", "0") == "1"
    except Exception:
        return os.environ.get("HME_PROXY_ENABLED", "0") == "1"


def _check_proxy_health():
    """Lightweight health probe — cached for _CHECK_INTERVAL seconds."""
    global _PROXY_HEALTHY, _PROXY_CHECKED_AT
    import time
    now = time.monotonic()
    if _PROXY_HEALTHY is not None and now - _PROXY_CHECKED_AT < _CHECK_INTERVAL:
        return _PROXY_HEALTHY

    if _PROXY_PORT is None:
        _load_proxy_port()

    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{_PROXY_PORT}/health",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            _PROXY_HEALTHY = resp.status == 200
    except Exception:
        _PROXY_HEALTHY = False

    _PROXY_CHECKED_AT = now
    return _PROXY_HEALTHY


def proxy_route(original_url: str) -> tuple[str, dict]:
    """Rewrite a provider URL to route through the local proxy.

    Returns (url, extra_headers) where:
      - If proxy active: url = http://127.0.0.1:{port}/{path}, headers include X-HME-Upstream
      - If proxy down/disabled: url = original_url, headers = {}
    """
    if not _is_proxy_enabled():
        return original_url, {}

    if not _check_proxy_health():
        return original_url, {}

    if _PROXY_PORT is None:
        _load_proxy_port()

    try:
        from urllib.parse import urlparse
        parsed = urlparse(original_url)
        # Extract the base (scheme + host) as upstream header value
        upstream = f"{parsed.scheme}://{parsed.netloc}"
        # Reconstruct the path + query for the proxy request
        proxy_path = parsed.path
        if parsed.query:
            proxy_path += f"?{parsed.query}"
        proxy_url = f"http://127.0.0.1:{_PROXY_PORT}{proxy_path}"
        return proxy_url, {"X-HME-Upstream": upstream}
    except Exception as e:
        logger.debug(f"proxy_route fallback: {e}")
        return original_url, {}
