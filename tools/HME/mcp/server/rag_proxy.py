"""RAG proxy — delegates engine calls to the persistent HTTP shim on localhost:7734.

Drop-in replacement for RAGEngine. The MCP server uses this instead of loading
its own SentenceTransformer + RAGEngine, eliminating the duplicate model loading
that wasted ~500MB RAM and ~10s startup time per restart.
"""
import json
import logging
import os
import subprocess
import time
import threading
import urllib.error
import urllib.request

logger = logging.getLogger("HME")

_DEFAULT_PORT = 7734
_DISPATCH_TIMEOUT = 30
_HEALTH_TIMEOUT = 2
_SHIM_MAX_WAIT = int(os.environ.get("HME_SHIM_WAIT", "40"))  # seconds; override via env
_MAX_CONSECUTIVE_404S = 5  # consecutive /rag 404s before LIFESAVER fires
_MONITOR_INTERVAL = 60     # seconds between shim health checks in proxy monitor
_PID_FILE = "/tmp/hme-http-shim.pid"

_proxy_monitor_active = False
_MONITOR_INTERVAL_STABLE = 120   # seconds when system has been healthy >30min (Layer 5)
_MONITOR_STABLE_THRESHOLD = 1800  # 30 minutes of uninterrupted health → reduce cadence


def _shim_path():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "hme_http.py")


def check_shim_health(port=_DEFAULT_PORT) -> bool:
    """Return True if shim is ready and KB is loaded."""
    return _get_shim_status(port).get("healthy", False)


