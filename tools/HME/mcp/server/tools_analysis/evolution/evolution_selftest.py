"""HME self-test and hot-reload — tool registration, doc sync, index integrity, llama.cpp health."""
import os
import logging
import sys
import importlib

_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

from server import context as ctx
from ..synthesis import _local_think
from .. import _track

logger = logging.getLogger("HME")

# All reloadable tool modules (kept here so hme_selftest can inspect coverage via getsource).
RELOADABLE = [
    # NOTE: the three subpackage names (synthesis / evolution / coupling)
    # are deliberately absent — these subpackages ARE their hub (hub code
    # lives in __init__.py, not a sibling .py file), so reloading them
    # happens via reload of the subpackage itself which is not a typical
    # hot-reload target. Reloading individual submodules inside the
    # subpackage works because the _alias_subpackage function now skips
    # self-name collisions (see tools_analysis/__init__.py), preserving
    # __path__ on the subpackage.
    "synthesis_config", "synthesis_llamacpp", "synthesis_gemini",
    "synthesis_groq", "synthesis_openrouter", "synthesis_cerebras",
    "synthesis_mistral", "synthesis_nvidia", "synthesis_reasoning",
    "synthesis_session", "synthesis_warm", "synthesis_pipeline", "synthesis_proxy_route",
    "synthesis_inference", "synthesis_cascade", "synthesis_provider_base",
    "request_coordinator",
    "warm_disk", "warm_persona",
    "tool_cache",
    "symbols", "workflow", "workflow_audit",
    "reasoning", "reasoning_think",
    "health",
    "evolution_next", "evolution_suggest",
    "evolution_trace", "evolution_strategies",
    "evolution_admin", "evolution_introspect", "evolution_selftest",
    "runtime", "composition", "trust_analysis",
    "digest", "digest_analysis",
    "section_compare", "perceptual", "perceptual_engines",
    "coupling_channels", "coupling_data", "coupling_clusters", "coupling_bridges",
    "drama_map", "health_analysis", "section_labels",
    "evolution_evolve", "evolution_invariants", "search_unified", "review_unified",
    "read_unified", "learn_unified", "status_unified", "trace_unified",
    "todo", "enrich_prompt", "tools_passthru", "activity_digest", "blindspots",
    "cascade_analysis", "hypothesis_registry", "prediction_accuracy",
    "semantic_drift_report", "crystallizer", "self_audit", "probe",
    "epistemic_reports", "negative_space", "cognitive_load", "ground_truth",
    "phase6_reports", "multi_agent",
]
TOP_LEVEL_RELOADABLE = ["tools_search", "tools_knowledge",
                        "meta_layers", "meta_observer"]
ROOT_RELOADABLE = ["file_walker", "lang_registry", "chunker"]


