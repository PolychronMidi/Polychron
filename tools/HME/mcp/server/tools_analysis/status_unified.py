"""HME status — unified system health and status hub.

Merges check_pipeline + hme_admin(selftest) + coupling overview + trust ecology
into one 'is everything OK?' call with mode selection.
Auto-warms stale GPU contexts when detected.
"""
import json
import logging
import os
from server import context as ctx
from . import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from .synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context

logger = logging.getLogger("HME")


@ctx.mcp.tool(meta={"hidden": True})
def _mode_pipeline():
    from .digest import check_pipeline as _cp
    return _cp()

def _mode_health():
    from .health import codebase_health as _ch
    return _ch()

def _mode_coupling():
    from .coupling import coupling_intel as _ci
    return _budget_gate(_ci(mode="full"))

def _mode_trust():
    from .trust_analysis import trust_report as _tr
    return _tr("", "")

def _mode_hme():
    from ..evolution_admin import hme_selftest as _st
    return _st()

def _mode_activity():
    from .activity_digest import activity_digest as _ad
    return _ad(window="round")

def _mode_blindspots():
    from .blindspots import blindspots as _bs
    return _bs()

def _mode_hypotheses():
    from .hypothesis_registry import hypotheses_report as _hr
    return _hr()

def _mode_drift():
    from .semantic_drift_report import semantic_drift_report as _sd
    return _sd()

def _mode_accuracy():
    from .prediction_accuracy import prediction_accuracy_report as _pa
    return _pa()

def _mode_crystallized():
    from .crystallizer import crystallized_report as _cr
    return _cr()

def _mode_music_truth():
    from .epistemic_reports import music_truth_report as _mt
    return _mt()

def _mode_kb_trust():
    from .epistemic_reports import kb_trust_report as _kt
    return _kt()

def _mode_intention_gap():
    from .epistemic_reports import intention_gap_report as _ig
    return _ig()

def _mode_self_audit():
    from .self_audit import self_audit_report as _sa
    return _sa()

def _mode_probes():
    from .probe import probes_report as _pr
    return _pr()

def _mode_negative_space():
    from .negative_space import negative_space_report as _ns
    return _ns()

def _mode_cognitive_load():
    from .cognitive_load import cognitive_load_report as _cl
    return _cl()

def _mode_ground_truth():
    from .ground_truth import ground_truth_report as _gt
    return _gt()

def _mode_constitution():
    from .phase6_reports import constitution_report as _c
    return _c()

def _mode_doc_drift():
    from .phase6_reports import doc_drift_report as _dd
    return _dd()

def _mode_generalizations():
    from .phase6_reports import generalizations_report as _gr
    return _gr()

def _mode_reflexivity():
    from .phase6_reports import reflexivity_report as _rr
    return _rr()

def _mode_multi_agent():
    from .multi_agent import multi_agent_report as _ma
    return _ma()

def _mode_perceptual():
    from .perceptual import audio_analyze as _aa
    try:
        return _aa(analysis="both")
    except Exception as e:
        err = str(e).lower()
        if "cuda" in err or "out of memory" in err or "oom" in err or "gpu" in err:
            try:
                from .digest import check_pipeline as _cp_check
                pipeline_status = _cp_check()
                if "IN PROGRESS" in pipeline_status or "BLOCKED" in pipeline_status:
                    return ("Perceptual analysis unavailable: GPU busy (pipeline running).\n"
                            "Re-run after pipeline completes.")
            except Exception as _cp_err:
                logger.debug(f"_mode_perceptual pipeline-check: {type(_cp_err).__name__}: {_cp_err}")
            return "Perceptual analysis unavailable: GPU out of memory.\nCheck with `nvidia-smi`."
        return f"Perceptual analysis unavailable: {e}"

def _mode_introspect():
    from ..evolution_admin import hme_introspect as _hi
    return _hi()


# Mode registry
_STATUS_MODES: dict[str, callable] = {
    "resume": lambda: _resume_briefing(),
    "pipeline": _mode_pipeline,
    "health": _mode_health,
    "coupling": _mode_coupling,
    "trust": _mode_trust,
    "perceptual": _mode_perceptual,
    "hme": _mode_hme,
    "activity": _mode_activity,
    "staleness": lambda: _staleness_report(),
    "coherence": lambda: _coherence_report(),
    "blindspots": _mode_blindspots,
    "hypotheses": _mode_hypotheses,
    "drift": _mode_drift,
    "accuracy": _mode_accuracy,
    "crystallized": _mode_crystallized,
    "music_truth": _mode_music_truth,
    "kb_trust": _mode_kb_trust,
    "intention_gap": _mode_intention_gap,
    "self_audit": _mode_self_audit,
    "probes": _mode_probes,
    "trajectory": lambda: _trajectory_report(),
    "budget": lambda: _budget_report(),
    "negative_space": _mode_negative_space,
    "cognitive_load": _mode_cognitive_load,
    "ground_truth": _mode_ground_truth,
    "constitution": _mode_constitution,
    "doc_drift": _mode_doc_drift,
    "generalizations": _mode_generalizations,
    "priorities": lambda: _evolution_priority_report(),
    "next": lambda: _evolution_priority_report(),
    "reflexivity": _mode_reflexivity,
    "multi_agent": _mode_multi_agent,
    "freshness": lambda: _freshness_report(),
    "vram": lambda: _vram_report(),
    "introspect": _mode_introspect,
}