def check_shim_rag_capable(port=_DEFAULT_PORT) -> bool:
    """Return True if shim is healthy AND exposes /rag.

    Uses the endpoints list embedded in /health (single call). Falls back to a
    direct /rag probe for old shims that don't embed endpoints in /health.
    """
    status = _get_shim_status(port)
    if not status.get("healthy", False):
        return False
    endpoints = status.get("endpoints")
    if endpoints is not None:
        return "/rag" in endpoints
    # Old shim without endpoints in /health — probe /rag directly
    try:
        body = json.dumps({"engine": "project", "method": "list_knowledge", "kwargs": {}}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/rag", data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return True
    except urllib.error.HTTPError as e:
        return e.code != 404
    except Exception:
        return False


def _get_shim_status(port=_DEFAULT_PORT) -> dict:
    """Single /health call returning parsed status dict. Shared by health + rag_capable checks.

    Sets 'healthy': True only when shim is fully ready (status=='ready' and kb_ready).
    Sets 'loading': True when shim responded but is still initializing (training lock,
    engines loading) — proxy monitor uses this to skip restart (process is alive).
    """
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(req, timeout=_HEALTH_TIMEOUT) as resp:
            data = json.loads(resp.read())
            is_ready = data.get("status") == "ready" and data.get("kb_ready", False)
            is_loading = data.get("status") == "loading"
            data["healthy"] = is_ready
            data["loading"] = is_loading  # alive but engines not ready (training lock etc.)
            return data
    except Exception:
        return {"healthy": False, "loading": False}


def kill_shim_by_pid() -> bool:
    """Kill the shim process recorded in the PID file. Returns True if killed."""
    import signal
    try:
        pid = int(open(_PID_FILE).read().strip())
        os.kill(pid, signal.SIGTERM)
        logger.info(f"Killed stale shim pid={pid}")
        return True
    except (FileNotFoundError, ValueError, ProcessLookupError, OSError):
        return False


def ensure_shim_running(port=_DEFAULT_PORT, max_wait=None):
    if max_wait is None:
        max_wait = _SHIM_MAX_WAIT
    if check_shim_health(port):
        return True

    # PID-first: if a shim process is alive but not yet healthy, wait before spawning a duplicate
    pid_alive = False
    try:
        pid = int(open(_PID_FILE).read().strip())
        os.kill(pid, 0)  # signal 0 = liveness check, no-op if alive
        pid_alive = True
        logger.info(f"Shim pid={pid} alive but not healthy — waiting for it to become ready")
    except (FileNotFoundError, ValueError, ProcessLookupError, OSError):
        pass

    if not pid_alive:
        env = os.environ.copy()
        env["PROJECT_ROOT"] = os.environ.get("PROJECT_ROOT", os.getcwd())
        try:
            subprocess.Popen(
                ["python3", _shim_path(), "--port", str(port), "--daemon"],
                env=env, start_new_session=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            logger.warning(f"Failed to start HTTP shim: {e}")
            return False

    for _ in range(max_wait):
        time.sleep(1)
        if check_shim_health(port):
            return True
    logger.warning(f"Shim did not become healthy within {max_wait}s — falling back to local mode")
    return False


def start_proxy_monitor(port: int = _DEFAULT_PORT) -> None:
    """Start background shim health monitor. Restarts shim if it dies mid-session."""
    global _proxy_monitor_active
    if _proxy_monitor_active:
        return
    _proxy_monitor_active = True
    _t = threading.Thread(
        target=_proxy_health_monitor, args=(port,),
        daemon=True, name="HME-proxy-monitor",
    )
    _t.start()
    # L13: register monitor thread with meta-observer so it can detect thread death
    try:
        from server import meta_observer
        meta_observer.register_monitor_thread(_t)
    except (ImportError, AttributeError) as _mo_err:
        logger.debug(f"meta_observer thread registration unavailable: {_mo_err}")
    logger.info(f"Proxy health monitor started (interval={_MONITOR_INTERVAL}s)")


_intent_propagation_last: float = 0.0
_INTENT_INTERVAL = 120.0  # seconds between intent propagation ticks


def _intent_propagation_tick() -> None:
    """Layer 11: pre-warm pre-edit cache for files Claude is actively discussing.

    Reads the last 5 minutes of transcript from the shim, extracts file/module
    mentions from Claude's messages, and pre-warms the pre-edit cache for those
    targets. When read() is then called, the cache is already warm (~50ms vs ~3s).

    Runs at most every _INTENT_INTERVAL seconds in the healthy-cycle of the proxy monitor.
    Non-fatal: any failure is silently ignored (this is a latency optimization, not correctness).
    """
    global _intent_propagation_last
    now = time.time()
    if now - _intent_propagation_last < _INTENT_INTERVAL:
        return
    _intent_propagation_last = now
    try:
        import re
        import urllib.request as _ureq
        # Fetch recent transcript
        req = _ureq.Request(f"http://127.0.0.1:{_DEFAULT_PORT}/transcript?minutes=5&max=20")
        with _ureq.urlopen(req, timeout=3) as resp:
            import json as _js
            entries = _js.loads(resp.read()).get("entries", [])
        if not entries:
            return
        # Extract file/module mentions from assistant messages
        text = " ".join(
            e.get("content", "") for e in entries
            if e.get("type") in ("assistant", "user")
        )
        # Match src/... paths and module names (CamelCase or camelCase identifiers)
        files = re.findall(r'src/[\w/.-]+\.js', text)
        modules = re.findall(r'\b[a-z][a-zA-Z]{3,}(?:Manager|Engine|Controller|Registry|Handler|Bridge)\b', text)
        targets = list(set(files + modules))[:5]  # top 5 candidates
        if not targets:
            return
        logger.info(f"Intent propagation: pre-warming cache for {targets}")
        from server import context as _ctx
        from server.tools_analysis.workflow import _warm_pre_edit_cache_sync
        _warm_pre_edit_cache_sync(max_files=len(targets), target_hints=targets)
    except Exception as _intent_err:
        logger.debug(f"intent_propagation pre-warm failed (non-fatal): {type(_intent_err).__name__}: {_intent_err}")


def _check_ollama_daemon_health() -> None:
    """Warn if Ollama persistence daemon (port 7735) is unreachable — non-fatal, logged only.

    Skipped when HME_ARBITER_BACKEND=llamacpp (default now) — the ollama
    daemon was retired in commit 0577c0f7 when local inference moved to
    llama-server. Probing a port that doesn't exist floods hme.log with
    warnings every monitor tick.
    """
    if os.environ.get("HME_ARBITER_BACKEND", "llamacpp").lower() == "llamacpp":
        return
    try:
        req = urllib.request.Request("http://127.0.0.1:7735/health")
        with urllib.request.urlopen(req, timeout=2):
            return  # daemon alive
    except Exception as e:
        logger.warning(f"Proxy health monitor: Ollama daemon (port 7735) unreachable: {type(e).__name__}")


def _proxy_health_monitor(port: int) -> None:
    """Background: ping shim periodically; restart if dead; reset one-shot flags on recovery.

    Layer 5 (Temporal Rhythm): interval adapts — 60s normally, 120s after 30min of stability.
    Wrapped in a crash watchdog — if an unhandled exception escapes, registers a
    LIFESAVER and restarts the monitor thread so monitoring never silently dies.
    """
    crash_count = 0
    _stable_since: float = 0.0  # epoch when shim last became continuously healthy
    while _proxy_monitor_active:
        try:
            # Layer 5: adaptive interval — reduce overhead when system is stable
            _now = time.time()
            if _stable_since > 0 and (_now - _stable_since) >= _MONITOR_STABLE_THRESHOLD:
                _interval = _MONITOR_INTERVAL_STABLE
            else:
                _interval = _MONITOR_INTERVAL
            time.sleep(_interval)
            if not _proxy_monitor_active:
                break
            _shim_status = _get_shim_status(port)
            if _shim_status.get("loading"):
                # Shim is alive but engines are initializing (training lock, cold start, etc.)
                # Do NOT restart — process is up, just not KB-ready yet. Skip this cycle.
                logger.debug("Proxy health monitor: shim loading (engines not ready) — skipping restart")
                _stable_since = 0.0  # not stable until fully ready
                continue
            if _shim_status.get("healthy"):
                if _stable_since == 0:
                    _stable_since = time.time()  # mark start of stable window
                crash_count = 0  # reset crash counter on healthy cycle
                # L18: if shim is healthy and we had crash predictions, they were prevented
                try:
                    from server import meta_observer as _mo18
                    for pred in list(_mo18._predictions):
                        if pred["outcome"] is None and pred["type"] in (
                            "shim_decay_precursor", "shim_latency_crash"
                        ) and time.time() > pred["deadline"]:
                            _mo18.resolve_prediction(pred["id"], outcome_occurred=False)
                except Exception as _pred_err:
                    logger.debug(f"monitor: prediction resolve failed (non-fatal): {type(_pred_err).__name__}: {_pred_err}")
                _check_ollama_daemon_health()
                _intent_propagation_tick()  # Layer 11: pre-warm cache from transcript
                # Layer 8: coherence snapshot → metrics/hme-coherence.jsonl
                try:
                    from server import health_topology as ht
                    import json as _jc
                    topo = ht.get_topology()
                    # ts==0 means the cache is empty (no build has completed yet) —
                    # the returned coherence of 0.0 is a sentinel, not a real reading.
                    # Skip logging and alerting until a real topology build finishes.
                    if topo.get("ts", 0) == 0:
                        pass
                    else:
                        coherence = topo.get("coherence", 0.0)
                        _pr = os.environ.get("PROJECT_ROOT", "")
                        if _pr:
                            _mdir = os.path.join(_pr, "metrics")
                            os.makedirs(_mdir, exist_ok=True)
                            _entry = _jc.dumps({
                                "ts": time.time(),
                                "coherence": coherence,
                                "shim_ms": topo.get("nodes", {}).get("shim", {}).get("response_ms"),
                            })
                            with open(os.path.join(_mdir, "hme-coherence.jsonl"), "a") as _f:
                                _f.write(_entry + "\n")
                        # Maturity gate: health_topology is a new system and
                        # its coherence metric can be unreliable during the
                        # first N readings (components initialize async;
                        # cache warmups look degraded; etc.). Count committed
                        # entries in hme-coherence.jsonl — only alert once the
                        # history has enough samples to establish a baseline.
                        # Until then, log the warning but don't LIFESAVER.
                        _coherence_log = os.path.join(_pr, "metrics", "hme-coherence.jsonl") if _pr else ""
                        _sample_count = 0
                        if _coherence_log and os.path.isfile(_coherence_log):
                            try:
                                with open(_coherence_log) as _clf:
                                    _sample_count = sum(1 for _ln in _clf if _ln.strip())
                            except OSError as _sc_err:
                                logger.debug(f"coherence sample count read failed: {_sc_err}")
                        _MATURITY_THRESHOLD = 50  # readings required before alerts are trusted
                        if coherence < 0.5:
                            if _sample_count < _MATURITY_THRESHOLD:
                                # Immature: detector does not yet know what
                                # baseline coherence looks like on this machine.
                                # Log to stderr so it's visible but don't
                                # escalate to LIFESAVER.
                                logger.info(
                                    f"health_topology (immature, {_sample_count}/"
                                    f"{_MATURITY_THRESHOLD} samples): coherence={coherence:.0%}"
                                    " — not alerting until baseline established"
                                )
                            else:
                                from server import context as _ctx
                                _ctx.register_critical_failure(
                                    "health_topology",
                                    f"System coherence below threshold: {coherence:.0%} — multiple components degraded",
                                    severity="WARNING",
                                )
                except Exception as _topo_err:
                    logger.warning(f"Proxy health monitor: topology coherence check failed: {_topo_err}")
                continue
            _stable_since = 0.0  # Layer 5: reset stability clock on any unhealthy event
            # L18: shim crashed — resolve any active crash predictions as "occurred"
            try:
                from server import meta_observer as _mo18
                for pred in list(_mo18._predictions):
                    if pred["outcome"] is None and pred["type"] in (
                        "shim_decay_precursor", "shim_latency_crash"
                    ):
                        _mo18.resolve_prediction(pred["id"], outcome_occurred=True)
            except Exception as _pred_err2:
                logger.debug(f"monitor: crash prediction resolve failed (non-fatal): {type(_pred_err2).__name__}: {_pred_err2}")
            logger.warning("Proxy health monitor: shim unhealthy — attempting restart")
            # Layer 0 + 2: mark RECOVERING, record crash
            try:
                from server import system_phase as sp
                from server import operational_state as ops
                sp.set_phase(sp.SystemPhase.RECOVERING, "proxy_monitor: shim unhealthy")
                ops.record_shim_crash()
            except (ImportError, AttributeError) as _phase_err:
                logger.debug(f"monitor: phase/ops transition unavailable: {_phase_err}")
            # Layer 4 + 10: register failure as parent (triggers cascade detection), capture ID
            monitor_fid = None
            try:
                from server import context as _ctx
                monitor_fid = _ctx.register_critical_failure(
                    "proxy_monitor",
                    "Shim health check failed — attempting restart",
                    severity="WARNING",
                )
            except (ImportError, AttributeError) as _reg_err:
                logger.debug(f"monitor: context.register_critical_failure unavailable: {_reg_err}")
            if ensure_shim_running(port):
                logger.info("Proxy health monitor: shim recovered")
                try:
                    from server import context as _ctx
                    from server import system_phase as sp
                    from server import resonance_detector as rd
                    _ctx._recovery_last_attempt = 0.0
                    sp.set_phase(sp.SystemPhase.READY, "proxy_monitor: shim revived")
                    rd.resolve_cascade("shim revived by proxy monitor")
                except (ImportError, AttributeError) as _rev_err:
                    logger.debug(f"monitor: recovery-side hooks unavailable: {_rev_err}")
            else:
                try:
                    from server import context as _ctx
                    _ctx.register_critical_failure(
                        "proxy_monitor",
                        "Shim died and could not be restarted — RAG calls will return empty results.",
                        severity="CRITICAL",
                        caused_by=monitor_fid,  # Layer 4: causal chain from health-check failure
                    )
                    from server import system_phase as sp
                    sp.set_phase(sp.SystemPhase.DEGRADED, "proxy_monitor: shim restart failed")
                except (ImportError, AttributeError) as _dead_err:
                    logger.debug(f"monitor: dead-shim hooks unavailable: {_dead_err}")
        except Exception as _e:
            crash_count += 1
            logger.error(f"Proxy health monitor crashed (#{crash_count}): {type(_e).__name__}: {_e}")
            if crash_count <= 3:
                # Watchdog: re-enter loop after brief pause rather than dying silently
                try:
                    from server import context as _ctx
                    _ctx.register_critical_failure(
                        "proxy_monitor",
                        f"Monitor loop crashed #{crash_count}: {type(_e).__name__}: {_e} — watchdog restarting",
                        severity="WARNING",
                    )
                except (ImportError, AttributeError) as _wd_err:
                    logger.debug(f"monitor: watchdog register unavailable: {_wd_err}")
                time.sleep(5)
            else:
                logger.error("Proxy health monitor: too many crashes — giving up")
                break


def _revive_dead_shim(port: int, engine_name: str, error: str, caused_by: str = None) -> None:
    """Background: called on first connection error — shim is dead, attempt immediate restart."""
    logger.warning(f"RAG proxy {engine_name}: connection failed ({error}) — attempting shim revival")
    if ensure_shim_running(port):
        logger.info(f"RAG proxy {engine_name}: shim revived after connection failure")
        try:
            from server import context as _ctx
            _ctx._recovery_last_attempt = 0.0  # allow recovery path to re-run
        except (ImportError, AttributeError) as _rec_err:
            logger.debug(f"revive_dead_shim: context reset unavailable: {_rec_err}")
    else:
        try:
            from server import context as _ctx
            _ctx.register_critical_failure(
                "rag_proxy",
                f"{engine_name}: shim connection failed ({error}) and could not be revived. "
                "RAG calls will return empty results until shim restarts.",
                severity="CRITICAL",
                caused_by=caused_by,  # Layer 4: causal chain from connection failure
            )
        except (ImportError, AttributeError) as _reg_err:
            logger.debug(f"revive_dead_shim: failure register unavailable: {_reg_err}")


def _notify_proxy_degraded(engine_name: str, fail_count: int) -> None:
    """Background: surface LIFESAVER when /rag returns repeated 404s (stale shim without /rag)."""
    try:
        from server import context as _ctx
        _ctx.register_critical_failure(
            "rag_proxy",
            f"{engine_name}: {fail_count} consecutive /rag 404s — shim lacks /rag endpoint (old version). "
            "Restart shim: kill $(cat /tmp/hme-http-shim.pid) and let it auto-restart.",
            severity="WARNING",
        )
    except Exception as _e:
        logger.warning(f"_notify_proxy_degraded: {_e}")


class RAGProxy:
    """Drop-in proxy for RAGEngine that routes through the HTTP shim."""

    def __init__(self, engine_name: str, port: int = _DEFAULT_PORT):
        self._engine = engine_name
        self._port = port
        self._base = f"http://127.0.0.1:{port}"
        self._bulk_indexing = _FalseEvent()
        self._consecutive_404s = 0
        self._degraded_notified = False
        self._connection_failed = False  # True after first connection error; reset on success

    def _call(self, method: str, timeout=_DISPATCH_TIMEOUT, **kwargs):
        body = json.dumps({
            "engine": self._engine,
            "method": method,
            "kwargs": kwargs,
        }).encode()
        # Layer 1: include session ID header for cross-component log correlation
        try:
            from server import context as _ctx
            session_id = _ctx.SESSION_ID
        except (ImportError, AttributeError):
            session_id = "unknown"
        req = urllib.request.Request(
            f"{self._base}/rag", data=body,
            headers={"Content-Type": "application/json", "X-HME-Session": session_id},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if self._consecutive_404s > 0:
                    self._consecutive_404s = 0
                    self._degraded_notified = False  # allow re-notification on future degradation
                if self._connection_failed:
                    self._connection_failed = False
                    # Layer 0: proxy recovered — transition to READY if we were degraded
                    try:
                        from server import system_phase as sp
                        if sp.is_degraded_or_worse():
                            sp.set_phase(sp.SystemPhase.READY, f"{self._engine} proxy recovered")
                    except (ImportError, AttributeError) as _recov_err:
                        logger.debug(f"proxy recovery phase set unavailable: {_recov_err}")
                return json.loads(resp.read()).get("result")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                self._consecutive_404s += 1
                if self._consecutive_404s >= _MAX_CONSECUTIVE_404S and not self._degraded_notified:
                    self._degraded_notified = True
                    # Layer 0: stale shim without /rag → DEGRADED
                    try:
                        from server import system_phase as sp
                        sp.set_phase(sp.SystemPhase.DEGRADED, f"{self._engine}: repeated 404 on /rag")
                    except (ImportError, AttributeError) as _deg_err:
                        logger.debug(f"proxy 404 degrade: phase unavailable: {_deg_err}")
                    # Layer 10: only notify if not already in cascade (prevent amplification)
                    _cascade_404 = False
                    try:
                        from server import resonance_detector as rd
                        _cascade_404 = rd.is_cascade_active()
                    except (ImportError, AttributeError) as _cas_err:
                        logger.debug(f"proxy 404: cascade detector unavailable: {_cas_err}")
                    if not _cascade_404:
                        threading.Thread(
                            target=_notify_proxy_degraded,
                            args=(self._engine, self._consecutive_404s),
                            daemon=True,
                        ).start()
            logger.warning(f"RAG proxy {self._engine}.{method}: {e}")
            return None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            # Connection refused / timeout — shim is dead. Trigger immediate restart.
            if not self._connection_failed:
                self._connection_failed = True
                # Layer 0: mark DEGRADED
                try:
                    from server import system_phase as sp
                    sp.set_phase(sp.SystemPhase.DEGRADED, f"{self._engine}: connection failed ({type(e).__name__})")
                except (ImportError, AttributeError) as _deg_err:
                    logger.debug(f"proxy connection degrade: phase unavailable: {_deg_err}")
                # Layer 4 + 10: register failure (triggers cascade detection), capture ID for causal chain
                conn_fid = None
                try:
                    from server import context as _ctx
                    conn_fid = _ctx.register_critical_failure(
                        f"rag_proxy.{self._engine}",
                        f"Shim connection failed ({type(e).__name__}) — attempting revival",
                        severity="WARNING",
                    )
                except (ImportError, AttributeError) as _reg_err:
                    logger.debug(f"proxy connection: register_critical_failure unavailable: {_reg_err}")
                # Layer 10: check cascade gate — don't amplify an already-cascading failure storm
                _cascade = False
                try:
                    from server import resonance_detector as rd
                    _cascade = rd.is_cascade_active()
                except (ImportError, AttributeError) as _cas_err:
                    logger.debug(f"proxy connection: cascade detector unavailable: {_cas_err}")
                if not _cascade:
                    threading.Thread(
                        target=_revive_dead_shim,
                        args=(self._port, self._engine, str(e), conn_fid),
                        daemon=True,
                    ).start()
                else:
                    logger.warning(f"RAG proxy {self._engine}: cascade active — skipping revival to prevent amplification")
            logger.warning(f"RAG proxy {self._engine}.{method}: {type(e).__name__}: {e}")
            return None
        except Exception as e:
            logger.warning(f"RAG proxy {self._engine}.{method}: {e}")
            return None

    # ── Knowledge methods ────────────────────────────────────────────────────

    def search_knowledge(self, query, top_k=10, category=None):
        return self._call("search_knowledge", query=query, top_k=top_k, category=category) or []

    def add_knowledge(self, title, content, category="general", tags=None, related_to="", relation_type=""):
        return self._call("add_knowledge", title=title, content=content, category=category,
                          tags=tags or [], related_to=related_to, relation_type=relation_type) or {}

    def remove_knowledge(self, entry_id):
        return self._call("remove_knowledge", entry_id=entry_id)

    def list_knowledge(self, category=None):
        return self._call("list_knowledge", category=category) or []

    def list_knowledge_full(self, category=None):
        return self._call("list_knowledge_full", category=category) or []

    def get_knowledge_status(self):
        return self._call("get_knowledge_status") or {}

    def compact_knowledge(self, similarity_threshold=0.85):
        return self._call("compact_knowledge", similarity_threshold=similarity_threshold) or {}

    def export_knowledge(self, category=None):
        return self._call("export_knowledge", category=category) or ""

    # ── Code search methods ──────────────────────────────────────────────────

    def search(self, query, top_k=10, language=None):
        return self._call("search", query=query, top_k=top_k, language=language) or []

    def search_budgeted(self, query, max_tokens=8000, language=None):
        return self._call("search_budgeted", query=query, max_tokens=max_tokens, language=language) or []

    def get_status(self):
        return self._call("get_status") or {}

    # ── Index methods ────────────────────────────────────────────────────────

    def index_directory(self, directory):
        return self._call("index_directory", directory=directory, timeout=120) or {}

    def index_symbols(self, symbols):
        return self._call("index_symbols", symbols=symbols, timeout=60) or {}

    def index_file(self, path):
        return self._call("index_file", path=path, timeout=10) or {}

    def clear(self):
        return self._call("clear", timeout=30)

    # ── Symbol methods ───────────────────────────────────────────────────────

    def lookup_symbol(self, name, kind="", language=""):
        return self._call("lookup_symbol", name=name, kind=kind, language=language) or []

    def search_symbols(self, query, top_k=20, kind=""):
        return self._call("search_symbols", query=query, top_k=top_k, kind=kind) or []

    def get_symbol_status(self):
        return self._call("get_symbol_status") or {}

    # ── Attribute proxies ────────────────────────────────────────────────────

    @property
    def symbol_table(self):
        return _SymbolTableProxy(self._engine, self._base)

    @property
    def model(self):
        return _ModelProxy(self._base)

    @property
    def _file_hashes(self):
        return self._call("_get_file_hashes") or {}


def get_lib_engines(port: int = _DEFAULT_PORT) -> dict:
    """Return a dict of lib_rel → RAGProxy for all lib engines registered in the shim."""
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/rag/lib-list")
        with urllib.request.urlopen(req, timeout=5) as resp:
            keys = json.loads(resp.read()).get("keys", [])
        return {key: RAGProxy(f"lib/{key}", port) for key in keys}
    except Exception as e:
        logger.warning(f"get_lib_engines: {e}")
        return {}


class _FalseEvent:
    def is_set(self):
        return False

    def set(self):
        pass

    def clear(self):
        pass


class _SymbolTableProxy:
    def __init__(self, engine, base_url):
        self._engine = engine
        self._base = base_url
        self._data = None

    def to_arrow(self):
        return self

    def to_pylist(self):
        if self._data is None:
            body = json.dumps({"engine": self._engine, "method": "_symbol_table_list"}).encode()
            req = urllib.request.Request(
                f"{self._base}/rag", data=body,
                headers={"Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    self._data = json.loads(resp.read()).get("result", [])
            except Exception:
                self._data = []
        return self._data


class _ModelProxy:
    def __init__(self, base_url):
        self._base = base_url

    def encode(self, texts, **kwargs):
        _single = isinstance(texts, str)
        texts_list = [texts] if _single else (texts if isinstance(texts, list) else list(texts))
        body = json.dumps({"method": "_encode", "kwargs": {"texts": texts_list}}).encode()
        req = urllib.request.Request(
            f"{self._base}/rag", data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                import numpy as np
                result = np.array(json.loads(resp.read()).get("result", []))
                # Single-string input: return 1D vector, not (1, 384) batch
                if _single and result.ndim == 2 and len(result) > 0:
                    return result[0]
                return result
        except Exception:
            return None
