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
_TOPOLOGY_CACHE_TTL = 30.0  # seconds — longer TTL; background refresh keeps it fresh
_refresh_lock = threading.Lock()
_refresh_running: bool = False

# Layer 7: shim response time tracking
_shim_response_ms: list[float] = []  # recent response times
_shim_response_lock = threading.Lock()
_RESPONSE_HISTORY = 20
_SLOWDOWN_WARN_THRESHOLD = 3.0  # shim response time EMA > 3× baseline → warn


def get_topology(force: bool = False) -> dict:
    """Return cached topology snapshot. Stale cache triggers background refresh; never blocks callers."""
    global _last_topology, _topology_ts
    now = time.time()

    if force:
        topo = _build_topology()
        with _topology_lock:
            _last_topology = topo
            _topology_ts = time.time()
        return topo

    with _topology_lock:
        cached = dict(_last_topology) if _last_topology else None
        stale = not cached or (now - _topology_ts >= _TOPOLOGY_CACHE_TTL)

    if stale:
        _trigger_background_refresh()

    return cached or {
        "ts": 0, "elapsed_ms": 0, "system_healthy": False, "coherence": 0.0,
        "slowdown_warning": None, "nodes": {}, "meta_observer": {},
    }


def _trigger_background_refresh() -> None:
    """Start a background topology refresh unless one is already running."""
    global _refresh_running
    with _refresh_lock:
        if _refresh_running:
            return
        _refresh_running = True

    def _do_refresh():
        global _refresh_running, _last_topology, _topology_ts
        try:
            topo = _build_topology()
            with _topology_lock:
                _last_topology = topo
                _topology_ts = time.time()
        except Exception as e:
            logger.warning(f"health_topology: background refresh failed: {e}")
        finally:
            with _refresh_lock:
                _refresh_running = False

    threading.Thread(target=_do_refresh, daemon=True, name="hme-topology-refresh").start()