@ctx.mcp.tool()
def status(mode: str = "all") -> str:
    """System health hub. 35+ modes surface Phase 2-6 observability signals.
    mode='all' (default): pipeline + selftest + auto-warm + cascade status.
    Other modes: pipeline, health, coupling, trust, perceptual, hme, activity,
    staleness, coherence, blindspots, hypotheses, drift, accuracy, crystallized,
    music_truth, kb_trust, intention_gap, self_audit, probes, trajectory, budget,
    negative_space, cognitive_load, ground_truth, constitution, doc_drift,
    generalizations, priorities, reflexivity, multi_agent, freshness, vram,
    introspect, resume."""
    _track("status")
    append_session_narrative("status", f"status({mode})")
    ctx.ensure_ready_sync()

    handler = _STATUS_MODES.get(mode)
    if handler:
        return handler()

    # mode == "all" — unified overview below
    if mode != "all":
        return f"Unknown mode '{mode}'. Available: {', '.join(sorted(_STATUS_MODES.keys()))}"

    # mode == "all" — unified overview
    parts = []

    # Arc III: Legendary state drift — preemptive detection from inverse
    # reasoning. If current state drifted >2σ from legendary envelope, the
    # outliers name the exact dimensions that departed. Appears above pattern
    # matches because drift is the signal patterns react to.
    try:
        import json as _json_drift
        _drift_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-legendary-drift.json")
        if os.path.isfile(_drift_path):
            with open(_drift_path) as _df:
                _drift = _json_drift.load(_df)
            _status = _drift.get("status")
            _n = _drift.get("envelope_n") or 0
            _score = _drift.get("drift_score")
            if _status == "drift_detected":
                _outs = ", ".join(
                    f"{o['field']}(z={o['z_score']:+.2f})"
                    for o in (_drift.get("outliers") or [])[:3]
                )
                parts.append(
                    f"## Legendary Drift [!!]\n"
                    f"  drift={_score} (threshold={_drift.get('drift_threshold')}) "
                    f"envelope_n={_n}\n"
                    f"  outliers: {_outs}"
                )
            elif _status == "within_envelope" and _score is not None:
                parts.append(
                    f"## Legendary Drift [ok]\n"
                    f"  drift={_score} envelope_n={_n} "
                    f"(within {_drift.get('drift_threshold')}σ)"
                )
    except Exception as _drift_err:
        logger.debug(f'silent-except status_unified drift: {type(_drift_err).__name__}: {_drift_err}')

    # Arc II: Matched patterns — the MOST actionable surface in status output.
    # Each match names a specific action script. Sits at the top because if
    # any pattern fires, THAT is what the next turn should address.
    try:
        import json as _json_pat
        _pat_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-pattern-matches.json")
        if os.path.isfile(_pat_path):
            with open(_pat_path) as _pf:
                _pat = _json_pat.load(_pf)
            _matches = _pat.get("matches") or []
            if _matches:
                _bits = [f"## Matched Patterns ({len(_matches)}/{_pat.get('patterns_total', 0)})"]
                for _m in _matches:
                    _bits.append(f"  [{_m.get('category', '?')}] {_m.get('id')}")
                    if _m.get("payload"):
                        _bits.append(f"    payload: {_m['payload'][:200]}")
                    if _m.get("action_summary"):
                        _bits.append(f"    action: {_m['action_summary']}")
                parts.append("\n".join(_bits))
    except Exception as _pat_err:
        logger.debug(f'silent-except status_unified patterns: {type(_pat_err).__name__}: {_pat_err}')

    # Arc IV: Meta-measurement efficacy summary. Surfaces which invariants
    # earn their place (cited in commits) vs which are decorative/flappy.
    # Sits above consensus because it affects how we INTERPRET the consensus
    # (low invariant efficacy = invariants voter is less trustworthy).
    try:
        import json as _json_eff
        _eff_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-invariant-efficacy.json")
        if os.path.isfile(_eff_path):
            with open(_eff_path) as _ef:
                _eff = _json_eff.load(_ef)
            _cc = _eff.get("class_counts", {})
            _total = _eff.get("total_invariants", 0)
            _cands = _eff.get("retirement_candidates", [])
            _top = _eff.get("top_load_bearing", [])[:3]
            parts.append(
                f"## Invariant Efficacy\n"
                f"  total={_total} load-bearing={_cc.get('load-bearing', 0)} "
                f"historical={_cc.get('load-bearing-historical', 0)} "
                f"decorative={_cc.get('decorative', 0)} flappy={_cc.get('flappy', 0)}\n"
                + (f"  retirement_candidates: {', '.join(_cands)}\n" if _cands else "")
                + (f"  top cites: " + ", ".join(
                    f"{e['id']}({e['commits_citing']})" for e in _top) if _top else "")
            )
    except Exception as _eff_err:
        logger.debug(f'silent-except status_unified efficacy: {type(_eff_err).__name__}: {_eff_err}')

    # Arc I: Cross-substrate consensus — surface at the TOP (above retirement,
    # above HCI alert) since divergence is the most actionable hidden signal.
    try:
        import json as _json_con
        _con_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-consensus.json")
        if os.path.isfile(_con_path):
            with open(_con_path) as _cf:
                _con = _json_con.load(_cf)
            _voters = _con.get("voters", {})
            _active = [(k, v) for k, v in _voters.items() if v is not None]
            _vtr_bits = " ".join(f"{k.split('_')[0]}={v:+.2f}" for k, v in _active)
            _outs = ", ".join(o.get("voter", "?") for o in _con.get("outliers", []))
            _icon = {"low": "ok", "moderate": "~", "high": "!!"}.get(_con.get("divergence"), "?")
            parts.append(
                f"## Consensus [{_icon}]\n"
                f"  mean={_con.get('mean')} stdev={_con.get('stdev')} divergence={_con.get('divergence')} "
                f"(n={_con.get('active_count')})\n"
                f"  voters: {_vtr_bits}\n"
                + (f"  outliers: {_outs}" if _outs else "  (no outliers — substrates agree)")
            )
    except Exception as _con_err:
        logger.debug(f'silent-except status_unified consensus: {type(_con_err).__name__}: {_con_err}')

    # R17 #9: Legacy-override retirement summary. One-line status: N active,
    # N retired (with IDs + round), N keepers. Surfaces the data-driven migration
    # state of the hypermeta allowlist at a glance.
    try:
        import json as _json_ret
        _retire_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "legacy-override-retirement-log.jsonl")
        _juris_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hypermeta-jurisdiction.json")
        _active_count = None
        if os.path.isfile(_juris_path):
            with open(_juris_path) as _jf:
                _juris = _json_ret.load(_jf)
            _active_count = _juris.get("meta", {}).get("registeredUnique")
        _retired, _keepers = [], []
        if os.path.isfile(_retire_path):
            with open(_retire_path) as _rf:
                for _rl in _rf:
                    _rl = _rl.strip()
                    if not _rl:
                        continue
                    try:
                        _re = _json_ret.loads(_rl)
                    except Exception as _parse_err:
                        logger.debug(f'retirement line parse: {type(_parse_err).__name__}')
                        continue
                    if _re.get("action") == "keep":
                        _keepers.append(_re.get("id", "?"))
                    else:
                        _retired.append(f"{_re.get('id', '?')} ({_re.get('retired_in', '?')})")
        if _active_count is not None or _retired or _keepers:
            parts.append(
                f"## Legacy Overrides\n"
                f"  active={_active_count} retired={len(_retired)} keepers={len(_keepers)}\n"
                + (f"  retired: {', '.join(_retired)}\n" if _retired else "")
                + (f"  keepers: {', '.join(_keepers)}" if _keepers else "")
            )
    except Exception as _re_err:
        logger.debug(f'silent-except status_unified retirement: {type(_re_err).__name__}: {_re_err}')

    # HCI regression alert — surface FIRST since it demands action. Cleared
    # automatically by compute-musical-correlation.js when HCI stabilizes.
    try:
        import json as _json_alert
        _alert_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hci-regression-alert.json")
        if os.path.isfile(_alert_path):
            with open(_alert_path) as _af:
                _alert = _json_alert.load(_af)
            parts.append(
                f"## !! HCI REGRESSION !!\n"
                f"  {_alert.get('prev_hci')} -> {_alert.get('current_hci')} "
                f"(delta_cur={_alert.get('delta_cur')}, delta_prev={_alert.get('delta_prev')})\n"
                f"  {_alert.get('action','Investigate verifier regressions.')}"
            )
    except Exception as _ae:
        logger.debug(f'silent-except status_unified hci-regression: {type(_ae).__name__}: {_ae}')

    # Compact freshness summary — surface STALE/MISSING/SYNC issues upfront
    try:
        import glob as _gl
        from datetime import datetime as _dt
        _m = os.path.join(ctx.PROJECT_ROOT, "metrics")
        _key_files = [
            ("trace.jsonl", os.path.join(_m, "trace.jsonl")),
            ("pipeline-summary", os.path.join(_m, "pipeline-summary.json")),
            ("adaptive-state", os.path.join(_m, "adaptive-state.json")),
        ]
        _flags = []
        for _lbl, _p in _key_files:
            if not os.path.exists(_p):
                _flags.append(f"{_lbl}:MISSING")
            else:
                _age = _dt.now().timestamp() - os.path.getmtime(_p)
                if _age > 86400 * 3:
                    _flags.append(f"{_lbl}:STALE({_age/86400:.0f}d)")
        # adaptive-state specific: warn if very old (cross-run warm-start depends on it)
        _as_path = os.path.join(_m, "adaptive-state.json")
        if os.path.exists(_as_path):
            _as_age = _dt.now().timestamp() - os.path.getmtime(_as_path)
            if _as_age > 86400 * 7:
                _flags.append(f"adaptive-state:VERY_STALE({_as_age/86400:.0f}d — warm-start EMAs may be stale)")
        _snaps = sorted(_gl.glob(os.path.join(_m, "run-history", "*.json")))
        if _snaps:
            _delta = abs(os.path.getmtime(os.path.join(_m, "trace.jsonl"))
                         - os.path.getmtime(_snaps[-1])) if os.path.exists(os.path.join(_m, "trace.jsonl")) else 0
            if _delta > 300:
                _flags.append(f"SYNC:trace+run-history differ by {_delta/60:.0f}m")
        if _flags:
            parts.append(f"## Data Freshness\n  " + " | ".join(_flags) + "\n  Run `npm run main` or `status(mode='freshness')` for details.")
    except Exception as _err2:
        logger.debug(f'silent-except status_unified.py:120: {type(_err2).__name__}: {_err2}')

    # VRAM snapshot — one-line summary from the monitor's latest sample
    try:
        import json as _json_vram
        _vram_hist = os.path.join(ctx.PROJECT_ROOT, "metrics", "vram-history.jsonl")
        if os.path.isfile(_vram_hist):
            with open(_vram_hist) as _vf:
                _last = None
                for _line in _vf:
                    _line = _line.strip()
                    if _line:
                        _last = _line
            if _last:
                _rec = _json_vram.loads(_last)
                _gpu_parts = []
                for _g in _rec.get("gpus", []):
                    _gpu_parts.append(
                        f"GPU{_g['index']}: {_g['used_mb']/1024:.1f}/{_g['total_mb']/1024:.1f} GB "
                        f"({_g['util_pct']}%)"
                    )
                if _gpu_parts:
                    parts.append(f"## VRAM  {' | '.join(_gpu_parts)}  (status mode=vram for trend)")
    except Exception as _err3:
        logger.debug(f'silent-except status_unified.py:144: {type(_err3).__name__}: {_err3}')

    # Pipeline status
    try:
        from .digest import check_pipeline as _cp
        pipeline = _cp()
        parts.append(f"## Pipeline\n  {pipeline}")
    except Exception as e:
        parts.append(f"## Pipeline\n  Error: {e}")

    # System health (selftest)
    try:
        from .evolution_admin import hme_selftest as _st
        selftest = _st()
        parts.append(selftest)
    except Exception as e:
        parts.append(f"## Self-Test\n  Error: {e}")

    # Auto-warm if stale contexts detected
    try:
        from .synthesis import warm_context_status
        wcs = warm_context_status()
        stale_models = []
        unprimed_models = []
        for model_name, info in wcs.items():
            if model_name in ("arbiter", "think_history", "session_narrative"):
                continue
            if isinstance(info, dict):
                if info.get("primed") and not info.get("kb_fresh"):
                    stale_models.append(model_name)
                elif not info.get("primed"):
                    unprimed_models.append(model_name)
        needs_warm = stale_models or unprimed_models
        if needs_warm:
            label = []
            if stale_models:
                label.append(f"stale: {', '.join(m[:20] for m in stale_models)}")
            if unprimed_models:
                label.append(f"unprimed: {', '.join(m[:20] for m in unprimed_models)}")
            parts.append(f"\n## Auto-Warm\n  Contexts need priming ({'; '.join(label)})")
            parts.append("  Kicking background warm prime...")
            try:
                from .synthesis_warm import _prime_all_gpus
                import threading
                t = threading.Thread(target=_prime_all_gpus, daemon=True)
                t.start()
                parts.append("  Background warm prime started.")
            except Exception as e:
                parts.append(f"  Warm prime failed: {e}")
    except Exception as _err4:
        logger.debug(f'silent-except status_unified.py:194: {type(_err4).__name__}: {_err4}')

    # Reasoning tier cascade — global quality ranking across all providers
    try:
        lines = ["## Reasoning Cascade (absolute quality order)"]
        from .synthesis_reasoning import get_status as _rank_status
        ranking = _rank_status()
        any_up = False
        for entry in ranking:
            mark = "OK " if entry["available"] else "HIT"
            if entry["available"]:
                any_up = True
            lines.append(f"  #{entry['rank']:2d} {mark} [{entry['provider']:10s}] {entry['model']}")

        # Per-provider quota summary
        lines.append("")
        lines.append("  Provider quotas:")
        try:
            from .synthesis_gemini import get_quota_status as _gs
            g = _gs()
            used = sum(t["tokens_used"] for t in g["tiers"])
            total = sum(t["daily_limit"] for t in g["tiers"])
            lines.append(f"    gemini:     {used:,}/{total:,} tok today across {len(g['tiers'])} tiers")
        except Exception as _qe:
            lines.append(f"    gemini:     quota unavailable ({type(_qe).__name__})")
        try:
            from .synthesis_groq import get_quota_status as _grs
            gr = _grs()
            used = sum(t["requests_today"] for t in gr["tiers"])
            total = sum(t["rpd_limit"] for t in gr["tiers"])
            lines.append(f"    groq:       {used}/{total} req today across {len(gr['tiers'])} tiers")
        except Exception as _qe:
            lines.append(f"    groq:       quota unavailable ({type(_qe).__name__})")
        try:
            from .synthesis_openrouter import get_quota_status as _ors
            o = _ors()
            lines.append(f"    openrouter: {o['requests_today']}/{o['rpd_limit']} req today (shared)")
        except Exception as _qe:
            lines.append(f"    openrouter: quota unavailable ({type(_qe).__name__})")

        if not any_up:
            lines.append("")
            lines.append("  → Fallback: local qwen3:30b-a3b")
        parts.append("\n".join(lines))
    except Exception as e:
        parts.append(f"## Reasoning Cascade\n  error: {e}")

    return _budget_gate("\n\n".join(parts), budget=BUDGET_COMPOUND)


