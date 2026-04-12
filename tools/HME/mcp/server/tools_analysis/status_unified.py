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


@ctx.mcp.tool()
def status(mode: str = "all") -> str:
    """System health hub. mode='all' (default): pipeline + selftest + auto-warm.
    mode='pipeline': pipeline status only. mode='health': codebase health sweep.
    mode='coupling': coupling topology + antagonist tensions + dimension gaps.
    mode='trust': trust ecology leaderboard (all 27 systems, 200-beat sample).
    mode='perceptual': perceptual stack status (EnCodec/CLAP/verdict model).
    mode='hme': HME selftest + introspection.
    mode='freshness': age of every data source — flags stale or out-of-sync data.
    mode='resume': cold-start session briefing — synthesizes git state, nexus lifecycle,
    pipeline verdict, session narrative, and think history for context recovery."""
    _track("status")
    append_session_narrative("status", f"status({mode})")
    ctx.ensure_ready_sync()

    if mode == "resume":
        return _resume_briefing()

    if mode == "pipeline":
        from .digest import check_pipeline as _cp
        return _cp()

    if mode == "health":
        from .health import codebase_health as _ch
        return _ch()

    if mode == "coupling":
        from .coupling import coupling_intel as _ci
        return _budget_gate(_ci(mode="full"))

    if mode == "trust":
        from .trust_analysis import trust_report as _tr
        return _tr("", "")

    if mode == "perceptual":
        from .perceptual import audio_analyze as _aa
        try:
            return _aa(analysis="both")
        except Exception as e:
            err = str(e).lower()
            if "cuda" in err or "out of memory" in err or "oom" in err or "gpu" in err:
                # Check if pipeline is running (likely cause of GPU contention)
                try:
                    from .digest import check_pipeline as _cp_check
                    pipeline_status = _cp_check()
                    if "IN PROGRESS" in pipeline_status or "BLOCKED" in pipeline_status:
                        return ("Perceptual analysis unavailable: GPU busy (composition pipeline is running).\n"
                                "Re-run after pipeline completes.")
                except Exception:
                    pass
                return ("Perceptual analysis unavailable: GPU out of memory.\n"
                        "Another process may be using the GPU. Check with `nvidia-smi`.")
            return f"Perceptual analysis unavailable: {e}"

    if mode == "hme":
        from .evolution_admin import hme_selftest as _st
        return _st()

    if mode == "freshness":
        return _freshness_report()

    if mode == "introspect":
        from .evolution_admin import hme_introspect as _hi
        return _hi()

    # mode == "all" — unified overview
    parts = []

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
    except Exception:
        pass

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
    except Exception:
        pass

    return _budget_gate("\n\n".join(parts), budget=BUDGET_COMPOUND)


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
    except Exception:
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
    except Exception:
        pass

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
