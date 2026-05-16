"""Mode handlers -- extracted from mode_handlers.py.
mode_handlers.py imports back and registers in _STATUS_MODES.
"""
from __future__ import annotations

import json
import logging
import os

from hme_env import ENV
from server import context as ctx
from .. import (
    _track, get_session_intent, _budget_gate, _budget_section, _git_run,
    BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION,
)
from ..synthesis_session import (
    append_session_narrative, get_session_narrative, get_think_history_context,
)

logger = logging.getLogger("HME")




def _mode_hci_by_subtag():
    """Aggregate verifier status by subtag -- answers 'what KIND of broken
    is everything that's red?' Joins the live snapshot (status+score per
    verifier) with REGISTRY introspection (which has the subtag attribute
    declared on each verifier class)."""
    import os as _os
    import json as _json
    import sys as _sys
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", "") or "."
    snap_path = _os.path.join(ENV.require("METRICS_DIR"), "hci-verifier-snapshot.json")
    if not _os.path.isfile(snap_path):
        return ("# i/status mode=hci-by-subtag\n"
                "No snapshot found -- run `python3 tools/HME/tools/HME/scripts/verify-coherence.py` first.")
    try:
        with open(snap_path) as _f:
            snap = _json.load(_f)
    except (OSError, ValueError) as e:
        return f"# i/status mode=hci-by-subtag\nFailed to read snapshot: {e}"

    # Introspect REGISTRY for subtags
    _scripts = _os.path.join(_root, "tools", "HME", "scripts")
    if _scripts not in _sys.path:
        _sys.path.insert(0, _scripts)
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception as e:
        return f"# i/status mode=hci-by-subtag\nFailed to import REGISTRY: {e}"
    name_to_subtag = {}
    for v in REGISTRY:
        name_to_subtag[v.name] = getattr(v, "subtag", "(none)")

    # Aggregate
    verifiers = snap.get("verifiers", {})
    by_subtag: dict[str, dict[str, list[tuple[str, float]]]] = {}
    for name, info in verifiers.items():
        subtag = name_to_subtag.get(name, "(unknown)")
        status = info.get("status", "?")
        score = info.get("score", 0.0)
        by_subtag.setdefault(subtag, {}).setdefault(status, []).append((name, score))

    out = [f"# HCI by subtag (HCI {snap.get('hci', '?')}/100)"]
    out.append("")
    # Render: subtag -> counts + names of non-PASS
    for subtag in sorted(by_subtag.keys()):
        statuses = by_subtag[subtag]
        total = sum(len(v) for v in statuses.values())
        passed = len(statuses.get("PASS", []))
        non_pass = total - passed
        marker = " " if non_pass == 0 else "!"
        summary = f"  {marker} {subtag:24} {passed}/{total} PASS"
        if non_pass > 0:
            non_pass_names = []
            for st in ("FAIL", "ERROR", "WARN", "SKIP"):
                if st in statuses:
                    for nm, sc in statuses[st]:
                        non_pass_names.append(f"{nm}({st}:{sc:.2f})")
            summary += f"  -> {', '.join(non_pass_names[:3])}"
            if len(non_pass_names) > 3:
                summary += f" (+{len(non_pass_names) - 3} more)"
        out.append(summary)
    out.append("")
    out.append("# Drill-in:")
    out.append("  i/why mode=verifier <name>     status + history + source for one verifier")
    out.append("  i/status mode=hci-diff         what changed since last run")
    return "\n".join(out)