def _build_topology() -> dict:
    t0 = time.time()

    # Check shim — root of RAG dependency tree
    shim = _check_shim()

    # Track response time for Layer 7 predictive health
    _record_shim_response_ms(shim.get("response_ms", _HEALTH_TIMEOUT * 1000))

    # Check local inference — llama-server instances (arbiter + coder) replaced
    # ollama in commit 0577c0f7. The old ollama/daemon checks probed dead ports
    # and flooded LIFESAVER with coherence-below-threshold warnings.
    daemon = {"healthy": True, "note": "retired; llama-server is authoritative"}
    local_infer = _check_llamacpp_instances()

    coherence = _compute_coherence(shim, daemon, local_infer)
    slowdown = _check_shim_slowdown()

    # Auto-resolve stale failures whose target is now healthy. Without this,
    # a transient crash of e.g. the arbiter leaves a CRITICAL entry in the
    # LIFESAVER queue forever, surfacing on every tool response even after
    # the service recovered.
    _auto_resolve_stale_failures(shim=shim, llamacpp=local_infer)

    # L13-15: meta-observer status
    meta_obs = {}
    try:
        from server import meta_observer
        meta_obs = meta_observer.get_status()
    except (ImportError, AttributeError) as _mo_err:
        logger.debug(f"meta_observer status unavailable: {_mo_err}")

    return {
        "ts": time.time(),
        "elapsed_ms": int((time.time() - t0) * 1000),
        "system_healthy": shim.get("healthy", False),
        "coherence": coherence,
        "slowdown_warning": slowdown,
        "nodes": {
            "shim": shim,
            "daemon": daemon,
            "llamacpp": local_infer,
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


def _auto_resolve_stale_failures(shim: dict, llamacpp: dict) -> None:
    """Mark failures resolved when their backing component is now healthy.

    Called after each topology build. Walks the active failure list from
    failure_genealogy and resolves entries whose source string matches a
    component that is currently reported healthy. Prevents stale CRITICALs
    from pinning the LIFESAVER banner after a transient outage recovers.
    """
    try:
        from server import failure_genealogy as fg
        active = fg.get_active_failures()
    except Exception as e:
        logger.warning(f"auto-resolve: failure_genealogy unavailable: {e}")
        return

    if not active:
        return

    healthy_signals: list[tuple[str, bool]] = []
    if shim.get("healthy"):
        healthy_signals.append(("shim", True))
        healthy_signals.append(("rag_proxy", True))
    for key, info in llamacpp.items():
        if info.get("healthy"):
            healthy_signals.append((key, True))
            # Match synthesis_llamacpp's model_init source names too.
            # Arbiter model name comes from .env HME_ARBITER_MODEL.
            if key == "arbiter":
                arbiter_alias = os.environ.get("HME_ARBITER_MODEL", "")
                if arbiter_alias:
                    healthy_signals.append((f"model_init({arbiter_alias})", True))
            if key == "coder":
                local_model = os.environ.get("HME_LOCAL_MODEL", "")
                if local_model:
                    healthy_signals.append((f"model_init({local_model})", True))

    resolved_count = 0
    resolved_sources: set[str] = set()
    for f in active:
        source = f.get("source", "")
        for sig_src, _ in healthy_signals:
            if sig_src and sig_src in source:
                try:
                    fg.resolve_failure(f["id"])
                    resolved_count += 1
                    resolved_sources.add(source)
                except Exception as e:
                    logger.warning(f"auto-resolve: could not resolve {f.get('id')}: {e}")
                break
    if resolved_count:
        logger.info(f"auto-resolve: cleared {resolved_count} stale failure(s) on recovery")
        # Also sweep the mirrored todo store so the LIFESAVER todo entries
        # don't remain as dangling [pending] items after the underlying
        # component recovered.
        try:
            from server.tools_analysis.todo import resolve_lifesaver_todos
            for src in resolved_sources:
                resolve_lifesaver_todos(src)
        except (ImportError, AttributeError) as _tl_err:
            logger.debug(f"auto-resolve: todo sweep unavailable: {_tl_err}")


def _check_llamacpp_instances() -> dict:
    """Probe both llama-server instances (arbiter + coder) via their /health endpoints.

    URLs come from HME_LLAMACPP_ARBITER_URL / HME_LLAMACPP_CODER_URL so this
    tracks whatever .env says; falls back to the default port mapping from
    commit 0577c0f7 (arbiter 8080, coder 8081).
    """
    arbiter_url = os.environ.get("HME_LLAMACPP_ARBITER_URL", "http://127.0.0.1:8080")
    coder_url   = os.environ.get("HME_LLAMACPP_CODER_URL",   "http://127.0.0.1:8081")
    result = {}
    for key, url in (("arbiter", arbiter_url), ("coder", coder_url)):
        t0 = time.time()
        try:
            req = urllib.request.Request(f"{url}/health")
            with urllib.request.urlopen(req, timeout=_HEALTH_TIMEOUT) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(body)
                except ValueError:
                    data = {}
                status = data.get("status", "")
                # llama-server returns {"status":"ok"} when serving, or
                # {"error":{"code":503,"type":"unavailable_error","message":"Loading model"}}
                # during model load. Treat "ok" as healthy; anything else as unhealthy.
                healthy = (resp.status == 200 and status == "ok")
                result[key] = {
                    "healthy": healthy,
                    "url": url,
                    "status": status or body[:80],
                    "response_ms": round((time.time() - t0) * 1000, 1),
                }
        except Exception as e:
            result[key] = {
                "healthy": False,
                "url": url,
                "error": str(e)[:120],
                "response_ms": round((time.time() - t0) * 1000, 1),
            }
    return result


def _compute_coherence(shim: dict, daemon: dict, llamacpp: dict) -> float:
    """Compute a [0.0, 1.0] system coherence score.

    Weighted: shim (40%) + daemon (20%) + local inference (40%).
    Shim is the root of all RAG operations; llama-server instances host the
    arbiter and coder that power the HME cascade.
    """
    shim_score = 1.0 if shim.get("healthy") else 0.0
    daemon_score = 1.0 if daemon.get("healthy") else 0.0
    llamacpp_up = sum(1 for v in llamacpp.values() if v.get("healthy"))
    llamacpp_total = max(len(llamacpp), 1)
    llamacpp_score = llamacpp_up / llamacpp_total

    coherence = 0.4 * shim_score + 0.2 * daemon_score + 0.4 * llamacpp_score
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
    if not nodes:
        return "[topology: pending first check]"
    shim = nodes.get("shim", {})
    llamacpp = nodes.get("llamacpp", {})
    coherence = topo.get("coherence", 0.0)

    parts = []
    if shim.get("healthy"):
        ms = shim.get("response_ms", "?")
        parts.append(f"shim OK ({ms}ms)")
    else:
        err = shim.get("error", shim.get("phase", "?"))
        parts.append(f"shim DOWN ({err})")

    llamacpp_up = sum(1 for v in llamacpp.values() if v.get("healthy"))
    llamacpp_total = max(len(llamacpp), 1)
    if llamacpp_up == llamacpp_total:
        names = ",".join(sorted(llamacpp.keys()))
        parts.append(f"llamacpp {llamacpp_up}/{llamacpp_total} ({names}) OK")
    else:
        down = [k for k, v in llamacpp.items() if not v.get("healthy")]
        parts.append(f"llamacpp {llamacpp_up}/{llamacpp_total} — DOWN: {','.join(down)}")

    slowdown = topo.get("slowdown_warning")
    if slowdown:
        parts.append(f"⚠ shim slowdown {slowdown['ratio']}×")

    return f"[coherence={coherence:.0%}] " + " | ".join(parts)
