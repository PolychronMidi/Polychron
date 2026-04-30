"""Status-mode handlers (_mode_* wrappers) + _STATUS_MODES registry + _list_modes."""
from __future__ import annotations

import json
import logging
import os

from server import context as ctx
from .. import _track, get_session_intent, _budget_gate, _budget_section, _git_run, BUDGET_COMPOUND, BUDGET_TOOL, BUDGET_SECTION
from ..synthesis_session import append_session_narrative, get_session_narrative, get_think_history_context

# Cross-submodule report-function imports used by the _STATUS_MODES registry
# lambdas below. These functions live in the report modules; the lambdas
# invoke them by bare name, so they must be importable here at module scope.
from .resource_reports import _vram_report, _freshness_report, _budget_report
from .lifecycle_reports import (
    _resume_briefing, _evolution_priority_report, _trajectory_report,
)
from .metric_reports import _staleness_report, _coherence_report

logger = logging.getLogger("HME")


def _mode_pipeline():
    from ..digest import check_pipeline as _cp
    return _cp()

def _mode_health():
    from ..health import codebase_health as _ch
    return _ch()

def _mode_coupling():
    from ..coupling import coupling_intel as _ci
    # Status surface uses the lighter `network` view (just topology — the
    # one sub-section users actually consume in a status check). The full
    # 4-section view (network + antagonists + personalities + gaps) takes
    # ~45s and belongs behind an explicit `i/hme coupling_intel mode=full`.
    return _budget_gate(_ci(mode="network"))

def _mode_trust():
    from ..trust_analysis import trust_report as _tr
    return _tr("", "")

def _mode_hme():
    """HME session state — distinct from selftest (pre-flight readiness).
    Surfaces: onboarding step, last activity events, current verdict.
    For pre-flight readiness (PASS/FAIL count + warnings), use
    `i/hme-admin action=selftest`."""  # tool-form-ok (static docstring)
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    try:
        from tool_invocations import action_form as _action_form
    except ImportError:
        def _action_form(a): return f"i/hme-admin action={a}"
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    out = ["## HME session state",
           f"(For pre-flight check use `{_action_form('selftest')}`.)",
           ""]

    # Onboarding state
    onb_file = _os.path.join(_root, "tmp", "hme-onboarding.state")
    onb_state = "graduated"
    if _os.path.isfile(onb_file):
        try:
            with open(onb_file) as _f:
                onb_state = _f.read().strip() or "graduated"
        except OSError:
            pass
    out.append(f"  onboarding: {onb_state}")

    # Pipeline verdict
    verdict_file = _os.path.join(_root, "output", "metrics", "fingerprint-comparison.json")
    if _os.path.isfile(verdict_file):
        try:
            with open(verdict_file) as _f:
                _v = _json.load(_f)
            out.append(f"  last pipeline verdict: {_v.get('verdict', '?')}")
        except (OSError, ValueError):
            pass

    # Recent activity (last 15 events, run-length-collapsed)
    activity_file = _os.path.join(_root, "output", "metrics", "hme-activity.jsonl")
    if _os.path.isfile(activity_file):
        try:
            with open(activity_file) as _f:
                _lines = _f.readlines()[-15:]
            out.append("")
            out.append("recent activity:")
            _last_key = None
            _count = 0
            def _flush():
                if _last_key:
                    _ev, _src = _last_key
                    _label = f"{_ev}  {_src}".strip()
                    out.append(f"  {f'{_count}× ' if _count > 1 else ''}{_label}")
            for _ln in _lines:
                try:
                    _e = _json.loads(_ln)
                except ValueError:
                    continue
                _key = (_e.get("event", "?"), _e.get("source", _e.get("session", "")))
                if _key == _last_key:
                    _count += 1
                else:
                    _flush()
                    _last_key = _key
                    _count = 1
            _flush()
        except OSError:
            pass

    return "\n".join(out)

def _mode_activity():
    from ..activity_digest import activity_digest as _ad
    return _ad(window="round")