def _mode_hci_diff():
    """Show what verifier statuses changed since the last HCI engine run.
    Compares hci-verifier-snapshot.json (current) against .prev (previous);
    surfaces only verifiers whose status changed or whose score moved by
    more than 0.05. Best-effort: if .prev is absent, says so."""
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", "") or "."
    cur_path = _os.path.join(ENV.require("METRICS_DIR"), "hci-verifier-snapshot.json")
    prev_path = cur_path + ".prev"
    if not _os.path.isfile(cur_path):
        return ("# i/status mode=hci-diff\n"
                "No snapshot found -- run `python3 tools/HME/tools/HME/scripts/verify-coherence.py` first.")
    if not _os.path.isfile(prev_path):
        return ("# i/status mode=hci-diff\n"
                "No prior snapshot to diff -- run the engine twice (once to seed .prev).")
    try:
        with open(cur_path) as _f:
            cur = _json.load(_f)
        with open(prev_path) as _f:
            prev = _json.load(_f)
    except (OSError, ValueError) as _e:
        return f"# i/status mode=hci-diff\nsnapshot read failed: {_e}"

    cur_v = cur.get("verifiers", {})
    prev_v = prev.get("verifiers", {})
    status_changes = []
    score_moves = []
    added = sorted(set(cur_v) - set(prev_v))
    removed = sorted(set(prev_v) - set(cur_v))
    for name in sorted(set(cur_v) & set(prev_v)):
        cs, ps = cur_v[name].get("status"), prev_v[name].get("status")
        cscore = float(cur_v[name].get("score") or 0)
        pscore = float(prev_v[name].get("score") or 0)
        if cs != ps:
            status_changes.append(f"  {name:36}  {ps} -> {cs}")
        elif abs(cscore - pscore) >= 0.05:
            arrow = "^" if cscore > pscore else "v"
            score_moves.append(f"  {name:36}  {pscore:.2f} {arrow} {cscore:.2f}")

    out = ["# HCI verifier diff (current vs .prev snapshot)"]
    out.append(f"  HCI: {prev.get('hci', '?')} -> {cur.get('hci', '?')}")
    out.append("")
    if status_changes:
        out.append("status changes:")
        out.extend(status_changes)
        out.append("")
    if score_moves:
        out.append("score moves (>=0.05):")
        out.extend(score_moves)
        out.append("")
    if added:
        out.append(f"added verifiers ({len(added)}): {', '.join(added)}")
    if removed:
        out.append(f"removed verifiers ({len(removed)}): {', '.join(removed)}")
    if not (status_changes or score_moves or added or removed):
        out.append("(no verifier status changes; no score moves >=0.05)")
    return "\n".join(out)


def _mode_race_stats():
    """Summarize recent local-vs-cloud race outcomes from
    hme-race-outcomes.jsonl. Helps tune _RACE_CLOUD_DELAY_SEC -- if local
    wins >=80% of races, the delay can probably be raised (less wasted
    cloud work); if cloud wins often, either delay is too long or local
    is the bottleneck for these query shapes."""
    import os as _os
    import json as _json
    from server import context as _ctx
    out_dir = ENV.require("METRICS_DIR")
    path = _os.path.join(out_dir, "hme-race-outcomes.jsonl")
    if not _os.path.isfile(path):
        return "## Race Stats\n  (no races run yet -- hme-race-outcomes.jsonl absent)"
    try:
        # Scan last 128KB of the log
        size = _os.path.getsize(path)
        read_from = max(0, size - 128 * 1024)
        with open(path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()
            text = f.read().decode("utf-8", errors="replace")
    except OSError as _err:
        return f"## Race Stats\n  (read failed: {_err})"
    entries: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(_json.loads(line))
        except _json.JSONDecodeError:
            continue
    if not entries:
        return "## Race Stats\n  (log empty)"
    tally: dict[str, int] = {}
    lat_local: list[int] = []
    lat_cloud: list[int] = []
    for e in entries:
        tally[e.get("winner", "?")] = tally.get(e.get("winner", "?"), 0) + 1
        if isinstance(e.get("local_ms"), int):
            lat_local.append(e["local_ms"])
        if isinstance(e.get("cloud_ms"), int):
            lat_cloud.append(e["cloud_ms"])
    total = len(entries)
    lines = [
        "## Race Stats",
        f"  sample: {total} races (last ~128KB of hme-race-outcomes.jsonl)",
        "",
        "  Winner distribution:",
    ]
    for w, n in sorted(tally.items(), key=lambda x: -x[1]):
        pct = (n * 100) // total
        lines.append(f"    {w:<12} {n:>5}  ({pct}%)")
    if lat_local:
        lat_local.sort()
        p50 = lat_local[len(lat_local) // 2]
        p95 = lat_local[int(len(lat_local) * 0.95)]
        lines.append(f"\n  local  latency: p50={p50}ms  p95={p95}ms  (n={len(lat_local)})")
    if lat_cloud:
        lat_cloud.sort()
        p50 = lat_cloud[len(lat_cloud) // 2]
        p95 = lat_cloud[int(len(lat_cloud) * 0.95)]
        lines.append(f"  cloud  latency: p50={p50}ms  p95={p95}ms  (n={len(lat_cloud)})")
    lines.append("")
    lines.append(f"  Tuning tip: `_RACE_CLOUD_DELAY_SEC` currently 2.5s. "
                 f"If local wins >=80% raise it; if cloud wins most races the delay "
                 f"may be cutting local work off early -- investigate.")
    return "\n".join(lines)


