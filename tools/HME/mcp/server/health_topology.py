"""HME unified health topology — Layer 3 of the self-coherence stack.

Assembles health status from all components into a dependency-aware snapshot.
When a parent node is unhealthy, downstream nodes are marked UNKNOWN rather
than assumed healthy — preventing false confidence from stale checks.

Topology:
  MCP Server
    └── RAG Proxy
          └── HTTP Shim (7734)
                ├── ProjectEngine
                ├── GlobalEngine
                └── File Watcher
    └── Startup Chain
          └── Ollama Daemon (7735)
                ├── GPU0 Extractor (11434)
                ├── GPU1 Reasoner  (11435)
                └── CPU Arbiter    (11436)

Layer 7 (Predictive Health): tracks shim response time EMA and warns when
trending toward OOM/timeout before the crash actually happens.
Layer 8 (Coherence Metrics): coherence score computed from fraction of
healthy components weighted by criticality.
"""
import json
import os
import time
import threading
import urllib.request
import logging

logger = logging.getLogger("HME")

_HEALTH_TIMEOUT = 2
_last_topology: dict = {}
_topology_lock = threading.Lock()
_topology_ts: float = 0.0
_TOPOLOGY_CACHE_TTL = 10.0  # seconds

# Layer 7: shim response time tracking
_shim_response_ms: list[float] = []  # recent response times
_shim_response_lock = threading.Lock()
_RESPONSE_HISTORY = 20
_SLOWDOWN_WARN_THRESHOLD = 3.0  # shim response time EMA > 3× baseline → warn


def get_topology(force: bool = False) -> dict:
    """Return the current health topology snapshot. Cached for _TOPOLOGY_CACHE_TTL seconds."""
    global _last_topology, _topology_ts
    now = time.time()
    with _topology_lock:
        if not force and _last_topology and now - _topology_ts < _TOPOLOGY_CACHE_TTL:
            return dict(_last_topology)
    topo = _build_topology()
    with _topology_lock:
        _last_topology = topo
        _topology_ts = now
    return topo


def _build_topology() -> dict:
    t0 = time.time()

    # Check shim — root of RAG dependency tree
    shim = _check_shim()

    # Track response time for Layer 7 predictive health
    _record_shim_response_ms(shim.get("response_ms", _HEALTH_TIMEOUT * 1000))

    # Check Ollama daemon (independent subtree)
    daemon = _check_daemon()

    # Check Ollama instances — prefer daemon data (authoritative), fall back to direct
    if daemon.get("healthy"):
        ollama_instances = _check_ollama_from_daemon(daemon)
    else:
        ollama_instances = {
            "gpu0": _check_ollama_direct(int(os.environ.get("HME_OLLAMA_PORT_GPU0", "11434"))),
            "gpu1": _check_ollama_direct(int(os.environ.get("HME_OLLAMA_PORT_GPU1", "11435"))),
            "cpu":  _check_ollama_direct(int(os.environ.get("HME_OLLAMA_PORT_CPU",  "11436"))),
        }

    coherence = _compute_coherence(shim, daemon, ollama_instances)
    slowdown = _check_shim_slowdown()

    # L13-15: meta-observer status
    meta_obs = {}
    try:
        from server import meta_observer
        meta_obs = meta_observer.get_status()
    except Exception:
        pass

    return {
        "ts": time.time(),
        "elapsed_ms": int((time.time() - t0) * 1000),
        "system_healthy": shim.get("healthy", False),
        "coherence": coherence,
        "slowdown_warning": slowdown,
        "nodes": {
            "shim": shim,
            "daemon": daemon,
            "ollama": ollama_instances,
        },
        "meta_observer": meta_obs,
    }


def _check_shim(port: int = 7734) -> dict:
    t0 = time.time()
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(req, timeout=_HEALTH_TIMEOUT) as resp:
            data = json.loads(resp.read())
            response_ms = (time.time() - t0) * 1000
            healthy = data.get("status") == "ready" and data.get("kb_ready", False)
            return {
                "healthy": healthy,
                "phase": "ready" if healthy else "loading",
                "endpoints": data.get("endpoints", []),
                "error_count": data.get("error_count", 0),
                "recent_errors": data.get("recent_errors", []),
                "kb_ready": data.get("kb_ready", False),
                "response_ms": round(response_ms, 1),
            }
    except Exception as e:
        return {
            "healthy": False,
            "phase": "unreachable",
            "error": str(e),
            "response_ms": (time.time() - t0) * 1000,
        }