def _vram_report() -> str:
    """Read metrics/vram-history.jsonl and render recent GPU memory trend.

    The monitor daemon (vram_monitor.py) writes one JSON record per 30s with
    free/used/total MB per GPU. This renders the last ~30 minutes as a compact
    sparkline plus current state, so you can see pressure building before it
    becomes a crash. Also flags the minimum free-VRAM window seen, which is
    the metric that matters for deciding if partial offload is needed.
    """
    import json as _json
    from datetime import datetime as _dt

    hist_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "vram-history.jsonl")
    if not os.path.isfile(hist_path):
        return (
            "VRAM monitor has not written any samples yet. If this persists,\n"
            "check that the shim started vram_monitor.py (see hme_http.py\n"
            "_ensure_vram_monitor) and that nvidia-smi is on PATH."
        )
    try:
        with open(hist_path) as _f:
            _lines = _f.readlines()[-60:]  # last ~30 minutes at 30s polling
    except OSError as e:
        return f"VRAM history read failed: {e}"
    if not _lines:
        return "VRAM history file is empty."

    samples = []
    for _line in _lines:
        try:
            samples.append(_json.loads(_line))
        except ValueError:
            continue
    if not samples:
        return "VRAM history has no valid samples."

    # Organize per-GPU time series
    per_gpu: dict = {}
    for s in samples:
        for g in s.get("gpus", []):
            idx = g.get("index")
            if idx is None:
                continue
            per_gpu.setdefault(idx, []).append(g)

    parts = ["# VRAM History (last ~30 min)\n"]
    parts.append(f"Samples: {len(samples)}  |  Polling: 30s  |  File: metrics/vram-history.jsonl\n")

    for idx in sorted(per_gpu.keys()):
        rows = per_gpu[idx]
        total_mb = rows[-1].get("total_mb", 0)
        cur_free = rows[-1].get("free_mb", 0)
        cur_used = rows[-1].get("used_mb", 0)
        min_free = min(r.get("free_mb", 0) for r in rows)
        max_used = max(r.get("used_mb", 0) for r in rows)
        avg_util = sum(r.get("util_pct", 0) for r in rows) / max(len(rows), 1)

        # Sparkline of free_mb, downsampled to 20 characters
        frees = [r.get("free_mb", 0) for r in rows]
        step = max(1, len(frees) // 20)
        sampled = frees[::step][:20]
        lo, hi = min(sampled), max(sampled)
        rng = max(hi - lo, 1)
        spark = "".join("▁▂▃▄▅▆▇█"[min(7, int((v - lo) / rng * 7))] for v in sampled)

        parts.append(
            f"GPU{idx}: {cur_used/1024:.1f} GB used / {total_mb/1024:.1f} GB total  "
            f"({cur_free/1024:.1f} GB free, {avg_util:.0f}% avg util)"
        )
        parts.append(f"  free trend [{spark}]  min_free={min_free/1024:.1f} GB  max_used={max_used/1024:.1f} GB")
        # Flag pressure
        if min_free / 1024 < 1.0:
            parts.append(f"  ⚠ min_free dipped below 1 GB — consider partial offload or model shuffle")
        elif min_free / 1024 < 3.0:
            parts.append(f"  ⚡ min_free dipped below 3 GB — watch for pressure during next compute spike")

    # Monitor daemon liveness
    pid_file = "/tmp/hme-vram-monitor.pid"
    parts.append("")
    try:
        with open(pid_file) as _f:
            _pid = int(_f.read().strip())
        os.kill(_pid, 0)
        parts.append(f"Monitor daemon: alive (pid {_pid})")
    except Exception as _err:
        logger.debug(f"unnamed-except status_unified.py:329: {type(_err).__name__}: {_err}")
        parts.append("Monitor daemon: NOT running — restart shim to respawn")

    return "\n".join(parts)


def _freshness_report() -> str:
    """Show age and sync status of every HME data source."""
    import glob as _glob
    from datetime import datetime

    def _age(path: str) -> str:
        if not os.path.exists(path):
            return "MISSING"
        mtime = os.path.getmtime(path)
        delta = datetime.now().timestamp() - mtime
        if delta < 60:
            return f"{delta:.0f}s ago"
        if delta < 3600:
            return f"{delta/60:.0f}m ago"
        if delta < 86400:
            return f"{delta/3600:.1f}h ago"
        return f"{delta/86400:.1f}d ago"

    def _ts(path: str) -> float:
        return os.path.getmtime(path) if os.path.exists(path) else 0.0

    m = os.path.join(ctx.PROJECT_ROOT, "metrics")
    sources = [
        ("trace.jsonl",          os.path.join(m, "trace.jsonl")),
        ("pipeline-summary.json", os.path.join(m, "pipeline-summary.json")),
        ("adaptive-state.json",  os.path.join(m, "adaptive-state.json")),
        ("feedback_graph.json",  os.path.join(m, "feedback_graph.json")),
        ("trace-replay.json",    os.path.join(m, "trace-replay.json")),
        ("journal.md",           os.path.join(m, "journal.md")),
        ("conductor-map.md",     os.path.join(m, "conductor-map.md")),
        ("crosslayer-map.md",    os.path.join(m, "crosslayer-map.md")),
        ("narrative-digest.md",  os.path.join(m, "narrative-digest.md")),
    ]

    # Latest snapshot — prefer metrics/current-run.json named pointer (written by snapshot-run.js),
    # fall back to latest run-history glob for pre-existing runs.
    rh_dir = os.path.join(m, "run-history")
    snapshots = sorted(_glob.glob(os.path.join(rh_dir, "*.json"))) if os.path.isdir(rh_dir) else []
    current_run_path = os.path.join(m, "current-run.json")
    if os.path.exists(current_run_path):
        sources.append(("current-run.json", current_run_path))
    elif snapshots:
        sources.append(("run-history (latest)", snapshots[-1]))
    else:
        sources.append(("run-history (latest)", ""))

    parts = ["## Data Source Freshness\n"]
    parts.append(f"{'Source':<28} {'Age':<14} {'Status'}")
    parts.append("-" * 60)

    for label, path in sources:
        age = _age(path)
        if age == "MISSING":
            status_flag = "MISSING"
        elif "d ago" in age and float(age.split("d")[0]) > 3:
            status_flag = "STALE"
        else:
            status_flag = "OK"
        parts.append(f"  {label:<26} {age:<14} {status_flag}")

    # Sync check: trace.jsonl vs latest run-history snapshot
    if snapshots:
        trace_path = os.path.join(m, "trace.jsonl")
        delta = abs(_ts(trace_path) - _ts(snapshots[-1]))
        if delta > 300:
            from datetime import datetime as _dt
            t_ts = _dt.fromtimestamp(_ts(trace_path)).strftime("%Y-%m-%d %H:%M") if _ts(trace_path) else "missing"
            s_ts = _dt.fromtimestamp(_ts(snapshots[-1])).strftime("%Y-%m-%d %H:%M")
            parts.append(f"\n**SYNC WARNING**: trace.jsonl ({t_ts}) and run-history ({s_ts}) "
                         f"differ by {delta/60:.0f}m — different pipeline runs. Run `npm run main` to sync.")
        else:
            parts.append(f"\nSync: trace.jsonl and run-history are in sync (delta={delta:.0f}s).")

    return "\n".join(parts)


def _resume_briefing() -> str:
    """Cold-start briefing for context recovery after compaction or new session.

    Synthesizes git state, nexus lifecycle, pipeline verdict, session narrative,
    and think history into a structured briefing optimized for rapid re-orientation.
    """
    parts = ["# Session Resume Briefing\n"]

    # 1. Uncommitted changes (what am I in the middle of?)
    diff_stat = _git_run(["git", "diff", "--stat", "HEAD"], cwd=ctx.PROJECT_ROOT)
    if diff_stat.strip():
        parts.append("## Uncommitted Changes")
        for line in diff_stat.strip().splitlines():
            parts.append(f"  {line.strip()}")
    else:
        parts.append("## Changes: working tree clean")

    # 2. Pipeline verdict + timing
    try:
        summary_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "pipeline-summary.json")
        with open(summary_path, encoding="utf-8") as f:
            ps = json.load(f)
        verdict = ps.get("verdict")
        wall = ps.get("wallTimeSeconds", 0)
        failed = ps.get("failed", 0)
        gen = ps.get("generated", "")[:19]
        errors = ps.get("errorPatterns", [])
        parts.append(f"\n## Pipeline: {verdict or 'no verdict'} ({gen})")
        parts.append(f"  Wall time: {wall:.0f}s | Failed steps: {failed}")
        if errors:
            parts.append(f"  Error patterns: {', '.join(str(e) for e in errors[:3])}")
    except Exception as _err:
        logger.debug(f"unnamed-except status_unified.py:442: {type(_err).__name__}: {_err}")
        parts.append("\n## Pipeline: no summary available")

    # 3. Nexus lifecycle state (bash hook state read directly)
    try:
        nexus_path = os.path.join(ctx.PROJECT_ROOT, "tmp", "hme-nexus.state")
        if os.path.isfile(nexus_path):
            with open(nexus_path, encoding="utf-8") as f:
                nexus_lines = [l.strip() for l in f.readlines() if l.strip()]
            if nexus_lines:
                edits, pipeline_v, has_commit, briefs = [], "", False, []
                for line in nexus_lines:
                    segs = line.split(":", 2)
                    ntype = segs[0]
                    payload = segs[2] if len(segs) > 2 else ""
                    if ntype == "EDIT":
                        edits.append(payload)
                    elif ntype == "PIPELINE":
                        pipeline_v = payload
                    elif ntype == "COMMIT":
                        has_commit = True
                    elif ntype == "BRIEF":
                        briefs.append(payload)
                pending = []
                if edits:
                    pending.append(f"Unreviewed edits ({len(edits)}): {', '.join(edits[:6])}")
                if pipeline_v in ("STABLE", "EVOLVED") and not has_commit:
                    pending.append(f"Pipeline {pipeline_v} but NOT committed")
                if pipeline_v in ("FAILED", "DRIFTED"):
                    pending.append(f"Pipeline {pipeline_v} — needs diagnosis before continuing")
                if pending:
                    parts.append("\n## Lifecycle Pending")
                    for p in pending:
                        parts.append(f"  - {p}")
                if briefs:
                    parts.append(f"  Briefed files: {', '.join(briefs[:5])}")
    except Exception as _err5:
        logger.debug(f'silent-except status_unified.py:478: {type(_err5).__name__}: {_err5}')

    # 4. Session narrative (what has the session been doing?)
    narrative = get_session_narrative(max_entries=12)
    if narrative:
        parts.append(f"\n## Session Thread")
        parts.append(narrative.strip())

    # 5. Think history (prior reasoning exchanges)
    think_ctx = get_think_history_context()
    if think_ctx:
        parts.append(f"\n## Prior Reasoning")
        parts.append(think_ctx.strip())

    # 6. Session intent
    intent = get_session_intent()
    if intent != "unknown":
        parts.append(f"\n## Detected Intent: {intent}")

    # 7. Recent git commits (what was the last thing committed?)
    log_out = _git_run(["git", "-C", ctx.PROJECT_ROOT, "log", "--oneline", "-5"], cwd=ctx.PROJECT_ROOT)
    if log_out.strip():
        parts.append(f"\n## Recent Commits")
        for line in log_out.strip().splitlines():
            parts.append(f"  {line}")

    return "\n".join(parts)