def hme_hot_reload(modules: str = "") -> str:
    """Hot-reload HME tool modules without restarting the server.

    Works against the dict-backed `tool_registry._TOOLS` — the FastMCP
    replacement. Re-importing a module causes its `@ctx.mcp.tool()` calls
    to overwrite the registry entries, so the only state we need to manage
    is stale-pyc nuking and the before/after tool-name diff for reporting.
    """
    _track("hme_hot_reload")
    from server import tool_registry

    if not modules or modules.strip().lower() == "all":
        targets = RELOADABLE + TOP_LEVEL_RELOADABLE + ROOT_RELOADABLE
    else:
        targets = [m.strip() for m in modules.split(",") if m.strip()]

    _tools = tool_registry._TOOLS

    def _tools_owned_by(module_name: str) -> set:
        owned = set()
        for tname, entry in _tools.items():
            fn = entry.get("fn")
            mod = getattr(fn, "__module__", "")
            if mod == module_name:
                owned.add(tname)
                continue
            wrapped = getattr(fn, "__wrapped__", None)
            if wrapped is not None and getattr(wrapped, "__module__", "") == module_name:
                owned.add(tname)
        return owned

    results = []
    for name in targets:
        if name in ROOT_RELOADABLE:
            full = name
        elif name in TOP_LEVEL_RELOADABLE:
            full = f"server.{name}"
        else:
            full = f"server.tools_analysis.{name}"
        mod = sys.modules.get(full)
        # Subpackage fallback: modules moved to synthesis/, evolution/, coupling/
        if mod is None:
            for subpkg in ("synthesis", "evolution", "coupling"):
                mod = sys.modules.get(f"server.tools_analysis.{subpkg}.{name}")
                if mod:
                    break
        if mod is None:
            try:
                if name in ROOT_RELOADABLE:
                    mod = importlib.import_module(name)
                elif name in TOP_LEVEL_RELOADABLE:
                    mod = importlib.import_module(f".{name}", "server")
                else:
                    try:
                        mod = importlib.import_module(f".{name}", "server.tools_analysis")
                    except (ImportError, ModuleNotFoundError):
                        for subpkg in ("synthesis", "evolution", "coupling"):
                            try:
                                mod = importlib.import_module(f".{name}", f"server.tools_analysis.{subpkg}")
                                break
                            except (ImportError, ModuleNotFoundError):
                                continue
                        else:
                            raise
                actual_full = getattr(mod, "__name__", full)
                tools_new = _tools_owned_by(actual_full)
                results.append(f"  NEW {name}: {len(tools_new)} tools loaded")
            except Exception as e:
                results.append(f"  ERR {name} (import): {e}")
            continue

        actual_full = getattr(mod, "__name__", full)
        tools_before = _tools_owned_by(actual_full)
        # Snapshot entries BEFORE deleting so we can roll back on reload failure.
        snapshot = {tname: _tools[tname] for tname in tools_before if tname in _tools}
        for tname in tools_before:
            _tools.pop(tname, None)

        # Nuke the compiled bytecode BEFORE reloading. If the .pyc is newer
        # than the .py source (common after a prior successful reload), Python
        # will use the stale bytecode and the "OK" verdict silently hides that
        # the new source never ran.
        _mod_file = getattr(mod, "__file__", None)
        if _mod_file:
            _pycache_dir = os.path.join(os.path.dirname(_mod_file), "__pycache__")
            _stem = os.path.splitext(os.path.basename(_mod_file))[0]
            if os.path.isdir(_pycache_dir):
                for _pyc_entry in os.listdir(_pycache_dir):
                    if _pyc_entry.startswith(_stem + ".") and _pyc_entry.endswith(".pyc"):
                        try:
                            os.remove(os.path.join(_pycache_dir, _pyc_entry))
                        except OSError as _unlink_err:
                            logger.debug(f"pycache nuke {_pyc_entry}: {type(_unlink_err).__name__}: {_unlink_err}")
        try:
            importlib.reload(mod)
        except Exception as e:
            # Roll back: restore the snapshot so a failed reload doesn't
            # leave the tool surface amputated.
            for tname, entry in snapshot.items():
                _tools[tname] = entry
            results.append(f"  ERR {name}: {e}")
            continue

        tools_after = _tools_owned_by(actual_full)
        removed = tools_before - tools_after
        added = tools_after - tools_before
        status_str = f"{len(tools_after)} tools"
        if removed:
            status_str += f" (-{len(removed)}: {', '.join(sorted(removed))})"
        if added:
            status_str += f" (+{len(added)}: {', '.join(sorted(added))})"
        results.append(f"  OK {name}: {status_str} (was {len(tools_before)})")

    total_tools = len(_tools)
    return (
        f"## HME Hot Reload\n"
        + "\n".join(results)
        + f"\n\nTotal tools registered: {total_tools}"
    )


