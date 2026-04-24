"""Primary status() dispatcher — routes mode= to handlers in mode_handlers.py
and sub-reports in the various report modules. Registered with MCP at
import time; submodules must be loaded BEFORE __init__.py exposes
status() so their decorators run."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context

# Pull in the mode handlers and report functions that status() invokes.
from .mode_handlers import _STATUS_MODES, _list_modes
from .resource_reports import _vram_report, _freshness_report, _budget_report
from .lifecycle_reports import _resume_briefing, _evolution_priority_report, _trajectory_report
from .metric_reports import _staleness_report, _coherence_report
import threading

logger = logging.getLogger("HME")


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

    if mode == "list":
        return _list_modes()

    handler = _STATUS_MODES.get(mode)
    if handler:
        return handler()

    # mode == "all" — unified overview below
    if mode != "all":
        return f"Unknown mode '{mode}'. Available: {', '.join(sorted(_STATUS_MODES.keys()))} (or mode=list for grouped descriptions)"

    # mode == "all" — unified overview
    parts = []

    # R22 #2: Auto-proposed next actions — the emergent fifth behavior.
    # Sits above individual arc surfaces because it's the synthesis.
    try:
        import json as _json_na
        _na_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-next-actions.json")
        if os.path.isfile(_na_path):
            with open(_na_path) as _nf:
                _na = _json_na.load(_nf)
            _na_total = _na.get("total_actions")
            if _na_total is not None and _na_total > 0:
                _bits = [f"## Next Actions ({_na['total_actions']} queued)"]
                for _a in (_na.get("actions") or [])[:5]:
                    _bits.append(f"  [p{_a.get('priority')}] {_a.get('id')}: {_a.get('summary', '')[:120]}")
                parts.append("\n".join(_bits))
            else:
                parts.append("## Next Actions\n  [empty — substrate reports healthy quiescent state]")
    except Exception as _na_err:
        logger.debug(f'silent-except status_unified next-actions: {type(_na_err).__name__}: {_na_err}')

    # Arc III: Legendary state drift — preemptive detection from inverse
    # reasoning. If current state drifted >2σ from legendary envelope, the
    # outliers name the exact dimensions that departed. Appears above pattern
    # matches because drift is the signal patterns react to.
    try:
        import json as _json_drift
        _drift_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-legendary-drift.json")
        if os.path.isfile(_drift_path):
            with open(_drift_path) as _df:
                _drift = _json_drift.load(_df)
            _status = _drift.get("status")
            _n = _drift.get("envelope_n")
            if _n is None:
                _n = 0
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
        _pat_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-pattern-matches.json")
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
        _eff_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-invariant-efficacy.json")
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
        _con_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-consensus.json")
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
        _retire_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "legacy-override-retirement-log.jsonl")
        _juris_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hypermeta-jurisdiction.json")
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
        _alert_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hci-regression-alert.json")
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
        _m = os.path.join(ctx.PROJECT_ROOT, "output", "metrics")
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
        _vram_hist = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "vram-history.jsonl")
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