def _evolution_priority_report() -> str:
    """Render metrics/hme-evolution-priority.json — HME's self-directed roadmap."""
    _track("evolution_priority_report")
    ppath = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-evolution-priority.json")
    if not os.path.exists(ppath):
        return "# Evolution Priorities\n\nNo priority data — run pipeline first.\n"
    try:
        data = json.load(open(ppath))
        priorities = data.get("priorities", [])
        if not priorities:
            return "# Evolution Priorities\n\nNo priorities generated.\n"
        lines = [
            "# HME Evolution Priorities",
            "",
            f"*{data['meta']['priorities_generated']} priorities from {data['meta']['signals_aggregated']} signal sources*",
            f"*Generated: {data['meta']['timestamp']}*",
            "",
        ]
        for p in priorities[:10]:
            r = p.get("rationale", "")
            ev = p.get("evidence", [{}])[0]
            lines.append(f"**#{p['rank']}** [{p['category']}] **{p['target']}** (w={p.get('weight', 0):.2f})")
            if r:
                lines.append(f"  {r}")
            lines.append(f"  evidence: {ev.get('source', '?')} → {ev.get('signal', '?')}")
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        return f"# Evolution Priorities\n\nError loading: {e}\n"


def _trajectory_report() -> str:
    """Render metrics/hme-trajectory.json (Phase 5.1)."""
    path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-trajectory.json")
    if not os.path.exists(path):
        return (
            "# Compositional Trajectory\n\n"
            "metrics/hme-trajectory.json not found.\n"
            "Run: node scripts/pipeline/compute-compositional-trajectory.js"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# Compositional Trajectory\n\nCould not read: {type(_e).__name__}: {_e}"
    meta = data.get("meta", {}) or {}
    verdict = data.get("verdict", "?")
    signals = data.get("signals", {}) or {}
    history = data.get("history", []) or []
    lines = [
        "# Compositional Trajectory",
        "",
        f"**Verdict:** {verdict}",
        f"Window: {meta.get('rounds_used', '?')}/{meta.get('window', '?')} rounds",
        "",
        "## Per-signal analysis",
    ]
    for k, s in signals.items():
        slope = s.get("slope")
        slope_s = f"{slope:+.5f}" if isinstance(slope, (int, float)) else "n/a"
        rng = s.get("range")
        rng_s = f"[{rng[0]:.3f}, {rng[1]:.3f}]" if isinstance(rng, list) and len(rng) == 2 else "n/a"
        lines.append(f"  {k:<30} {s.get('verdict', '?'):<12}  slope={slope_s}  range={rng_s}")
    if history:
        recent = history[-5:]
        lines.append("")
        lines.append("## Recent verdict history")
        for h in recent:
            lines.append(f"  {h.get('timestamp', '?')[-19:-5]}  {h.get('verdict', '?')}")
    return "\n".join(lines)


def _budget_report() -> str:
    """Render metrics/hme-coherence-budget.json (Phase 5.2)."""
    path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-coherence-budget.json")
    if not os.path.exists(path):
        return (
            "# Coherence Budget\n\n"
            "metrics/hme-coherence-budget.json not found.\n"
            "Run: node scripts/pipeline/compute-coherence-budget.js"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# Coherence Budget\n\nCould not read: {type(_e).__name__}: {_e}"
    band = data.get("band") or [0, 0]
    cur = data.get("current_coherence")
    state = data.get("state", "?")
    prescription = data.get("prescription", "")
    meta = data.get("meta", {}) or {}
    gt_override = data.get("ground_truth_override")
    state_label = state
    if gt_override and gt_override.get("action") == "CONFIRMED":
        state_label = f"{state} (ground-truth CONFIRMED)"
    lines = [
        "# Coherence Budget",
        "",
        f"**State:** {state_label}",
        f"**Band:** [{band[0] * 100:.0f}%, {band[1] * 100:.0f}%]",
        f"**Current coherence:** {cur * 100:.0f}%" if isinstance(cur, (int, float)) else "**Current coherence:** n/a",
        f"**Source:** {meta.get('band_source', '?')}",
    ]
    if gt_override:
        gt_round = gt_override.get("round_tag") or "latest"
        gt_sent = gt_override.get("sentiment") or "?"
        gt_moment = gt_override.get("moment_type") or "?"
        lines.append(
            f"**Ground truth:** {gt_round} = {gt_sent}/{gt_moment}"
        )
    lines += [
        "",
        "## Prescription",
        prescription,
    ]
    return "\n".join(lines)


def _staleness_report() -> str:
    """Render metrics/kb-staleness.json. Phase 2.2 of openshell feature mapping."""
    path = os.path.join(ctx.PROJECT_ROOT, "metrics", "kb-staleness.json")
    if not os.path.exists(path):
        return (
            "# KB Staleness Index\n\n"
            "metrics/kb-staleness.json not found.\n"
            "Run: python3 scripts/pipeline/build-kb-staleness-index.py"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# KB Staleness Index\n\nCould not read: {type(_e).__name__}: {_e}"
    meta = data.get("meta", {})
    modules = data.get("modules", [])
    by_status = meta.get("by_status", {})
    stale = [m for m in modules if m.get("status") == "STALE"]
    stale.sort(key=lambda m: m.get("staleness_days") or 0, reverse=True)
    missing = [m for m in modules if m.get("status") == "MISSING"]
    lines = [
        "# KB Staleness Index",
        "",
        f"Generated: {meta.get('timestamp_iso', '?')}  "
        f"modules={meta.get('modules_tracked', '?')}  "
        f"KB entries={meta.get('kb_entries_total', '?')}",
        f"Threshold: {meta.get('stale_days_threshold', '?')} days",
        "",
        "## Status counts",
        f"  FRESH   {by_status.get('FRESH', 0)}",
        f"  STALE   {by_status.get('STALE', 0)}",
        f"  MISSING {by_status.get('MISSING', 0)}",
    ]
    if stale:
        lines.append("")
        lines.append("## Stale modules (KB older than code)")
        for m in stale[:25]:
            days = m.get("staleness_days")
            days_s = f"{days:6.1f}d" if isinstance(days, (int, float)) else "  ?"
            lines.append(
                f"  {days_s}  {m.get('module', '?'):<30}  "
                f"{m.get('kb_entries_matched', 0)} hits  {m.get('file_path', '?')}"
            )
        if len(stale) > 25:
            lines.append(f"  … and {len(stale) - 25} more")
    if missing:
        lines.append("")
        lines.append(f"## Modules with no KB coverage ({len(missing)} total, showing first 20)")
        for m in missing[:20]:
            lines.append(f"  - {m.get('module', '?')}  ({m.get('file_path', '?')})")
    return "\n".join(lines)


def _coherence_report() -> str:
    """Render metrics/hme-coherence.json. Phase 2.3 of openshell feature mapping."""
    path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-coherence.json")
    if not os.path.exists(path):
        return (
            "# Round Coherence Score\n\n"
            "metrics/hme-coherence.json not found.\n"
            "Run: node scripts/pipeline/compute-coherence-score.js"
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as _e:
        return f"# Round Coherence Score\n\nCould not read: {type(_e).__name__}: {_e}"
    score = data.get("score", 0)
    prev = data.get("previous_score")
    delta = data.get("delta")
    comps = data.get("components", {}) or {}

    def _pct(v):
        try:
            return f"{float(v) * 100:.1f}"
        except (TypeError, ValueError):
            return "?"

    delta_s = ""
    if isinstance(delta, (int, float)):
        sign = "+" if delta >= 0 else ""
        delta_s = f" ({sign}{delta * 100:+.1f} vs prev)"
    lines = [
        "# Round Coherence Score",
        "",
        f"**{_pct(score)}/100**{delta_s}  "
        f"({data.get('meta', {}).get('window_events', '?')} events in window)",
        "",
        "## Components",
        f"  read_coverage      {_pct(comps.get('read_coverage'))}   "
        f"({comps.get('read_coverage_detail', {}).get('writes_with_prior_read', 0)}"
        f"/{comps.get('read_coverage_detail', {}).get('total_writes', 0)} writes)",
        f"  violation_penalty  {_pct(comps.get('violation_penalty'))}   "
        f"(count={comps.get('violation_detail', {}).get('count', 0)})",
        f"  staleness_penalty  {_pct(comps.get('staleness_penalty'))}   "
        f"({comps.get('staleness_detail', {}).get('touches_on_stale_or_missing', 0)}"
        f"/{comps.get('staleness_detail', {}).get('touches_with_index_info', 0)} touches stale)",
    ]
    if prev is not None:
        lines.append("")
        lines.append(f"Previous round: {_pct(prev)}")
    return "\n".join(lines)
