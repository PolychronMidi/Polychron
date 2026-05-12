#!/usr/bin/env python3
"""i/holograph -- single-screen interstellar overview of HME's state.

One row per horizon. Each row pulls the most informative signal that
horizon contributes. Together they answer "where is HME right now,
across every dimension simultaneously?" -- a question no other single
command answers today.

Pure composition: zero new computation, all data already exists. This
is the asymptote of the observability triad -- `i/state` (snapshot),
`i/timeline` (chronology), `i/why` (causality) -- extended to span
every architectural axis at once.
"""
from __future__ import annotations
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime

from _common import PROJECT_ROOT


def _read_json(path: str):
    if not os.path.isfile(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _read_jsonl(path: str, tail: int = 1000):
    if not os.path.isfile(path):
        return []
    try:
        with open(path) as f:
            lines = f.readlines()[-tail:]
    except OSError:
        return []
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out


def _hci_phase() -> str:
    """Horizon II -- multi-timescale HCI."""
    snap = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if not snap:
        return "no snapshot"
    cur = snap.get("hci")
    rows = _read_jsonl(os.path.join(PROJECT_ROOT, "output", "metrics",
                                    "hme-coherence-timeseries.jsonl"))
    if not rows or cur is None:
        return f"{cur}/100" if cur is not None else "?"
    rows = [r for r in rows if r.get("hci") is not None]
    now = time.time()
    deltas = []
    for label, dt in [("1m", 60), ("1h", 3600), ("1d", 86400)]:
        anchor = None
        cutoff = now - dt
        for r in rows:
            if r.get("ts", 0) <= cutoff:
                anchor = r
            else:
                break
        if anchor:
            d = float(cur) - float(anchor["hci"])
            sign = "+" if d > 0 else ""
            deltas.append(f"{label}{sign}{d:.0f}")
    if rows:
        peak = max(r.get("hci", 0) for r in rows)
    else:
        peak = cur
    delta_str = " . ".join(deltas) if deltas else ""
    return f"{cur:.0f}  ({delta_str} . peak {peak:.0f})"


def _multi_axis_summary() -> str:
    """Horizon II -- per-subtag bands."""
    snap = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if not snap:
        return "no snapshot"
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception:  # silent-ok: optional panel, degraded gracefully on import fail
        return "registry import failed"
    name_to_subtag = {v.name: getattr(v, "subtag", "(none)") for v in REGISTRY}
    by_subtag = defaultdict(list)
    for name, info in snap.get("verifiers", {}).items():
        by_subtag[name_to_subtag.get(name, "(none)")].append(float(info.get("score", 0)))
    LO, HI = 0.55, 0.85
    in_band = sum(1 for vals in by_subtag.values()
                  if vals and LO <= sum(vals) / len(vals) <= HI)
    return f"{in_band}/{len(by_subtag)} axes IN_BAND  ({len(by_subtag) - in_band} ABOVE/BELOW)"


def _kb_summary() -> str:
    """Horizon III -- KB graph density."""
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "service"))
    try:
        from direct_lance import _open_table  # type: ignore
    except Exception:
        return "lance unavailable"
    table = _open_table()
    if table is None:
        return "no table"
    try:
        df = table.to_pandas()
    except Exception:
        return "read failed"
    n = len(df)
    # Count tag-encoded edges
    import re as _re
    edge_count = 0
    for tag in df.get("tags", []):
        if isinstance(tag, str) and _re.search(r"\w+:[a-f0-9]{12}", tag):
            edge_count += 1
    return f"{n} entries . {edge_count} edges  ({(edge_count / n * 100):.0f}% density)" if n else "empty"


def _agent_loop_summary() -> str:
    """Horizon IV -- agent-loop quality + tier marker."""
    snap = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if not snap:
        return "no snapshot"
    alq = (snap.get("verifiers") or {}).get("agent-loop-quality")
    if not alq:
        return "verifier absent"
    base = f"{alq.get('status', '?')}  score={alq.get('score', 0):.2f}"
    # Maturity tier marker (Horizon IV asymptote): GREEN/YELLOW/RED for
    # adaptive-priming consumers. Surface inline so the panel reflects
    # both the verifier verdict AND the actionable tier label.
    tier = _read_json(os.path.join(PROJECT_ROOT, "tmp", "hme-agent-loop-tier.json"))
    if tier:
        base += f"  .  tier={tier.get('tier', '?')}"
    return base


def _conjugate_summary() -> str:
    """Horizon V -- composition<=>HME quadrant."""
    snap = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if not snap:
        return "no snapshot"
    cv = (snap.get("verifiers") or {}).get("conjugate-channel")
    if not cv:
        return "verifier absent"
    return f"{cv.get('status', '?')}  ({cv.get('summary', '')[:60]})"


