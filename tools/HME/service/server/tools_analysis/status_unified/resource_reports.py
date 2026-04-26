"""Resource reports: VRAM, freshness, budget."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context
import datetime

logger = logging.getLogger("HME")


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

    hist_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "vram-history.jsonl")
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

    m = os.path.join(ctx.PROJECT_ROOT, "output", "metrics")
    sources = [
        ("trace.jsonl",          os.path.join(m, "trace.jsonl")),
        ("pipeline-summary.json", os.path.join(m, "pipeline-summary.json")),
        ("adaptive-state.json",  os.path.join(m, "adaptive-state.json")),
        ("feedback_graph.json",  os.path.join(m, "feedback_graph.json")),
        ("trace-replay.json",    os.path.join(m, "trace-replay.json")),
        ("journal.md (archive)", os.path.join(m, "journal.md")),
        ("hme-activity.jsonl",   os.path.join(m, "hme-activity.jsonl")),
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


def _budget_report() -> str:
    """Render metrics/hme-coherence-budget.json (Phase 5.2)."""
    path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-coherence-budget.json")
    if not os.path.exists(path):
        return (
            "# Coherence Budget\n\n"
            "output/metrics/hme-coherence-budget.json not found.\n"
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