def hme_selftest(verbose: bool = False) -> str:
    """Verify HME's own health: tool registration, doc sync, index integrity, llama.cpp, KB."""
    _track("hme_selftest")
    results = []

    tool_count = 0
    server_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for root, dirs, files in os.walk(server_root):
        for f in files:
            if f.endswith(".py"):
                try:
                    with open(os.path.join(root, f), encoding="utf-8") as _pyf:
                        for line in _pyf:
                            s = line.strip()
                            if s.startswith("@ctx.mcp.tool(") and s.endswith(")"):
                                tool_count += 1
                except Exception as _err1:
                    logger.debug(f"1: {type(_err1).__name__}: {_err1}")
    results.append(f"{'PASS' if tool_count >= 6 else 'FAIL'}: {tool_count} tools registered")

    try:
        from ..health import doc_sync_check
        sync = doc_sync_check("doc/HME.md")
        is_sync = "IN SYNC" in sync
        # Don't truncate the sync report — identifier names can be long and
        # the truncation masks the actual symbol being flagged.
        if is_sync:
            results.append(f"PASS: doc sync -- {sync[:80]}")
        else:
            results.append(f"FAIL: doc sync -- {sync}")
    except Exception as e:
        results.append(f"FAIL: doc sync -- {e}")

    # Doc-code stale-reference verifier (catches legacy tool name drift across
    # all doc/*.md files, not just HME.md). Runs as a subprocess so a broken
    # verifier can't crash the selftest.
    _project_root = ENV.optional("PROJECT_ROOT", "") or os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    )
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-doc-sync.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier],
                capture_output=True, text=True, timeout=30,
                env={**os.environ, "PROJECT_ROOT": _project_root},  # env-ok: subprocess needs inherited env
            )
            hits = None
            for ln in rc.stdout.splitlines():
                if ln.startswith("Drift hits:"):
                    try:
                        hits = int(ln.split(":", 1)[1].strip())
                    except ValueError:
                        pass
                    break
            if hits is None:
                results.append("WARN: doc stale-ref scan -- could not parse verifier output")
            elif hits == 0:
                results.append("PASS: doc stale-ref scan -- no legacy tool references detected")
            else:
                results.append(f"FAIL: doc stale-ref scan -- {hits} legacy tool reference(s) detected (run tools/HME/scripts/verify-doc-sync.py for details)")
        else:
            results.append("INFO: doc stale-ref scan -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: doc stale-ref scan -- {e}")

    # Onboarding flow dry-run — simulates a full walkthrough in isolation and
    # verifies every state transition + todo-tree mirror + graduation path.
    # Catches integration bugs in the chain decider before real agents hit them.
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-onboarding-flow.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier],
                capture_output=True, text=True, timeout=30,
                env={**os.environ, "PROJECT_ROOT": _project_root},  # env-ok: subprocess needs inherited env
            )
            if rc.returncode == 0:
                results.append("PASS: onboarding flow dry-run -- all transitions fire correctly")
            else:
                fail_line = next(
                    (ln for ln in rc.stdout.splitlines() if "failure" in ln.lower()),
                    "onboarding flow verifier returned nonzero",
                )
                results.append(f"FAIL: onboarding flow dry-run -- {fail_line}")
        else:
            results.append("INFO: onboarding flow dry-run -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: onboarding flow dry-run -- {e}")

    # STATES sync verifier — catches Python-shell state list drift.
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-states-sync.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier],
                capture_output=True, text=True, timeout=5,
                env={**os.environ, "PROJECT_ROOT": _project_root},  # env-ok: subprocess needs inherited env
            )
            if rc.returncode == 0:
                results.append("PASS: STATES sync -- Python and shell arrays match")
            elif rc.returncode == 1:
                results.append(f"FAIL: STATES sync -- drift between onboarding_chain.py and _onboarding.sh (run verify-states-sync.py for diff)")
            else:
                results.append(f"WARN: STATES sync -- verifier parse error")
        else:
            results.append("INFO: STATES sync -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: STATES sync -- {e}")

    # Unified HME Coherence Index — runs ALL 15 verifiers (subsumes the three
    # individual verifiers above into a single weighted score 0-100). This is
    # the subquantum-depth dimension that treats HME's own coherence the way
    # Polychron treats musical coherence: as a continuous signal, not a binary
    # pass/fail. Wired in addition to the individual verifiers so failures
    # surface granularly AND as an aggregate.
    try:
        import subprocess
        verifier = os.path.join(_project_root, "tools", "HME", "scripts", "verify-coherence.py")
        if os.path.isfile(verifier):
            rc = subprocess.run(
                ["python3", verifier, "--score"],
                capture_output=True, text=True, timeout=60,
                env={**os.environ, "PROJECT_ROOT": _project_root},  # env-ok: subprocess needs inherited env
            )
            try:
                hci = int(rc.stdout.strip())
            except (ValueError, AttributeError):
                hci = -1
            if hci >= 95:
                results.append(f"PASS: HCI -- {hci}/100 (HME coherence index)")
            elif hci >= 80:
                results.append(f"WARN: HCI -- {hci}/100 (run verify-coherence.py for breakdown)")
            elif hci >= 0:
                results.append(f"FAIL: HCI -- {hci}/100 (significant coherence drift; run verify-coherence.py)")
            else:
                results.append(f"WARN: HCI -- could not parse score from verifier")
        else:
            results.append("INFO: HCI -- verifier script not found")
    except Exception as e:
        results.append(f"WARN: HCI -- {e}")

    status: dict = {}
    try:
        ctx.ensure_ready_sync()
        status = ctx.project_engine.get_status()
        files = status.get("total_files", 0)
        chunks = status.get("total_chunks", 0)
        results.append(f"{'PASS' if files > 100 else 'FAIL'}: index -- {files} files, {chunks} chunks")
    except Exception as e:
        results.append(f"FAIL: index -- {e}")

    try:
        hashes = ctx.project_engine._file_hashes
        table_files = status.get("total_files", 0)
        hash_count = len(hashes)
        consistent = abs(hash_count - table_files) < 15
        if consistent:
            results.append(f"PASS: hash cache -- {hash_count} hashes vs {table_files} indexed files")
        else:
            results.append(
                f"WARN: hash cache -- {hash_count} hashes vs {table_files} indexed files "
                f"(stale entries from deleted/renamed files — fix: hme_admin(action='clear_index'))"
            )
    except Exception as e:
        results.append(f"FAIL: hash cache -- {e}")

    # Local inference: query the daemon directly for instance state first,
    # so a cold-booting instance reports 'loading' instead of 'FAIL' from
    # a timed-out synthesis call.
    try:
        from server.startup_validator import _probe_llamacpp_instance
        _arb_url = ENV.require("HME_LLAMACPP_ARBITER_URL")
        _cod_url = ENV.require("HME_LLAMACPP_CODER_URL")
        _arb = _probe_llamacpp_instance(_arb_url)
        _cod = _probe_llamacpp_instance(_cod_url)
        _any_healthy = "healthy" in (_arb, _cod)
        _any_loading = "loading" in (_arb, _cod)
        _any_unreachable = "unreachable" in (_arb, _cod)
        if _any_healthy and not _any_unreachable:
            # At least one instance ready, none dead — try real synthesis.
            try:
                test = _local_think("respond with OK", max_tokens=5)
                if test:
                    results.append(f"PASS: local inference (llamacpp) -- arbiter={_arb}, coder={_cod}")
                else:
                    results.append(f"WARN: local inference -- instance state OK (arbiter={_arb}, coder={_cod}) but synthesis returned empty")
            except Exception as _syn_err:
                results.append(f"WARN: local inference -- instances reachable (arbiter={_arb}, coder={_cod}) but synthesis raised: {_syn_err}")
        elif _any_loading and not _any_unreachable:
            # Still warming up; not a failure.
            results.append(f"WARN: local inference -- LOADING (arbiter={_arb}, coder={_cod}); cold-start MoE models take 60-90s")
        else:
            results.append(f"FAIL: local inference -- UNREACHABLE (arbiter={_arb}, coder={_cod})")
    except Exception as e:
        results.append(f"FAIL: local inference probe -- {e}")

    # Reload-mechanism health: call hme_hot_reload against a known-safe target
    # so the reload path itself is verified. Without this, stale references to
    # removed APIs (e.g. ctx.mcp._inner from the pre-FastMCP era) only surface
    # the first time someone runs `hme_admin action=reload` in anger.
    try:
        _rl_out = hme_hot_reload("evolution_admin")
        if "ERR" in _rl_out:
            # Extract the first error line for the selftest summary
            _err_line = next((ln.strip() for ln in _rl_out.splitlines() if ln.strip().startswith("ERR")), "unknown error")
            results.append(f"FAIL: reload mechanism -- {_err_line}")
        elif "OK" in _rl_out:
            results.append("PASS: reload mechanism -- evolution_admin reload succeeded")
        else:
            results.append(f"WARN: reload mechanism -- unexpected output: {_rl_out[:120]}")
    except Exception as _rl_err:
        results.append(f"FAIL: reload mechanism -- {type(_rl_err).__name__}: {_rl_err}")

    # fix_antipattern plumbing check: verify the preflight daemon probe works
    # and the code path can reach synthesis. We deliberately DON'T call the
    # full synthesis — a 30-60s LLM round-trip in selftest would push total
    # selftest time past reasonable bounds. The full smoke test runs from the
    # dedicated selftest script: scripts/selftest-fix-antipattern.py
    try:
        from .evolution_admin import _daemon_health_snapshot
        _snap = _daemon_health_snapshot()
        if _snap.get("ready_aliases"):
            results.append(f"PASS: fix_antipattern preflight -- daemon reports {len(_snap['ready_aliases'])} model(s) ready")
        else:
            _statuses = _snap.get("statuses", {})
            results.append(
                f"WARN: fix_antipattern preflight -- no models ready: "
                f"{', '.join(f'{k}:{v.split()[0]}' for k, v in _statuses.items())}"
            )
    except Exception as _fa_outer:
        results.append(f"FAIL: fix_antipattern preflight -- {type(_fa_outer).__name__}: {_fa_outer}")

    try:
        from ..synthesis import warm_context_status
        from . import synthesis_llamacpp as _so
        _so._refresh_arbiter()
        _ARBITER_MODEL = _so._ARBITER_MODEL
        wcs = warm_context_status()
        for model_name, info in wcs.items():
            if model_name in ("arbiter", "think_history", "session_narrative"):
                continue
            if isinstance(info, dict) and info.get("primed"):
                _tokens = info.get("tokens", 0)
                _age = info.get("age_s", 0)
                if _tokens < 100:
                    results.append(f"FAIL: warm ctx {model_name[:20]} -- claims primed but only {_tokens} tokens (priming likely failed)")
                elif _age > 3600:
                    results.append(f"WARN: warm ctx {model_name[:20]} -- {_tokens} tokens but {_age:.0f}s old (stale)")
                else:
                    results.append(
                        f"PASS: warm ctx {model_name[:20]} -- {_tokens} tokens, "
                        f"{'fresh' if info.get('kb_fresh') else 'STALE'}, {_age:.0f}s old"
                    )
            elif isinstance(info, dict):
                results.append(f"INFO: warm ctx {model_name[:20]} -- not primed (run hme_admin warm)")
        arbiter_info = wcs.get(_ARBITER_MODEL, {})
        arbiter_state = "primed" if isinstance(arbiter_info, dict) and arbiter_info.get("primed") else "not primed"
        results.append(f"INFO: arbiter ({_ARBITER_MODEL[:20]}) -- {arbiter_state}")
        results.append(f"INFO: think history -- {wcs.get('think_history', 0)} exchanges")
        results.append(f"INFO: session narrative -- {wcs.get('session_narrative', 0)} events")
    except Exception as _err:
        logger.debug(f"warm ctx unavailable ({type(_err).__name__}: {_err}) — llama-server may still be starting")

    try:
        kb = ctx.project_engine.list_knowledge()
        results.append(f"{'PASS' if len(kb) > 0 else 'WARN'}: KB -- {len(kb)} entries")
    except Exception as e:
        results.append(f"FAIL: KB -- {e}")

    # RELOADABLE completeness: every .py module in tools_analysis/ must be in the reload list
    try:
        _ta_dir = os.path.dirname(os.path.abspath(__file__))
        _all_modules = {
            f[:-3] for f in os.listdir(_ta_dir)
            if f.endswith(".py") and f != "__init__.py" and not f.startswith("_")
        }
        # Read RELOADABLE directly from module attributes (not from function source,
        # which doesn't contain the list definition).
        _in_list = set(RELOADABLE + TOP_LEVEL_RELOADABLE + ROOT_RELOADABLE)
        _missing = _all_modules - _in_list
        if _missing:
            results.append(f"FAIL: hot-reload coverage -- missing modules: {sorted(_missing)}")
        else:
            results.append(f"PASS: hot-reload coverage -- all {len(_all_modules)} modules in RELOADABLE")
    except Exception as e:
        results.append(f"WARN: hot-reload coverage -- check failed: {e}")

    try:
        from . import synthesis_llamacpp as _so
        if _so._last_think_failure == "timeout":
            import time as _ts_time
            _cooldown_remaining = max(0, _so._TIMEOUT_COOLDOWN_S - (_ts_time.monotonic() - _so._last_think_failure_ts))
            results.append(f"FAIL: llama.cpp cooldown -- timeout {int(_cooldown_remaining)}s remaining, synthesis calls blocked")
        elif _so._last_think_failure == "error":
            results.append(f"WARN: llama.cpp last failure -- non-timeout error (will retry)")
    except Exception as _err2:
        logger.debug(f"results.append: {type(_err2).__name__}: {_err2}")

    try:
        _log_path = os.path.join(ctx.PROJECT_ROOT, "log", "hme.log")
        if os.path.isfile(_log_path):
            import collections as _col
            import re as _re_log
            import datetime as _dt_log
            import time as _ts_mod
            _error_counts = _col.Counter()
            _warn_counts = _col.Counter()
            with open(_log_path, encoding="utf-8", errors="ignore") as _lf:
                _lines = _lf.readlines()[-500:]
            # Log format: `YYYY-MM-DD HH:MM:SS,mmm LEVEL message`. The `,\d{3} ERROR `
            # anchor ensures we match LOG-LEVEL ERROR, not the word "ERROR"
            # inside an INFO line's payload (e.g. INFO tool: {"description": "ERROR storm..."}).
            _err_re = _re_log.compile(r',\d{3}\s+ERROR\s+(.*)$')
            _warn_re = _re_log.compile(r',\d{3}\s+WARNING\s+(.*)$')
            _ts_re = _re_log.compile(r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})')
            # Freshness window: only fail on ERRORs within the last 10 minutes.
            # Older ERRORs are historical residue (already resolved or
            # pre-restart); only active failures should block.
            _now = _ts_mod.time()
            _window_s = 600  # 10 minutes
            _stale_err_count = 0
            for _line in _lines:
                _em = _err_re.search(_line)
                _wm = _warn_re.search(_line)
                if _em:
                    _tsm = _ts_re.match(_line)
                    _is_fresh = True
                    if _tsm:
                        try:
                            _ts = _dt_log.datetime.strptime(_tsm.group(1), "%Y-%m-%d %H:%M:%S").timestamp()
                            _is_fresh = (_now - _ts) <= _window_s
                        except Exception as _tse:
                            logger.debug(f"hme.log ts parse: {type(_tse).__name__}: {_tse}")
                    if _is_fresh:
                        _msg = _em.group(1).strip()[:80]
                        _error_counts[_msg] += 1
                    else:
                        _stale_err_count += 1
                elif _wm:
                    _msg = _wm.group(1).strip()[:80]
                    _warn_counts[_msg] += 1
            # Fresh ERROR entries in hme.log = active daemon failure, FAIL.
            # Stale ERRORs (> 10min old) are historical residue, INFO only.
            if _error_counts:
                _top_err = _error_counts.most_common(3)
                _total_err = sum(_error_counts.values())
                results.append(f"FAIL: hme.log -- {_total_err} FRESH ERROR line(s) (<10min, daemon-thread failures):")
                for _msg, _count in _top_err:
                    results.append(f"  > ({_count}x) {_msg}")
            if _warn_counts and not _error_counts:
                _top_w = _warn_counts.most_common(3)
                _total_w = sum(_warn_counts.values())
                results.append(f"WARN: hme.log -- {_total_w} WARNING line(s) in last 500 lines:")
                for _msg, _count in _top_w:
                    results.append(f"  > ({_count}x) {_msg}")
            elif _warn_counts:
                _total_w = sum(_warn_counts.values())
                results.append(f"INFO: hme.log -- {_total_w} additional WARNING line(s)")
            if _stale_err_count and not _error_counts:
                results.append(f"INFO: hme.log -- {_stale_err_count} historical ERROR line(s) (>10min old, already resolved)")
            if not _error_counts and not _warn_counts and not _stale_err_count:
                results.append("PASS: hme.log -- no warnings/errors in last 500 lines")
    except Exception as _err3:
        logger.debug(f"results.append: {type(_err3).__name__}: {_err3}")

    # Self-coherence probes — detect the failure modes that tonight's
    # incident exposed. Each probe fails SELFTEST (not just warns) because
    # any of these three means the system's own description of its health
    # is a lie and investigation is blocked.

    # Probe 1: exactly ONE llamacpp_daemon may run, and the llama-server
    # instance count must not exceed the declared topology (arbiter + coder = 2).
    # Tonight's duplicate-supervisor bug showed up as two supervisors
    # racing to spawn the same models; catching "more than 2 llama-servers"
    # or "more than 1 daemon" flags that class of bug directly.
    # (Can't check ppid because llama-server is spawned start_new_session=True,
    # so systemd reparents it after daemon restart — legitimate behavior.)
    try:
        import subprocess as _sp_probe
        daemon_out = _sp_probe.run(
            ["pgrep", "-f", "llamacpp_daemon.py"],
            capture_output=True, text=True, timeout=3,
        )
        daemon_pids = [p for p in daemon_out.stdout.strip().split() if p]
        ls_out = _sp_probe.run(
            ["pgrep", "-f", "tools/bin/llama-server"],
            capture_output=True, text=True, timeout=3,
        )
        ls_pids = [p for p in ls_out.stdout.strip().split() if p]

        if len(daemon_pids) > 1:
            results.append(
                f"FAIL: daemon uniqueness -- {len(daemon_pids)} llamacpp_daemon "
                f"processes running (PIDs {daemon_pids}); only one may own llama-server "
                f"lifecycle per single-writer invariant"
            )
        elif len(daemon_pids) == 0:
            results.append("WARN: daemon uniqueness -- no llamacpp_daemon running")
        else:
            results.append(f"PASS: daemon uniqueness -- 1 llamacpp_daemon (PID {daemon_pids[0]})")

        # Declared topology is 2 (arbiter + coder). More than 2 means a
        # rogue spawner — exactly tonight's incident signature.
        if len(ls_pids) > 2:
            results.append(
                f"FAIL: llama-server count -- {len(ls_pids)} processes running "
                f"(PIDs {ls_pids}); topology declares arbiter + coder = 2. "
                f"A rogue spawner is active — check for duplicate supervisor modules."
            )
        else:
            results.append(f"PASS: llama-server count -- {len(ls_pids)}/2 expected")
    except FileNotFoundError:
        results.append("WARN: spawner-ownership -- pgrep unavailable, probe skipped")
    except Exception as _e:
        results.append(f"WARN: spawner-ownership -- probe failed: {type(_e).__name__}: {_e}")

    # Probe 2: daemon log must be clean of silent thread traces. When a
    # threading.Thread(target=fn) crashes, Python writes "Exception in
    # thread ..." to stderr without raising. That pattern caused the
    # "not started" sentinel to hide the real env-parse ValueError for
    # days before tonight. We read daemon stderr log and fail if any
    # uncaught thread exception appears in the last 100 lines.
    try:
        daemon_log = os.path.join(_project_root, "log", "hme-llamacpp_daemon.out")
        if os.path.isfile(daemon_log):
            with open(daemon_log, encoding="utf-8", errors="replace") as _dl:
                recent = _dl.readlines()[-150:]
            thread_crashes = [
                ln.rstrip() for ln in recent
                if "Exception in thread" in ln
            ]
            if thread_crashes:
                results.append(
                    f"FAIL: daemon thread hygiene -- {len(thread_crashes)} unhandled "
                    f"thread exception(s) in recent daemon log. Wrap the offending "
                    f"thread target in try/except: {thread_crashes[0][:160]}"
                )
            else:
                results.append("PASS: daemon thread hygiene -- no unhandled thread exceptions in recent log")
        else:
            results.append("INFO: daemon thread hygiene -- daemon log not present (daemon not running?)")
    except Exception as _e:
        results.append(f"WARN: daemon thread hygiene -- probe failed: {type(_e).__name__}: {_e}")

    # Probe 3: every GPU's reported memory usage must be attributable to
    # a declared process. Unattributed VRAM means a dead process left
    # stuck allocations or a user-space CUDA context is squatting — both
    # block coder/arbiter respawn with silent spawn_failed. Uses
    # nvidia-smi sum vs per-process used to compute residual.
    try:
        import subprocess as _sp_probe2
        gpu_totals = _sp_probe2.check_output(
            ["nvidia-smi", "--query-gpu=index,memory.used", "--format=csv,noheader,nounits"],
            stderr=_sp_probe2.DEVNULL, timeout=3,
        ).decode().strip().splitlines()
        per_proc = _sp_probe2.check_output(
            ["nvidia-smi", "--query-compute-apps=pid,gpu_uuid,used_memory", "--format=csv,noheader,nounits"],
            stderr=_sp_probe2.DEVNULL, timeout=3,
        ).decode().strip().splitlines()
        # Map gpu index → used, attributed
        used_by_idx = {}
        for ln in gpu_totals:
            parts = [p.strip() for p in ln.split(",")]
            if len(parts) >= 2:
                used_by_idx[int(parts[0])] = (int(parts[1]), 0)  # total_used, attributed
        # Attribute per-process memory back to indices via uuid→index.
        uuid_to_idx = {}
        uuid_out = _sp_probe2.check_output(
            ["nvidia-smi", "--query-gpu=index,gpu_uuid", "--format=csv,noheader"],
            stderr=_sp_probe2.DEVNULL, timeout=3,
        ).decode().strip().splitlines()
        for ln in uuid_out:
            parts = [p.strip() for p in ln.split(",")]
            if len(parts) >= 2:
                uuid_to_idx[parts[1]] = int(parts[0])
        for ln in per_proc:
            parts = [p.strip() for p in ln.split(",")]
            if len(parts) >= 3 and parts[1] in uuid_to_idx:
                idx = uuid_to_idx[parts[1]]
                tot, attr = used_by_idx.get(idx, (0, 0))
                try:
                    used_by_idx[idx] = (tot, attr + int(parts[2]))
                except ValueError:
                    pass
        residuals = []
        for idx, (total, attr) in used_by_idx.items():
            unattributed = total - attr
            # A few MB of CUDA driver overhead is normal; 200 MB+ means a
            # leaked context or zombie process. That 170 MB stuck on cuda:1
            # after indexing-mode restore is exactly the class of bug this
            # catches.
            if unattributed > 200:
                residuals.append(f"GPU{idx}={unattributed}MB unattributed")
        if residuals:
            results.append(
                "WARN: GPU attribution -- unattributed VRAM residual: "
                + ", ".join(residuals)
                + " (stale CUDA context or zombie process; "
                "may block llama-server respawn with fits-check failure)"
            )
        else:
            results.append("PASS: GPU attribution -- all used VRAM traceable to a declared process")
    except FileNotFoundError:
        results.append("INFO: GPU attribution -- nvidia-smi unavailable, probe skipped")
    except Exception as _e:
        results.append(f"WARN: GPU attribution -- probe failed: {type(_e).__name__}: {_e}")

    # Probe 4: single-writer registry must be loadable and non-empty.
    # A broken import or an empty _OWNERS means assert_writer is no-ops,
    # silently removing the invariant. If the module isn't on path at all
    # (standalone script), this is INFO; if the module IS on path but
    # loads badly, it's a real FAIL.
    try:
        from server.lifecycle_writers import all_domains as _all_domains
        domains = _all_domains()
        if not domains:
            results.append("FAIL: single-writer registry -- _OWNERS is empty; invariants disabled")
        else:
            results.append(
                f"PASS: single-writer registry -- {len(domains)} domains registered "
                f"({', '.join(sorted(domains.keys())[:4])}{'…' if len(domains) > 4 else ''})"
            )
    except ImportError as _imp_err:
        results.append(f"WARN: single-writer registry -- module not importable: {_imp_err}")
    except Exception as _e:
        results.append(f"FAIL: single-writer registry -- probe crashed: {type(_e).__name__}: {_e}")

    # Probe 5: every registered owner MUST call assert_writer in its source.
    # A registered domain with no runtime enforcement is the exact failure
    # mode we're defending against. This grep-based probe catches the case
    # where a consumer's try/except ImportError quietly swallowed the
    # import and no one noticed the invariant was off.
    try:
        from server.lifecycle_writers import all_domains as _all_domains
        mcp_root = os.path.abspath(os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "..", "..",  # tools_analysis/evolution/ → tools_analysis/ → server/ → mcp/
        ))
        missing_calls = []
        for domain, owner_stem in _all_domains().items():
            # Find the owner's source file by walking mcp_root.
            found_path = None
            for root, _dirs, files in os.walk(mcp_root):
                if owner_stem + ".py" in files:
                    found_path = os.path.join(root, owner_stem + ".py")
                    break
            if found_path is None:
                missing_calls.append(f"{domain} → source for {owner_stem!r} not found")
                continue
            try:
                with open(found_path, encoding="utf-8", errors="replace") as _of:
                    src = _of.read()
                # Match assert_writer("domain", ...) OR assert_writer('domain', ...)
                if f'assert_writer("{domain}"' not in src and f"assert_writer('{domain}'" not in src:
                    missing_calls.append(f"{domain} → {owner_stem}.py has no assert_writer({domain!r}, ...) call")
            except OSError as _ro_err:
                missing_calls.append(f"{domain} → {found_path}: {_ro_err}")
        if missing_calls:
            results.append(
                "FAIL: invariant enforcement coverage -- registered domains "
                "without any assert_writer() call in owner source:\n"
                + "\n".join(f"    - {m}" for m in missing_calls)
                + "\n    (registered but unenforced invariants are worse than "
                "not declaring them — future callers will trust the registry)"
            )
        else:
            results.append(
                f"PASS: invariant enforcement coverage -- all {len(_all_domains())} "
                f"registered owners call assert_writer in their source"
            )
    except ImportError:
        results.append("INFO: invariant enforcement coverage -- lifecycle_writers not importable, skipped")
    except Exception as _e:
        results.append(f"WARN: invariant enforcement coverage -- probe failed: {type(_e).__name__}: {_e}")

    # Probe 6: version consistency across daemon + worker + config.
    # A wire-protocol mismatch (e.g. post-upgrade daemon talking to a
    # pre-upgrade worker) tonight would have surfaced as mystery "not
    # started" errors with no obvious culprit. Reading all endpoints'
    # /version and comparing to the canonical versions.json catches this.
    try:
        import json as _json_vc
        import urllib.request as _url
        versions_path = os.path.join(_project_root, "tools", "HME", "config", "versions.json")
        with open(versions_path) as _vf:
            canonical = _json_vc.load(_vf)
        probes = [
            ("daemon", "http://127.0.0.1:7735/version"),
            ("worker", "http://127.0.0.1:9098/version"),
        ]
        observed = {}
        for name, url in probes:
            try:
                with _url.urlopen(url, timeout=2) as _r:
                    observed[name] = _json_vc.loads(_r.read()).get("version", "?")
            except Exception as _vprobe:
                observed[name] = f"unreachable({type(_vprobe).__name__})"
        mismatches = []
        for name in ("daemon", "worker"):
            expected = canonical.get(name, "?")
            got = observed.get(name, "?")
            if expected == "?" or got == "?":
                continue
            if got.startswith("unreachable"):
                continue
            if expected != got:
                mismatches.append(f"{name}: running={got} expected={expected}")
        if mismatches:
            results.append(
                "FAIL: version consistency -- " + "; ".join(mismatches)
                + " (restart the drifted component; wire-protocol bugs here are invisible at runtime)"
            )
        else:
            results.append(
                f"PASS: version consistency -- daemon={observed.get('daemon', '?')} "
                f"worker={observed.get('worker', '?')} canonical={canonical.get('worker', '?')}"
            )
    except Exception as _e:
        results.append(f"WARN: version consistency -- probe failed: {type(_e).__name__}: {_e}")

    # MCP symlink check removed in the MCP decoupling — HME no longer registers
    # itself as an MCP server, so ~/.claude/mcp/HME is gone by design.

    # Temporal-coherence: append this run to the timeseries + check drift.
    # This turns point-in-time probes into a filmstrip so slow drift and
    # fresh regressions surface as their own signal.
    try:
        from server.coherence_timeseries import record_run, detect_drift
        # Extract HCI if it was probed.
        _hci_val = None
        for r in results:
            if r.startswith(("PASS: HCI", "WARN: HCI", "FAIL: HCI")) and " -- " in r:
                import re as _re_hci
                _m = _re_hci.search(r"(\d+)/100", r)
                if _m:
                    _hci_val = int(_m.group(1))
                break
        record_run(_project_root, _hci_val, results)
        drift_alerts = detect_drift(_project_root, min_runs=5)
        for alert in drift_alerts:
            if alert.startswith("new-regression"):
                results.append(f"FAIL: temporal drift -- {alert}")
            elif alert.startswith("recovered"):
                results.append(f"INFO: temporal drift -- {alert}")
    except Exception as _ts_err:
        results.append(f"WARN: temporal drift -- timeseries unavailable: {type(_ts_err).__name__}: {_ts_err}")

    passed = sum(1 for r in results if r.startswith("PASS"))
    failed = sum(1 for r in results if r.startswith("FAIL"))
    total = len(results)
    verdict = "READY" if failed == 0 else f"{failed} FAIL"
    header = f"## HME Self-Test: {passed}/{total} passed ({verdict})\n"
    # Enumerate PASSes only when there are failures worth triaging OR the
    # run is all-clean (full listing = reassurance signal). When failures
    # exist, PASS lines are ~700 chars of filler; agent only needs the
    # failing/warning items to act on. Use the `verbose` keyword arg via
    # hme_admin(action='selftest', modules='verbose') when full output
    # is required (mirrors invariants/stress trimming).
    has_issues = any(
        r.startswith(("FAIL", "WARN", "ERR", "INFO", "NEW"))
        for r in results
    )
    non_pass = [r for r in results if not r.startswith("PASS")]
    if has_issues and non_pass and not verbose:
        # Show only non-PASS lines + a summary count of PASSes.
        body = "\n".join(f"  {r}" for r in non_pass)
        return header + body + f"\n  ({passed} PASS suppressed — use hme_admin selftest verbose for full listing)"
    return header + "\n".join(f"  {r}" for r in results)