def _verifier_meta_summary() -> str:
    """Horizon VI -- meta-meta verifier health + auto-prune marker."""
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
    try:
        from verify_coherence import REGISTRY  # type: ignore
        n = len(REGISTRY)
    except Exception:
        n = 0
    snap = _read_json(os.path.join(PROJECT_ROOT, "output", "metrics",
                                   "hci-verifier-snapshot.json"))
    if not snap:
        return f"{n} verifiers . no snapshot"
    statuses = defaultdict(int)
    for info in (snap.get("verifiers") or {}).values():
        statuses[info.get("status", "?")] += 1
    parts = []
    for st in ("PASS", "FAIL", "WARN", "SKIP", "ERROR"):
        if statuses.get(st):
            parts.append(f"{st}={statuses[st]}")
    base = f"{n} verifiers . " + " ".join(parts)
    # Auto-prune marker (Horizon VI maturity): surface dead-weight
    # candidate count so the agent sees how many always-PASS verifiers
    # are diluting HCI without explicit drill-in.
    prune = _read_json(os.path.join(PROJECT_ROOT, "tmp", "hme-verifier-prune.json"))
    if prune and isinstance(prune.get("candidates"), list):
        cand_n = len(prune["candidates"])
        if cand_n > 0:
            base += f"  .  prune-candidates={cand_n}"
    return base


def _causality_summary() -> str:
    """Horizon VII -- most recent caused_by."""
    marker = _read_json(os.path.join(PROJECT_ROOT, "tmp", "hme-last-reload.json"))
    if marker and "caused_by" in marker:
        age_s = time.time() - marker.get("ts", 0)
        if age_s < 60:
            age = f"{int(age_s)}s ago"
        elif age_s < 3600:
            age = f"{int(age_s / 60)}m ago"
        else:
            age = f"{age_s / 3600:.1f}h ago"
        cb = marker['caused_by']
        cb_short = os.path.basename(cb) if "/" in cb else cb
        return f"hot_reload {age}  caused_by={cb_short}"
    return "no Tier-1 caused_by recorded"


def _conscience_summary() -> str:
    """Horizon VIII -- ground-truth verdict count."""
    p = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-ground-truth.jsonl")
    rows = _read_jsonl(p, tail=200) if os.path.isfile(p) else []
    pos = sum(1 for r in rows
              if r.get("sentiment") in ("legendary", "compelling", "surprising", "moving"))
    neg = sum(1 for r in rows
              if r.get("sentiment") in ("flat", "mechanical", "boring", "broken"))
    return f"{len(rows)} verdicts  ({pos} positive, {neg} negative)"


def _band_summary() -> str:
    """Horizon IX -- band proposal + V->IX tightening signal."""
    p = _read_json(os.path.join(PROJECT_ROOT, "tmp", "hme-band-proposal.json"))
    # V->IX bidirectional coupling: surface active tightening signal so
    # the agent sees the conjugate-channel verifier's recommendation
    # alongside the static proposal.
    tightening = _read_json(os.path.join(PROJECT_ROOT, "tmp", "hme-band-tightening.json"))
    if not p:
        if tightening:
            return f"[!] tightening signal active ({tightening.get('reason', '?')[:50]})"
        return "no proposal yet"
    cur = p.get("current_band", [0.55, 0.85])
    proposed = p.get("proposed_band", cur)
    base = (f"current [{cur[0]:.2f}, {cur[1]:.2f}] -> proposed [{proposed[0]:.2f}, {proposed[1]:.2f}]"
            if proposed != cur else
            f"current [{cur[0]:.2f}, {cur[1]:.2f}]  (no change)")
    if tightening:
        delta = tightening.get("band_delta", 0)
        base += f"  [!] V-tightening: {delta:+.2f}"
    return base


def _fractal_summary() -> str:
    """Horizon X -- fractal Gini trend."""
    p = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-fractal-history.jsonl")
    rows = _read_jsonl(p, tail=50) if os.path.isfile(p) else []
    if not rows:
        return "no measurements (run `i/why mode=fractal-shape`)"
    last = rows[-1].get("mean_gini", 0)
    if len(rows) >= 2:
        delta = last - rows[0].get("mean_gini", last)
        sign = "+" if delta > 0 else ""
        trend = f" ({sign}{delta:.2f} since first)" if abs(delta) >= 0.02 else " (steady)"
    else:
        trend = " (1 measurement)"
    return f"mean Gini {last:.2f}{trend}  ({len(rows)} runs)"