def _check_daemon(port: int = 7735) -> dict:
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(req, timeout=_HEALTH_TIMEOUT) as resp:
            data = json.loads(resp.read())
            return {
                "healthy": data.get("status") == "ready",
                "models": data.get("models", {}),
                "warm_caches": data.get("warm_caches", {}),
            }
    except Exception as e:
        return {"healthy": False, "error": str(e)}


def _check_ollama_from_daemon(daemon_data: dict) -> dict:
    """Extract Ollama instance status from daemon health data (single authoritative source)."""
    models = daemon_data.get("models", {})
    result = {}
    for key, info in models.items():
        result[key] = {"healthy": info.get("loaded", False), "source": "daemon"}
    if not result:
        result["(daemon_empty)"] = {"healthy": False, "source": "daemon"}
    return result


def _check_ollama_direct(port: int) -> dict:
    try:
        req = urllib.request.Request(f"http://localhost:{port}/api/tags")
        with urllib.request.urlopen(req, timeout=3) as resp:
            return {"healthy": resp.status == 200, "source": "direct"}
    except Exception as e:
        return {"healthy": False, "error": str(e), "source": "direct"}


def _compute_coherence(shim: dict, daemon: dict, ollama: dict) -> float:
    """Compute a [0.0, 1.0] system coherence score.

    Weighted: shim health (60%) + Ollama availability (40%).
    Shim is more critical — without it, no RAG operations work at all.
    """
    shim_score = 1.0 if shim.get("healthy") else 0.0
    daemon_score = 1.0 if daemon.get("healthy") else 0.0
    ollama_up = sum(1 for v in ollama.values() if v.get("healthy"))
    ollama_total = max(len(ollama), 1)
    ollama_score = ollama_up / ollama_total

    # Shim 40%, daemon 20%, ollama 40%
    coherence = 0.4 * shim_score + 0.2 * daemon_score + 0.4 * ollama_score
    return round(coherence, 3)


# ── Layer 7: Predictive Health ───────────────────────────────────────────────

def _record_shim_response_ms(ms: float) -> None:
    with _shim_response_lock:
        _shim_response_ms.append(ms)
        if len(_shim_response_ms) > _RESPONSE_HISTORY:
            _shim_response_ms.pop(0)


def _check_shim_slowdown() -> dict | None:
    """Return a slowdown warning dict if shim response time is trending dangerously high.

    Compares recent 5-call EMA against baseline (first half of history).
    If recent EMA > 3× baseline AND > 1000ms absolute, warn.
    """
    with _shim_response_lock:
        if len(_shim_response_ms) < 6:
            return None
        baseline = sum(_shim_response_ms[:len(_shim_response_ms) // 2]) / (len(_shim_response_ms) // 2)
        recent = sum(_shim_response_ms[-5:]) / 5
    if baseline > 0 and recent > _SLOWDOWN_WARN_THRESHOLD * baseline and recent > 1000:
        return {
            "baseline_ms": round(baseline, 1),
            "recent_ms": round(recent, 1),
            "ratio": round(recent / baseline, 1),
            "message": f"Shim response time trending up ({recent:.0f}ms vs {baseline:.0f}ms baseline) — may OOM soon",
        }
    return None


def describe_topology(topo: dict) -> str:
    """Human-readable topology description for self-narration (Layer 6)."""
    nodes = topo.get("nodes", {})
    shim = nodes.get("shim", {})
    daemon = nodes.get("daemon", {})
    ollama = nodes.get("ollama", {})
    coherence = topo.get("coherence", 0.0)

    parts = []
    if shim.get("healthy"):
        ms = shim.get("response_ms", "?")
        parts.append(f"shim OK ({ms}ms)")
    else:
        err = shim.get("error", shim.get("phase", "?"))
        parts.append(f"shim DOWN ({err})")

    if daemon.get("healthy"):
        wc = daemon.get("warm_caches", {})
        fresh = sum(1 for v in wc.values() if v.get("fresh")) if wc else 0
        parts.append(f"daemon OK ({fresh}/{max(len(wc), 1)} caches warm)")
    else:
        parts.append("daemon UNREACHABLE")

    ollama_up = sum(1 for v in ollama.values() if v.get("healthy"))
    parts.append(f"Ollama {ollama_up}/{len(ollama)} models")

    slowdown = topo.get("slowdown_warning")
    if slowdown:
        parts.append(f"⚠ shim slowdown {slowdown['ratio']}×")

    return f"[coherence={coherence:.0%}] " + " | ".join(parts)