def _mode_tool_latency():
    """Horizon I expansion — tool-cost preflighting.

    Reads recent tool_call + inference_call events from the activity log
    and computes per-tool latency distributions (p50/p95/p99). Surfaces
    'this is what the next call probably costs' as a heads-up. Pairs
    with `i/why mode=predict <file>` (which predicts verifier flips):  tool-form-ok
    together they answer 'what will my next action cost AND change?'

    Limitation: tool_call events are intermittent (proxy instrumentation
    gap noted earlier); the inference_call signal is reliable. Falls
    back to inference-call-based latency when tool_call is sparse.
    """
    import os as _os
    import json as _json
    import time as _time
    from collections import defaultdict
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    activity = _os.path.join(_root, "output", "metrics", "hme-activity.jsonl")
    if not _os.path.isfile(activity):
        return "# i/status mode=tool-latency\nNo activity log."
    try:
        with open(activity) as _f:
            lines = _f.readlines()[-3000:]
    except OSError as e:
        return f"# i/status mode=tool-latency\nFailed to read: {e}"

    cutoff = _time.time() - 3600 * 6  # last 6h
    by_tool: dict[str, list[float]] = defaultdict(list)
    inf_ts: list[float] = []
    for ln in lines:
        try:
            e = _json.loads(ln)
        except ValueError:
            continue
        if e.get("ts", 0) < cutoff:
            continue
        ev = e.get("event", "")
        if ev == "tool_call":
            tool = e.get("tool", "?")
            # latency_ms isn't always present; if it is, use it
            if "latency_ms" in e:
                by_tool[tool].append(float(e["latency_ms"]))
        elif ev == "inference_call":
            inf_ts.append(e.get("ts", 0))

    out = ["# Tool-cost preflighting  (last 6h)"]
    out.append("")
    if by_tool:
        out.append(f"  {'tool':18}  {'n':>4}  {'p50':>7}  {'p95':>7}  {'p99':>7}  ms")
        for tool, latencies in sorted(by_tool.items(), key=lambda kv: -len(kv[1])):
            if len(latencies) < 3:
                continue
            s = sorted(latencies)
            p50 = s[len(s) // 2]
            p95 = s[int(len(s) * 0.95)]
            p99 = s[int(len(s) * 0.99)]
            out.append(f"  {tool:18}  {len(s):>4}  {p50:>7.0f}  {p95:>7.0f}  {p99:>7.0f}  ms")
        out.append("")
    else:
        out.append("  (no tool_call events with latency_ms in window —")
        out.append("   proxy instrumentation gap; falling back to inference cadence)")
        out.append("")

    # Inference-cadence proxy: how spaced apart are calls?
    if len(inf_ts) >= 5:
        inf_ts.sort()
        gaps = [inf_ts[i + 1] - inf_ts[i] for i in range(len(inf_ts) - 1)]
        gaps.sort()
        median_gap = gaps[len(gaps) // 2]
        p95_gap = gaps[int(len(gaps) * 0.95)]
        out.append(f"  inference-call cadence (proxy for round-trip cost):")
        out.append(f"    {len(inf_ts)} calls · median gap {median_gap:.1f}s · p95 {p95_gap:.1f}s")
        out.append("")

    out.append("# Reading the table:")
    out.append("  - Use to estimate the cost of an upcoming call BEFORE making it.")
    out.append("  - High p99 = occasionally slow; high p50 = always slow.")
    out.append("  - Pairs with `i/why mode=predict <file>` for cost AND change predictions.")  # tool-form-ok: drill-in advisory; literal command shape is the contract
    return "\n".join(out)


def _mode_multi_axis_band():
    """Horizon II expansion — multi-axis bands.

    Today's chaordic band is [55, 85] for the aggregate HCI score, one
    homeostat across all dimensions. The chaordic edge is N-dimensional;
    a system can be over-ordered along structural-integrity AND
    under-ordered along freshness simultaneously, and the aggregate
    band hides both.

    This view computes the per-subtag HCI sub-score (sum of weighted
    PASS/FAIL/WARN scores within each subtag) and reports each axis's
    position relative to a default [0.55, 0.85] band. Turns the single
    homeostat into N independent ones — agent reads which axes are
    saturated, which are starving, which are healthy.
    """
    import os as _os
    import json as _json
    import sys as _sys
    from collections import defaultdict
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    snap_path = _os.path.join(_root, "output", "metrics", "hci-verifier-snapshot.json")
    if not _os.path.isfile(snap_path):
        return ("# i/status mode=multi-axis-band\n"
                "No snapshot — run `python3 tools/HME/scripts/verify-coherence.py` first.")
    try:
        with open(snap_path) as _f:
            snap = _json.load(_f)
    except (OSError, ValueError) as e:
        return f"# i/status mode=multi-axis-band\nFailed to read snapshot: {e}"

    _scripts = _os.path.join(_root, "tools", "HME", "scripts")
    if _scripts not in _sys.path:
        _sys.path.insert(0, _scripts)
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception as e:
        return f"# i/status mode=multi-axis-band\nFailed to import REGISTRY: {e}"

    # Index verifiers by name for subtag + weight lookup
    name_to_meta: dict[str, tuple[str, float]] = {}
    for v in REGISTRY:
        name_to_meta[v.name] = (
            getattr(v, "subtag", "(none)"),
            float(getattr(v, "weight", 1.0)),
        )

    # Aggregate per subtag: weighted-score sum / weighted-max sum
    by_subtag: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for name, info in snap.get("verifiers", {}).items():
        meta = name_to_meta.get(name)
        if meta is None:
            continue
        subtag, weight = meta
        score = float(info.get("score", 0.0))
        by_subtag[subtag].append((score * weight, weight))

    LO, HI = 0.55, 0.85

    out = [f"# Multi-axis chaordic bands  (per-subtag HCI; default band [{LO}, {HI}])"]
    out.append("")
    out.append(f"  {'subtag':24}  {'verifiers':>9}  {'score':>5}  {'state':>9}")
    rows = []
    for subtag, pairs in sorted(by_subtag.items()):
        if not pairs:
            continue
        weighted_total = sum(p[0] for p in pairs)
        weight_sum = sum(p[1] for p in pairs) or 1.0
        score = weighted_total / weight_sum
        if score < LO:
            state = "BELOW"
        elif score > HI:
            state = "ABOVE"
        else:
            state = "IN_BAND"
        rows.append((subtag, len(pairs), score, state))
    rows.sort(key=lambda r: (r[3] != "IN_BAND", -r[2]))
    for subtag, n, score, state in rows:
        marker = " " if state == "IN_BAND" else "!"
        out.append(f"  {marker} {subtag:22}  {n:>9}  {score:>5.2f}  {state:>9}")

    out.append("")
    out.append("# Reading the table:")
    out.append("  - BELOW band = axis is starved (too few PASSes / too low weighted score)")
    out.append("  - ABOVE band = axis is saturated (everything green; could license exploration)")
    out.append("  - IN_BAND = healthy chaordic edge for this axis")
    out.append("")
    out.append("  The default [0.55, 0.85] band is shared across axes today.")
    out.append("  Future expansion: per-axis learned bands tuned from ground-truth")
    out.append("  signature per subtag (Horizon IX × Horizon II compounding).")
    return "\n".join(out)


def _mode_conjugate():
    """Horizon V seed — composition⇔HME conjugate channel.

    The two coherences (HCI = HME's self-coherence, perceptual = the
    music's coherence) have always been tracked in parallel but never
    plotted together. This view joins them per round and classifies into
    quadrants:
      - high-both           = mature stability
      - high-HCI low-perc   = sterile rigor (well-organized but lifeless)
      - low-HCI high-perc   = lucky chaos (good music despite mess)
      - low-both            = lost
    Threshold defaults: HCI=0.85 (current band upper), perc=0.5 (median).
    """
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    mc_path = _os.path.join(_root, "output", "metrics", "hme-musical-correlation.json")
    if not _os.path.isfile(mc_path):
        return ("# i/status mode=conjugate\n"
                "No musical-correlation file at output/metrics/hme-musical-correlation.json")
    try:
        with open(mc_path) as _f:
            mc = _json.load(_f)
    except (OSError, ValueError) as e:
        return f"# i/status mode=conjugate\nFailed to read: {e}"

    history = list(mc.get("history", []))
    if mc.get("latest"):
        history.append(mc["latest"])
    if not history:
        return "# i/status mode=conjugate\nNo per-round history yet."

    # Pull rounds that have both signals
    rounds = []
    for r in history:
        hci = r.get("hme_coherence")
        perc = r.get("perceptual_complexity_avg")
        if isinstance(hci, (int, float)) and isinstance(perc, (int, float)):
            rounds.append({
                "round_id": r.get("round_id", "?"),
                "verdict": r.get("fingerprint_verdict", "?"),
                "hci": hci,
                "perc": perc,
            })
    if not rounds:
        return ("# i/status mode=conjugate\n"
                "No rounds carry both hme_coherence + perceptual_complexity_avg.")

    # Quadrant thresholds — data-driven medians since `hme_coherence`
    # in musical-correlation history is on a different scale (0-1) than
    # the verifier-snapshot HCI (0-100). Use the median of each axis
    # over the joined rounds so quadrants always partition meaningfully.
    sorted_hci = sorted(r["hci"] for r in rounds)
    sorted_perc = sorted(r["perc"] for r in rounds)
    HCI_T = sorted_hci[len(sorted_hci) // 2]
    PERC_T = sorted_perc[len(sorted_perc) // 2]
    quads = {"mature": [], "sterile": [], "lucky": [], "lost": []}
    for r in rounds:
        hh = r["hci"] >= HCI_T
        pp = r["perc"] >= PERC_T
        if hh and pp:
            quads["mature"].append(r)
        elif hh and not pp:
            quads["sterile"].append(r)
        elif not hh and pp:
            quads["lucky"].append(r)
        else:
            quads["lost"].append(r)

    def _avg(rs, key):
        if not rs:
            return None
        return sum(r[key] for r in rs) / len(rs)

    out = [f"# Conjugate channel — composition ⇔ HME ({len(rounds)} rounds joined)"]
    out.append(f"  thresholds: HCI ≥ {HCI_T:.2f} · perceptual ≥ {PERC_T:.2f}  (medians; partition is data-driven)")
    out.append("")
    out.append(f"  {'quadrant':18}  {'rounds':>6}  {'avg HCI':>8}  {'avg perc':>9}  meaning")
    rows = [
        ("mature stability",   quads["mature"],  "high-both: well-organized + alive"),
        ("sterile rigor",      quads["sterile"], "high-HCI low-perc: organized but lifeless"),
        ("lucky chaos",        quads["lucky"],   "low-HCI high-perc: alive despite mess"),
        ("lost",               quads["lost"],    "low-both: organize OR vivify next round"),
    ]
    for label, rs, meaning in rows:
        avg_hci = _avg(rs, "hci")
        avg_perc = _avg(rs, "perc")
        avg_hci_s = f"{avg_hci:.2f}" if avg_hci is not None else "─"
        avg_perc_s = f"{avg_perc:.2f}" if avg_perc is not None else "─"
        out.append(f"  {label:18}  {len(rs):>6}  {avg_hci_s:>8}  {avg_perc_s:>9}  {meaning}")

    # Latest round
    latest = rounds[-1]
    if latest["hci"] >= HCI_T and latest["perc"] >= PERC_T:
        cur_q = "mature stability"
    elif latest["hci"] >= HCI_T:
        cur_q = "sterile rigor"
    elif latest["perc"] >= PERC_T:
        cur_q = "lucky chaos"
    else:
        cur_q = "lost"
    out.append("")
    out.append(f"## Latest round ({latest['round_id'][:24]}):")
    out.append(f"  HCI={latest['hci']:.2f}  perc={latest['perc']:.2f}  verdict={latest['verdict']}")
    out.append(f"  quadrant: {cur_q}")
    return "\n".join(out)


def _mode_band_tuning():
    """Horizon IX seed — chaordic band as a learned controllable.

    Reads output/metrics/hme-ground-truth.jsonl (human verdicts with
    sentiment tags) and joins each verdict against the HCI timeseries
    at its timestamp. Computes the HCI distribution per sentiment
    bucket. Proposes new band bounds from the data: upper bound near
    the median HCI of legendary/compelling rounds, lower bound near
    the median of mechanical/flat rounds.

    Today's band is fixed [0.55, 0.85] (or [55, 85] in 0-100 scale).
    Self-tuning all the way down: the band itself becomes a function
    of recent ground-truth feedback."""
    import os as _os
    import json as _json
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))

    gt_path = _os.path.join(_root, "output", "metrics", "hme-ground-truth.jsonl")
    ts_path = _os.path.join(_root, "output", "metrics", "hme-coherence-timeseries.jsonl")

    if not _os.path.isfile(gt_path):
        try:
            from tool_invocations import i_form as _i_form
            _hint = _i_form('learn', value='ground_truth')
        except ImportError:
            _hint = "i/learn action=ground_truth"  # tool-form-ok: fallback
        return ("# i/status mode=band-tuning\n"
                "No ground-truth log at output/metrics/hme-ground-truth.jsonl yet.\n"
                f"Add verdicts via `{_hint}` first.")
    if not _os.path.isfile(ts_path):
        return ("# i/status mode=band-tuning\n"
                "No HCI timeseries — nothing to join verdicts against.")

    try:
        with open(gt_path) as _f:
            verdicts = [_json.loads(ln) for ln in _f if ln.strip()]
        with open(ts_path) as _f:
            ts_rows = [_json.loads(ln) for ln in _f if ln.strip()]
    except (OSError, ValueError) as e:
        return f"# i/status mode=band-tuning\nFailed to read inputs: {e}"

    # Build sorted HCI history for nearest-neighbor join
    ts_rows = [r for r in ts_rows if r.get("hci") is not None and r.get("ts")]
    ts_rows.sort(key=lambda r: r.get("ts", 0))

    def _hci_at(t: float) -> float | None:
        if not ts_rows:
            return None
        # Find row with ts closest to t (binary-ish search via linear)
        best = min(ts_rows, key=lambda r: abs(r["ts"] - t))
        if abs(best["ts"] - t) > 86400 * 7:  # 7-day max window
            return None
        return float(best["hci"])

    # Bucket verdicts by sentiment
    buckets: dict[str, list[float]] = {}
    for v in verdicts:
        sentiment = v.get("sentiment", "?")
        ts = v.get("ts")
        if not isinstance(ts, (int, float)):
            continue
        hci = _hci_at(float(ts))
        if hci is None:
            continue
        buckets.setdefault(sentiment, []).append(hci)

    if not buckets:
        return ("# i/status mode=band-tuning\n"
                "No ground-truth verdicts could be joined to HCI timeseries.")

    # Categorize sentiments
    POSITIVE = {"legendary", "compelling", "surprising", "moving"}
    NEGATIVE = {"flat", "mechanical", "boring", "broken"}

    pos_hcis: list[float] = []
    neg_hcis: list[float] = []
    for sent, vals in buckets.items():
        if sent in POSITIVE:
            pos_hcis.extend(vals)
        elif sent in NEGATIVE:
            neg_hcis.extend(vals)

    out = [f"# Chaordic band tuning (from {len(verdicts)} ground-truth verdicts)"]
    out.append("")
    out.append("## HCI distribution by sentiment:")
    for sent in sorted(buckets.keys(), key=lambda s: -len(buckets[s])):
        vals = sorted(buckets[sent])
        median = vals[len(vals) // 2]
        out.append(f"  {sent:14}  n={len(vals):3}  median={median:5.1f}  range=[{vals[0]:.0f}-{vals[-1]:.0f}]")

    # Proposal
    out.append("")
    out.append("## Band proposal:")
    if pos_hcis:
        pos_hcis.sort()
        upper = pos_hcis[len(pos_hcis) // 2]
        out.append(f"  upper bound  ≈ {upper:.0f}  (median HCI of {len(pos_hcis)} positive verdicts)")
    else:
        out.append(f"  upper bound  not enough positive verdicts")
    if neg_hcis:
        neg_hcis.sort()
        lower = neg_hcis[len(neg_hcis) // 2]
        out.append(f"  lower bound  ≈ {lower:.0f}  (median HCI of {len(neg_hcis)} negative verdicts)")
    else:
        try:
            from tool_invocations import i_form as _i_form
            _gt_hint = _i_form('learn', value='ground_truth')
        except ImportError:
            _gt_hint = "i/learn action=ground_truth"  # tool-form-ok: fallback
        out.append(f"  lower bound  not enough negative verdicts; current default 55 retained")
        out.append(f"               (to inform: tag a flat/mechanical/boring round via")
        out.append(f"                `{_gt_hint} tags=[flat]` when one occurs —")
        out.append(f"                even one negative verdict starts the calibration)")
    # Persist the proposal to tmp/hme-band-proposal.json so downstream
    # code (coherence-budget consumer, future self-tuner) can read it
    # without re-deriving. Establishes the data hand-off without forcing
    # composition behavior change yet.
    proposal_path = _os.path.join(_root, "tmp", "hme-band-proposal.json")
    proposal = {
        "ts": __import__("time").time(),
        "current_band": [0.55, 0.85],
        "proposed_band": [
            (neg_hcis[len(neg_hcis) // 2] / 100.0) if neg_hcis else 0.55,
            (pos_hcis[len(pos_hcis) // 2] / 100.0) if pos_hcis else 0.85,
        ],
        "n_positive_verdicts": len(pos_hcis),
        "n_negative_verdicts": len(neg_hcis),
        "sentiments": {sent: len(vals) for sent, vals in buckets.items()},
        "note": "Advisory proposal. Consumers may read but composition behavior remains driven by current_band until explicitly wired.",
    }
    try:
        proposal_tmp = proposal_path + ".tmp"
        with open(proposal_tmp, "w") as _pf:
            _json.dump(proposal, _pf, indent=2)
        _os.replace(proposal_tmp, proposal_path)
        out.append("")
        out.append(f"# Persisted proposal:")
        out.append(f"  tmp/hme-band-proposal.json   (downstream consumers may read)")
    except OSError:
        pass

    out.append("")
    out.append("# Note:")
    out.append("  Today's band [55, 85] is fixed. The proposal above is advisory.")
    out.append("  Future expansion: composition code reads the proposal on round")
    out.append("  start, allowing the band to self-tune as new ground-truth lands.")
    return "\n".join(out)


def _mode_agent_loop():
    """Horizon IV — agent behavior as a tracked dimension.

    The agent (the LLM running the session) has been invisible to HME
    except as a stream of tool calls. This mode aggregates per-session
    metrics from the activity log:
      - tools-per-turn (loop tightness)
      - brief-ratio (auto_brief_injected vs Edit count)
      - error-surface rate (bash_error_surfaced / tool_call)
      - average inter-tool gap (loop pace)
      - turns observed in the last hour"""
    import os as _os
    import json as _json
    import time as _time
    from collections import Counter, defaultdict
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    activity = _os.path.join(_root, "output", "metrics", "hme-activity.jsonl")
    if not _os.path.isfile(activity):
        return "# i/status mode=agent-loop\nNo activity log found."
    try:
        with open(activity) as _f:
            tail = _f.readlines()[-3000:]
    except OSError as e:
        return f"# i/status mode=agent-loop\nFailed to read activity: {e}"

    cutoff = _time.time() - 3600  # last hour
    events = []
    for ln in tail:
        try:
            e = _json.loads(ln)
        except ValueError:
            continue
        if e.get("ts", 0) >= cutoff:
            events.append(e)
    if not events:
        return "# i/status mode=agent-loop\nNo activity in last hour."

    # Per-session windows
    per_session: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        sid = e.get("session", "?")
        per_session[sid].append(e)

    # Aggregate
    by_event: Counter = Counter()
    for e in events:
        by_event[e.get("event", "?")] += 1

    tool_calls = by_event.get("tool_call", 0)
    inference_calls = by_event.get("inference_call", 0)
    turns = by_event.get("turn_complete", 0)
    edits = sum(1 for e in events if e.get("event") == "tool_call"
                and e.get("tool") == "Edit")
    brief_inj = by_event.get("auto_brief_injected", 0)
    brief_rec = by_event.get("brief_recorded", 0)
    bash_errs = by_event.get("bash_error_surfaced", 0)

    out = [f"# Agent loop (last hour, {len(events)} events, {len(per_session)} session(s))"]
    out.append("")
    out.append(f"  turns observed:        {turns}")
    if turns > 0:
        out.append(f"  inferences per turn:   {inference_calls/turns:.1f}  (Anthropic API calls per turn)")
    if tool_calls > 0:
        if turns > 0:
            out.append(f"  tools per turn:        {tool_calls/turns:.1f}  (avg)")
        out.append(f"  total tool calls:      {tool_calls}")
        out.append(f"    of which Edit:       {edits}")
        if edits > 0:
            out.append(f"    brief coverage:      {(brief_rec / edits) * 100:.0f}%  ({brief_rec}/{edits})")
        err_rate = bash_errs / tool_calls * 100
        out.append(f"  bash error rate:       {err_rate:.1f}%  ({bash_errs}/{tool_calls})")
    else:
        # Known instrumentation gap: tool_call events emitted by the proxy
        # middleware activity_log.js are intermittent — fs_watcher catches
        # file_written but tool_call hits aren't reliably appearing in the
        # log. Surface the gap rather than silently report zero, and use
        # file_written + brief_recorded as proxy signals for agent activity.
        fwrites = sum(1 for e in events if e.get("event") == "file_written")
        out.append(f"  total tool calls:      ─  (proxy tool_call instrumentation degraded; see note)")
        out.append(f"  file writes (proxy):   {fwrites}  (via fs_watcher)")
        out.append(f"  briefs recorded:       {brief_rec}  (KB consultations)")
    out.append(f"  auto-brief injected:   {brief_inj}")

    # Inter-tool gap (median pause between consecutive tool_call events)
    tool_ts = sorted(e.get("ts", 0) for e in events
                     if e.get("event") == "tool_call")
    if len(tool_ts) >= 2:
        gaps = [tool_ts[i + 1] - tool_ts[i] for i in range(len(tool_ts) - 1)]
        gaps.sort()
        median = gaps[len(gaps) // 2]
        p90 = gaps[int(len(gaps) * 0.9)] if len(gaps) >= 10 else gaps[-1]
        out.append(f"  inter-tool gap:        median {median:.1f}s · p90 {p90:.1f}s")

    # Stop-hook activity hints
    stop_hits = sum(1 for e in events if e.get("event") in (
        "bash_error_surfaced", "auto_brief_injected"
    ))
    out.append("")
    out.append("# Loop quality signals:")
    out.append(f"  hook interventions:    {brief_inj + brief_rec} brief-related, {bash_errs} error-surfaced")

    out.append("")
    out.append("# Drill-in:")
    out.append("  i/timeline window=1h           full chronological view")
    out.append("  i/why mode=hook                broader hook-firing detail")
    return "\n".join(out)


def _mode_hci_by_subtag():
    """Aggregate verifier status by subtag — answers 'what KIND of broken
    is everything that's red?' Joins the live snapshot (status+score per
    verifier) with REGISTRY introspection (which has the subtag attribute
    declared on each verifier class)."""
    import os as _os
    import json as _json
    import sys as _sys
    from .. import ctx as _ctx_mod
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    snap_path = _os.path.join(_root, "output", "metrics", "hci-verifier-snapshot.json")
    if not _os.path.isfile(snap_path):
        return ("# i/status mode=hci-by-subtag\n"
                "No snapshot found — run `python3 tools/HME/scripts/verify-coherence.py` first.")
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
    # Render: subtag → counts + names of non-PASS
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
            summary += f"  → {', '.join(non_pass_names[:3])}"
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
    _root = getattr(_ctx_mod, "PROJECT_ROOT", _os.environ.get("PROJECT_ROOT", "."))
    cur_path = _os.path.join(_root, "output", "metrics", "hci-verifier-snapshot.json")
    prev_path = cur_path + ".prev"
    if not _os.path.isfile(cur_path):
        return ("# i/status mode=hci-diff\n"
                "No snapshot found — run `python3 tools/HME/scripts/verify-coherence.py` first.")
    if not _os.path.isfile(prev_path):
        return ("# i/status mode=hci-diff\n"
                "No prior snapshot to diff — run the engine twice (once to seed .prev).")
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
            status_changes.append(f"  {name:36}  {ps} → {cs}")
        elif abs(cscore - pscore) >= 0.05:
            arrow = "↑" if cscore > pscore else "↓"
            score_moves.append(f"  {name:36}  {pscore:.2f} {arrow} {cscore:.2f}")

    out = ["# HCI verifier diff (current vs .prev snapshot)"]
    out.append(f"  HCI: {prev.get('hci', '?')} → {cur.get('hci', '?')}")
    out.append("")
    if status_changes:
        out.append("status changes:")
        out.extend(status_changes)
        out.append("")
    if score_moves:
        out.append("score moves (≥0.05):")
        out.extend(score_moves)
        out.append("")
    if added:
        out.append(f"added verifiers ({len(added)}): {', '.join(added)}")
    if removed:
        out.append(f"removed verifiers ({len(removed)}): {', '.join(removed)}")
    if not (status_changes or score_moves or added or removed):
        out.append("(no verifier status changes; no score moves ≥0.05)")
    return "\n".join(out)


def _mode_race_stats():
    """Summarize recent local-vs-cloud race outcomes from
    hme-race-outcomes.jsonl. Helps tune _RACE_CLOUD_DELAY_SEC — if local
    wins ≥80% of races, the delay can probably be raised (less wasted
    cloud work); if cloud wins often, either delay is too long or local
    is the bottleneck for these query shapes."""
    import os as _os
    import json as _json
    from server import context as _ctx
    out_dir = _os.environ.get("METRICS_DIR") or _os.path.join(
        getattr(_ctx, "PROJECT_ROOT", "."), "output", "metrics")
    path = _os.path.join(out_dir, "hme-race-outcomes.jsonl")
    if not _os.path.isfile(path):
        return "## Race Stats\n  (no races run yet — hme-race-outcomes.jsonl absent)"
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
                 f"If local wins ≥80% raise it; if cloud wins most races the delay "
                 f"may be cutting local work off early — investigate.")
    return "\n".join(lines)


def _mode_learn_suggestions():
    """Surface `productive_incoherence` events — modules the agent edited
    with MISSING KB coverage. The event was already being emitted by
    posttooluse_edit.sh but no consumer read it; this mode closes that loop.

    Shows, per module: file path, module name, session, timestamp (latest
    first). Up to 20 entries from the last round. Agent can drive a
    `learn()` pass to capture the novel findings those edits represent.
    """
    import os as _os
    import json as _json
    from server import context as _ctx
    activity_path = _os.path.join(
        _os.environ.get("METRICS_DIR") or _os.path.join(_ctx.PROJECT_ROOT, "output", "metrics"),
        "hme-activity.jsonl",
    )
    if not _os.path.isfile(activity_path):
        return "## Learn Suggestions\n  (no activity log yet)"
    # Scan last 256KB for recency + productive_incoherence events
    try:
        size = _os.path.getsize(activity_path)
        read_from = max(0, size - 256 * 1024)
        with open(activity_path, "rb") as f:
            if read_from:
                f.seek(read_from)
                f.readline()
            text = f.read().decode("utf-8", errors="replace")
    except OSError as _err:
        return f"## Learn Suggestions\n  (activity log unreadable: {_err})"
    events: list[dict] = []
    last_round_idx = -1
    all_lines = text.splitlines()
    for i, line in enumerate(all_lines):
        if not line.strip():
            continue
        try:
            ev = _json.loads(line)
        except _json.JSONDecodeError:
            continue
        if ev.get("event") == "round_complete":
            last_round_idx = i
        if ev.get("event") == "productive_incoherence":
            events.append(ev)
    if not events:
        return "## Learn Suggestions\n  No productive_incoherence events this round — every edit landed in KB-covered territory, or no edits this round."
    # Dedup by (file, module); keep most recent timestamp per key.
    # Activity events are emitted by tools/HME/activity/emit.py which always
    # sets `ts` — direct index is safe. Historic entries without ts are
    # filtered earlier by `ev.get("event")` which returns a non-event mark
    # for malformed lines.
    def _ts(ev: dict) -> float:
        t = ev.get("ts")
        return t if isinstance(t, (int, float)) else 0.0
    latest: dict[tuple, dict] = {}
    for ev in events:
        key = (ev.get("file", ""), ev.get("module", ""))
        if key in latest and _ts(latest[key]) >= _ts(ev):
            continue
        latest[key] = ev
    rows = sorted(latest.values(), key=_ts, reverse=True)[:20]
    lines = [
        "## Learn Suggestions",
        f"  {len(rows)} module(s) edited with MISSING KB coverage this round. "
        f"Each is a candidate for `learn()` to capture what those edits encode.",
        "",
    ]
    for ev in rows:
        mod = ev.get("module", "?")
        f = ev.get("file", "?")
        lines.append(f"  - {mod}  ({f})")
    lines.append("")
    lines.append("  Capture with: `learn(title='<concise>', content='<2-3 sentences>', category='architecture|pattern|decision')`")
    return "\n".join(lines)

def _mode_blindspots():
    from ..blindspots import blindspots as _bs
    return _bs()

def _mode_hypotheses():
    from ..hypothesis_registry import hypotheses_report as _hr
    return _hr()

def _mode_drift():
    from ..semantic_drift_report import semantic_drift_report as _sd
    return _sd()

def _mode_accuracy():
    from ..prediction_accuracy import prediction_accuracy_report as _pa
    return _pa()

def _mode_crystallized():
    from ..crystallizer import crystallized_report as _cr
    return _cr()

def _mode_music_truth():
    from ..epistemic_reports import music_truth_report as _mt
    return _mt()

def _mode_kb_trust():
    from ..epistemic_reports import kb_trust_report as _kt
    return _kt()

def _mode_intention_gap():
    from ..epistemic_reports import intention_gap_report as _ig
    return _ig()

def _mode_self_audit():
    from ..self_audit import self_audit_report as _sa
    return _sa()

def _mode_probes():
    from ..probe import probes_report as _pr
    return _pr()

def _mode_negative_space():
    from ..negative_space import negative_space_report as _ns
    return _ns()

def _mode_cognitive_load():
    from ..cognitive_load import cognitive_load_report as _cl
    return _cl()

def _mode_ground_truth():
    from ..ground_truth import ground_truth_report as _gt
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
    from ..multi_agent import multi_agent_report as _ma
    return _ma()

def _list_modes():
    """Grouped catalogue of mode= options. The bare 'Unknown mode' error
    used to be the only way to discover what was available — that error
    list isn't grouped, isn't described, and gave no hint of aliases."""
    groups = [
        ("Pipeline / data freshness", [
            ("pipeline", "last pipeline run summary"),
            ("freshness", "age of every metric source + sync warnings"),
            ("vram", "GPU usage + 30-min trend sparklines"),
            ("activity", "event counts + read/write coherence"),
            ("budget", "coherence band state + prescription"),
            ("resume", "session briefing: git + pipeline + narrative"),
        ]),
        ("Self-coherence (HME-on-HME)", [
            ("self_audit", "CASCADE_UNRELIABLE / ANCHOR_DEGENERATE flags"),
            ("reflexivity", "clean vs injected prediction-accuracy buckets"),
            ("accuracy", "EMA + per-round confirmed/refuted lists"),
            ("cognitive_load", "session workload vs historical p25/p50/p90"),
            ("introspect", "tool usage breakdown for this session"),
            ("hme", "full HME selftest output"),
            ("health", "codebase line-count / convention / boundary scan"),
            ("doc_drift", "per-doc orphan-reference counts"),
            ("staleness", "FRESH/STALE/MISSING per module"),
        ]),
        ("Evolution / planning", [
            ("priorities", "ranked evolution priorities (alias of `next`)"),
            ("next", "ranked evolution priorities (alias of `priorities`)"),
            ("blindspots", "untouched subsystems + write-without-read modules"),
            ("probes", "adversarial probe candidates"),
            ("hypotheses", "OPEN/CONFIRMED hypothesis registry"),
            ("crystallized", "multi-round patterns + synthesis text"),
            ("generalizations", "patterns that may generalize beyond Polychron"),
            ("constitution", "positive affirmations of what Polychron IS"),
        ]),
        ("Trust / coupling / drift", [
            ("trust", "trust leaderboard with musical roles"),
            ("coupling", "melodic/rhythmic/phase coupling network"),
            ("drift", "Arc III outliers with z-scores"),
            ("trajectory", "verdict + per-signal slope/range"),
            ("kb_trust", "tier distribution + top/bottom entries"),
            ("intention_gap", "todos vs tracked execution"),
            ("negative_space", "feedback-loop near-miss candidates"),
            ("multi_agent", "role distribution"),
        ]),
        ("Music / perception", [
            ("perceptual", "cached EnCodec+CLAP per-section report"),
            ("music_truth", "ground-truth correlations"),
            ("ground_truth", "human listening verdicts"),
            ("coherence", "per-round coherence score breakdown"),
        ]),
    ]
    parts = ["# i/status modes (35+ available)\n"]
    for group_name, items in groups:
        parts.append(f"## {group_name}")
        for name, desc in items:
            parts.append(f"  {name:<18s} {desc}")
        parts.append("")
    parts.append("Pass any name as `i/status mode=<name>` (or `mode=all` for the unified overview).")
    return "\n".join(parts)


def _mode_perceptual():
    # Status is a "quick look" surface — reading the cached report from the
    # last pipeline run is what users actually want, not triggering a fresh
    # (multi-minute) EnCodec+CLAP inference pass. For a live re-run, call
    # `audio_analyze(analysis='both')` directly via i/hme.
    cache_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "perceptual-report.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as _f:
                data = json.load(_f)
            ts = data.get("timestamp", "?")
            confidence = data.get("confidence", 0)
            sections = (data.get("encodec", {}) or {}).get("sections", {}) or {}
            parts = [
                f"# Perceptual Analysis — cached (confidence: {confidence:.0%})",
                f"Source: metrics/perceptual-report.json  (ts={ts})",
                "For a fresh analysis: `i/hme audio_analyze analysis=both`  (takes ~2-5 min)",
                "",
                "## Per-section tension (from EnCodec cb0 entropy)",
            ]
            for sid in sorted(sections.keys(), key=lambda s: int(s) if s.isdigit() else 0):
                s = sections[sid]
                tens = s.get("tension", 0)
                clap = s.get("clap", {}) or {}
                top = sorted(clap.items(), key=lambda kv: -kv[1])[:3]
                top_str = ", ".join(f"{k}={v:+.2f}" for k, v in top)
                parts.append(f"  S{sid}  tension={tens:.3f}  top_clap: {top_str}")
            return "\n".join(parts)
        except (OSError, json.JSONDecodeError, TypeError, KeyError) as _e:
            return f"Perceptual cache read failed: {type(_e).__name__}: {_e}"
    return ("No perceptual-report.json cached. Run `npm run main` (or "
            "`i/hme audio_analyze`) to generate.")

def _mode_introspect():
    from ..evolution.evolution_admin import hme_introspect as _hi
    return _hi()


def _mode_signals() -> str:
    """Tail the unified signal bus — the one-file truth of hook + middleware
    + lifecycle events for the current and recent sessions."""
    import json as _json
    path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "hme-signals.jsonl")
    if not os.path.isfile(path):
        return (
            "# HME Signal Bus\n\n"
            "output/metrics/hme-signals.jsonl not yet produced. Hooks emit to it "
            "via _signal_emit (sourced by helpers/_signals.sh). Trigger a few "
            "tool calls and re-check."
        )
    try:
        with open(path, encoding="utf-8") as _f:
            raw = _f.readlines()[-40:]
    except OSError as _e:
        return f"# HME Signal Bus\n\nCould not read: {type(_e).__name__}: {_e}"
    parsed = []
    for ln in raw:
        try:
            parsed.append(_json.loads(ln))
        except (ValueError, TypeError):
            continue
    if not parsed:
        return "# HME Signal Bus\n\nNo parseable entries yet."
    from collections import Counter as _Counter
    counts = _Counter(e.get("event", "?") for e in parsed)
    lines = [
        "# HME Signal Bus",
        "",
        f"Tailing last {len(parsed)} entries from output/metrics/hme-signals.jsonl.",
        "",
        "## Event frequency (this tail)",
    ]
    for ev, n in counts.most_common():
        lines.append(f"  {ev:<30} {n}")
    lines.append("")
    lines.append("## Most recent 10")
    for e in parsed[-10:]:
        lines.append(f"  [{e.get('source', '?'):<20}] {e.get('event', '?'):<22} scope={e.get('scope', '?')}")
    return "\n".join(lines)


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
    "hci-diff": _mode_hci_diff,
    "hci_diff": _mode_hci_diff,
    "hci-by-subtag": _mode_hci_by_subtag,
    "hci_by_subtag": _mode_hci_by_subtag,
    "agent-loop": _mode_agent_loop,
    "agent_loop": _mode_agent_loop,
    "band-tuning": _mode_band_tuning,
    "band_tuning": _mode_band_tuning,
    "conjugate": _mode_conjugate,
    "multi-axis-band": _mode_multi_axis_band,
    "multi_axis_band": _mode_multi_axis_band,
    "tool-latency": _mode_tool_latency,
    "tool_latency": _mode_tool_latency,
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
    # `priorities` and `next` are intentional aliases — the underlying signal
    # is the same (output/metrics/evolution-priorities.json). Both names exist
    # because users reach for either word; aliasing avoids a "wait, which one?"
    # context-switch and is documented in the mode=list output.
    "priorities": lambda: _evolution_priority_report(),
    "next": lambda: _evolution_priority_report(),
    "reflexivity": _mode_reflexivity,
    "multi_agent": _mode_multi_agent,
    "freshness": lambda: _freshness_report(),
    "vram": lambda: _vram_report(),
    "introspect": _mode_introspect,
    "signals": _mode_signals,
    # Exploratory-edit signal: modules you edited this round that lack KB
    # coverage — `learn()` candidates that the old loop never surfaced.
    "learn_suggestions": _mode_learn_suggestions,
    "novel_modules": _mode_learn_suggestions,   # alias
    # Local-vs-cloud race outcomes from _reasoning_think's race-mode path.
    "race_stats": _mode_race_stats,
}