def _predict_summary() -> str:
    """Horizon I -- tool latency p50."""
    activity = _read_jsonl(os.path.join(PROJECT_ROOT, "output", "metrics",
                                        "hme-activity.jsonl"), tail=2000)
    if not activity:
        return "no activity"
    cutoff = time.time() - 3600 * 6
    inf_ts = sorted(e.get("ts", 0) for e in activity
                    if e.get("event") == "inference_call" and e.get("ts", 0) > cutoff)
    if len(inf_ts) < 5:
        return f"{len(inf_ts)} recent inference calls (insufficient for stats)"
    gaps = sorted(inf_ts[i + 1] - inf_ts[i] for i in range(len(inf_ts) - 1))
    median = gaps[len(gaps) // 2]
    return f"{len(inf_ts)} calls/6h . median gap {median:.0f}s"


def _persist_snapshot(rows: list[tuple]) -> None:
    """Append a holograph snapshot to history JSONL for trajectory view.
    Atomic-ish via append; cheap (~12 lines per row, runs at most once
    per i/holograph invocation)."""
    history_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                                "hme-holograph-history.jsonl")
    try:
        os.makedirs(os.path.dirname(history_path), exist_ok=True)
    except OSError:
        return
    snap = {
        "ts": time.time(),
        "rows": {f"{hid}:{label}": summary for hid, label, summary in rows},
    }
    try:
        with open(history_path, "a") as f:
            f.write(json.dumps(snap, separators=(",", ":")) + "\n")
    except OSError:
        pass  # silent-ok: best-effort fs op


def _render_trajectory(n: int = 5) -> int:
    """Render the last n holograph snapshots as a trajectory -- for each
    horizon row, the value across recent invocations. Cross-horizon
    time-series in one view (Horizon X * cross-horizon compounding)."""
    history_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                                "hme-holograph-history.jsonl")
    if not os.path.isfile(history_path):
        print("# i/holograph mode=trajectory")
        print("  No history yet. Run `i/holograph` (default mode) several times to accumulate.")
        return 0
    try:
        with open(history_path) as f:
            rows = [json.loads(ln) for ln in f if ln.strip()][-n:]
    except (OSError, ValueError) as e:
        print(f"# i/holograph mode=trajectory\nFailed to read history: {e}")
        return 1
    if len(rows) < 2:
        print(f"# i/holograph mode=trajectory")
        print(f"  Only {len(rows)} snapshot(s) recorded -- need >=2 for trajectory.")
        return 0

    print(f"# Holograph trajectory  (last {len(rows)} snapshots)")
    print()
    # Print timestamps as column headers
    header_ts = "  " + " " * 30
    for r in rows:
        ts_str = datetime.fromtimestamp(r.get("ts", 0)).strftime("%H:%M")
        header_ts += f"  {ts_str:>10}"
    print(header_ts)
    # Per-row trajectory
    keys = list(rows[-1].get("rows", {}).keys())
    for k in keys:
        line = f"  {k:30}"
        for r in rows:
            val = r.get("rows", {}).get(k, "")
            # Trim each cell so the row stays narrow
            short = str(val)[:30]
            line += f"  {short:>30}"
        print(line)
    print()
    print("# Note: cell width truncated to 30 chars for column alignment.")
    print("  Use `i/holograph` for the full latest snapshot.")
    return 0


def main(argv):
    mode = ""
    for a in argv[1:]:
        if a.startswith("mode="):
            mode = a.split("=", 1)[1]
    if mode == "trajectory":
        return _render_trajectory()

    rows = [
        ("I",    "Predictive HME",            _predict_summary()),
        ("II",   "Multi-timescale HCI",       _hci_phase()),
        ("II",   "Per-axis bands",            _multi_axis_summary()),
        ("III",  "KB graph density",          _kb_summary()),
        ("IV",   "Agent-loop quality",        _agent_loop_summary()),
        ("V",    "Conjugate channel",         _conjugate_summary()),
        ("VI",   "Verifier ecosystem",        _verifier_meta_summary()),
        ("VII",  "Causality (latest)",        _causality_summary()),
        ("VIII", "Conscience verdicts",       _conscience_summary()),
        ("IX",   "Chaordic band",             _band_summary()),
        ("X",    "Fractal-shape Gini",        _fractal_summary()),
    ]
    # Persist this snapshot for `mode=trajectory`. Cheap -- append-only.
    _persist_snapshot(rows)

    print("# HME Holograph -- interstellar overview")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    for hid, label, summary in rows:
        print(f"  [{hid:4}] {label:24}  {summary}")
    print()
    print("# Drill-in:")
    print("  i/state                    state-machine snapshot")
    print("  i/timeline window=10m      chronological audit trail")
    print("  i/why mode=<...>             causality / per-horizon detail")
    print("  i/holograph mode=trajectory   horizon-evolution over recent runs")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
