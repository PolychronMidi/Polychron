"""HME pipeline digest — one-call post-pipeline summary."""
import json
import os
import logging
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")


from . import _load_trace as _load_trace_impl  # shared helper

# Files written by every pipeline run — used to detect freshness.
# pipeline.log is written LAST (the "Pipeline finished" line), so it detects completion
# even when digest was called mid-run and already consumed the early metrics files.
_PIPELINE_OUTPUT_FILES = [
    "metrics/trace.jsonl",
    "metrics/trace-summary.json",
    "metrics/fingerprint-comparison.json",
    "log/pipeline.log",
]
# Sentinel file records when pipeline_digest last ran successfully
_DIGEST_SENTINEL = ".claude/mcp/HME/.last_pipeline_digest"


def _pipeline_outputs_fresh() -> bool:
    """Return True if pipeline has run since the last pipeline_digest call."""
    sentinel = os.path.join(ctx.PROJECT_ROOT, _DIGEST_SENTINEL)
    if not os.path.exists(sentinel):
        return True  # first call ever — allow through
    sentinel_mtime = os.path.getmtime(sentinel)
    for rel in _PIPELINE_OUTPUT_FILES:
        p = os.path.join(ctx.PROJECT_ROOT, rel)
        if os.path.exists(p) and os.path.getmtime(p) > sentinel_mtime:
            return True
    return False


def _touch_digest_sentinel():
    sentinel = os.path.join(ctx.PROJECT_ROOT, _DIGEST_SENTINEL)
    os.makedirs(os.path.dirname(sentinel), exist_ok=True)
    import time
    with open(sentinel, "w") as f:
        f.write(str(time.time()))


_check_pipeline_blocked: bool = False  # True after first IN PROGRESS; cleared on finish/fail

def check_pipeline() -> str:
    """Check current pipeline status by reading pipeline.log directly.
    Reports: IN PROGRESS (pipeline currently running), the finished line
    (pipeline completed), or FAILED with last 30 lines for diagnosis.
    This is the ONLY permitted way to check pipeline state — never tail/cat the log.
    ONE CALL PER RUN: once IN PROGRESS is returned, all subsequent calls are blocked
    until the pipeline actually completes. The task notification fires on completion —
    that is your signal. Do not poll."""
    global _check_pipeline_blocked
    import time as _time
    import re as _re

    log_path = os.path.join(ctx.PROJECT_ROOT, "log", "pipeline.log")
    if not os.path.isfile(log_path):
        return "No pipeline.log found — pipeline has not been run yet."
    try:
        with open(log_path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except Exception as e:
        return f"Could not read pipeline.log: {e}"

    if not lines:
        return "pipeline.log is empty."

    stripped = [l.rstrip() for l in lines if l.strip()]
    last30 = "\n".join(stripped[-30:])
    last10 = stripped[-10:] if len(stripped) >= 10 else stripped

    # Finished: check FIRST so a completed pipeline always unblocks immediately.
    finished = next((l for l in reversed(last10) if "Pipeline finished" in l), None)
    if finished:
        _check_pipeline_blocked = False
        return f"Pipeline: {finished.strip()}"

    # In-progress: ANY of the last 5 non-empty lines starts with "script in progress"
    last5 = stripped[-5:] if len(stripped) >= 5 else stripped
    in_progress_line = next((l for l in reversed(last5) if l.startswith("script in progress")), None)
    if in_progress_line:
        if _check_pipeline_blocked:
            return (
                "BLOCKED: check_pipeline already returned IN PROGRESS for this run. "
                "Calling it again proves you are polling — burning context window on a status "
                "you already have, instead of doing actual work. Every redundant call is dead "
                "context that can never be recovered. The task notification fires when the "
                "pipeline finishes. Until then: implement the next evolution, run "
                "what_did_i_forget, explore with coupling_intel or module_intel. "
                "Polling is not waiting — it is active waste."
            )
        step_match = _re.search(r"script in progress[:\s]+(.+)", in_progress_line)
        step_name = step_match.group(1).strip() if step_match else "unknown step"
        try:
            log_age_s = _time.time() - os.path.getmtime(log_path)
            result = f"Pipeline: IN PROGRESS — `{step_name}` (log updated {log_age_s:.0f}s ago)"
        except Exception:
            result = f"Pipeline: IN PROGRESS — `{step_name}`"
        _check_pipeline_blocked = True
        return result

    # Race-condition guard: between steps
    try:
        log_mtime = os.path.getmtime(log_path)
        log_age_s = _time.time() - log_mtime
        last3 = stripped[-3:] if len(stripped) >= 3 else stripped
        last3_text = " ".join(last3)
        if log_age_s < 90 and "error" not in last3_text.lower():
            if _check_pipeline_blocked:
                return (
                    "STOP POLLING. Pipeline is still running — you already know this. "
                    "check_pipeline is blocked for the rest of this run. "
                    "The task notification fires on completion. Do other work."
                )
            last_step = "between steps"
            for l in reversed(stripped[-20:]):
                step_m = _re.search(r"script in progress[:\s]+(.+)", l)
                if step_m:
                    last_step = f"after `{step_m.group(1).strip()}`"
                    break
            _check_pipeline_blocked = True
            return f"Pipeline: IN PROGRESS ({last_step} — log modified {log_age_s:.0f}s ago)"
    except Exception:
        pass

    # Failed
    _check_pipeline_blocked = False
    return f"Pipeline: FAILED\n\nLast 30 lines:\n{last30}"


def _load_trace() -> list[dict]:
    """Wrapper: loads from the canonical trace.jsonl path for this project."""
    return _load_trace_impl(os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl"))


def pipeline_digest(critique: bool = False, evolve: bool = True) -> str:
    """The single post-pipeline ritual. Consolidates: composition arc, regime health,
    regime anomaly detection, top hotspot systems, dramatic moments, run delta
    (what changed vs last run), and ranked evolution proposals. evolve=True (default)
    appends suggest_evolution output so no separate call is needed. critique=True
    appends a musical prose critique via Claude synthesis. Replaces pipeline_digest +
    regime_anomaly + evolution_delta + composition_critique + suggest_evolution.
    critique=True uses local Ollama reasoning model (GPU1, temperature=0.55) for prose.
    FRESHNESS GUARD: only runs if pipeline output files are newer than last digest call.
    If stale, auto-runs check_pipeline and returns its status instead."""
    ctx.ensure_ready_sync()
    _track("pipeline_digest")

    # In-progress guard: reject if pipeline is still running.
    # Partial output files written mid-pipeline pass the freshness check below,
    # so this must come FIRST to prevent digesting incomplete data.
    status = check_pipeline()
    if "IN PROGRESS" in status:
        return (
            "pipeline_digest: pipeline is still running — cannot digest partial results.\n"
            f"{status}\n\n"
            "Do substantive work while waiting (implement next evolution, run what_did_i_forget, "
            "update KB/docs, explore with module_intel). The background task fires a notification "
            "when done — then call pipeline_digest."
        )

    # Freshness guard: only run if pipeline has produced new output since last digest.
    if not _pipeline_outputs_fresh():
        stale_summary = ""
        try:
            summary_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-summary.json")
            if os.path.isfile(summary_path):
                with open(summary_path) as _sf:
                    summary = json.load(_sf)
                beats_data = summary.get("beats", {})
                total_beats = beats_data.get("totalEntries", "?") if isinstance(beats_data, dict) else "?"
                regimes = summary.get("regimes", {})
                total_regime = sum(regimes.values()) if regimes else 1
                regime_str = ", ".join(f"{k}:{v/total_regime:.0%}" for k, v in sorted(regimes.items(), key=lambda x: -x[1]))
                top_trust = summary.get("trustDominance", {}).get("dominantSystems", [])
                trust_str = ", ".join(f"{s['system']}({s.get('score',0):.2f})" for s in top_trust[:3]) if top_trust else "?"
                fp_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "fingerprint-comparison.json")
                fp_verdict = "?"
                if os.path.isfile(fp_path):
                    with open(fp_path) as _fp:
                        fp = json.load(_fp)
                    verdict = fp.get("verdict", "?")
                    drifted = fp.get("driftedDimensions", 0)
                    total_fp = fp.get("totalDimensions", 0)
                    fp_verdict = f"{verdict} ({drifted}/{total_fp} drifted)"
                stale_summary = (
                    f"\n## Last Run (cached)\n"
                    f"  Beats: {total_beats} | Regimes: {regime_str}\n"
                    f"  Top trust: {trust_str}\n"
                    f"  Fingerprints: {fp_verdict}\n"
                )
        except Exception:
            pass
        return (
            "pipeline_digest: no new pipeline output since last digest.\n"
            f"{status}"
            f"{stale_summary}"
            "\nRun `npm run main` for a fresh pipeline, then call pipeline_digest again."
        )

    try:
        records = _load_trace()
    except Exception as e:
        return f"No trace data: {e}"

    if not records:
        return "Empty trace.jsonl."

    # --- Composition Arc (compact) ---
    sections: dict = defaultdict(lambda: {
        "beats": 0, "regimes": defaultdict(int), "tensions": [],
        "profiles": defaultdict(int), "trust_weights": defaultdict(list),
    })
    regime_total: dict = defaultdict(int)
    hotspot_counts: dict = defaultdict(int)
    hotspot_pressure: dict = defaultdict(list)
    prev_regime = None
    prev_weights: dict = {}
    drama_events: list = []

    for rec in records:
        bk = rec.get("beatKey", "")
        parts = bk.split(":")
        sec = int(parts[0]) if parts and parts[0].isdigit() else -1
        regime = rec.get("regime", "?")
        regime_total[regime] += 1
        s = sections[sec]
        s["beats"] += 1
        s["regimes"][regime] += 1
        snap = rec.get("snap", {})
        if isinstance(snap, dict):
            t = snap.get("tension")
            if isinstance(t, (int, float)):
                s["tensions"].append(t)
            prof = snap.get("activeProfile", "")
            if prof:
                s["profiles"][prof] += 1
        trust = rec.get("trust", {})
        for sys_name, data in trust.items():
            if not isinstance(data, dict):
                continue
            w = data.get("weight")
            if isinstance(w, (int, float)):
                s["trust_weights"][sys_name].append(w)
            hp = data.get("hotspotPressure", 0)
            if hp > 0.1:
                hotspot_counts[sys_name] += 1
                hotspot_pressure[sys_name].append(hp)
            # Weight swings
            prev_w = prev_weights.get(sys_name, w)
            swing = abs(w - prev_w)
            if swing > 0.3:
                tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
                drama_events.append((swing * 20 + tension * 2, bk, sys_name, prev_w, w))
            prev_weights[sys_name] = w
        # Regime transitions
        if regime != prev_regime and prev_regime is not None:
            active_hp = sum(1 for sv in trust.values()
                           if isinstance(sv, dict) and sv.get("hotspotPressure", 0) > 0.2)
            tension = snap.get("tension", 0.5) if isinstance(snap, dict) else 0.5
            drama_events.append((10 + active_hp * 0.5 + tension * 3, bk, f"{prev_regime}→{regime}", 0, 0))
        prev_regime = regime

    total_beats = sum(regime_total.values())
    out = [f"# Pipeline Digest ({total_beats} beats)\n"]

    # Regime health
    regime_str = " | ".join(f"{r}:{c} ({c*100//total_beats}%)" for r, c in
                            sorted(regime_total.items(), key=lambda x: -x[1]))
    out.append(f"**Regimes:** {regime_str}")
    if regime_total.get("coherent", 0) == 0:
        out.append("⚠ **ZERO coherent beats** — possible regime classification failure")
    out.append("")

    # Section arc
    out.append("## Sections")
    for sec_num in sorted(sections.keys()):
        s = sections[sec_num]
        dom_regime = max(s["regimes"].items(), key=lambda x: x[1])[0] if s["regimes"] else "?"
        dom_profile = max(s["profiles"].items(), key=lambda x: x[1])[0] if s["profiles"] else "?"
        tensions = s["tensions"]
        avg_t = sum(tensions) / len(tensions) if tensions else 0
        bar = "█" * int(avg_t * 15) + "░" * (15 - int(avg_t * 15))
        top_trust = sorted(((n, sum(ws) / len(ws)) for n, ws in s["trust_weights"].items()),
                           key=lambda x: -x[1])[:2]
        trust_str = ", ".join(f"{n}({w:.2f})" for n, w in top_trust)
        out.append(f"  S{sec_num} ({s['beats']}b {dom_profile}) {dom_regime:10} t={avg_t:.2f} [{bar}] {trust_str}")
    out.append("")

    # Top 5 hotspot systems
    ranked_hp = sorted(hotspot_counts.items(), key=lambda x: -x[1])[:5]
    if ranked_hp:
        out.append("## Top Hotspots")
        for name, count in ranked_hp:
            total_sys = total_beats
            pct = count / total_sys * 100
            pressures = hotspot_pressure.get(name, [0])
            peak = max(pressures)
            out.append(f"  {name:<25} {pct:5.1f}% (peak {peak:.3f})")
        out.append("")

    # Top 5 dramatic moments (mixed types)
    drama_events.sort(key=lambda x: -x[0])
    if drama_events:
        out.append("## Top Drama")
        seen = set()
        shown = 0
        for score, bk, detail, pw, w in drama_events:
            if bk in seen or shown >= 5:
                continue
            seen.add(bk)
            if pw and w:
                out.append(f"  {bk}: {detail} {pw:.3f}→{w:.3f} (drama={score:.1f})")
            else:
                out.append(f"  {bk}: {detail} (drama={score:.1f})")
            shown += 1
        out.append("")

    # --- Regime Anomaly (inline) ---
    alerts: list = []
    for expected in ["coherent", "evolving", "exploring"]:
        if regime_total.get(expected, 0) == 0:
            alerts.append(f"🔴 DEATH SPIRAL: 0% {expected} — check regimeClassifier warm-start")
    for regime, count in regime_total.items():
        if regime != "initializing" and count / total_beats > 0.75:
            alerts.append(f"🟡 MONOPOLY: {regime} at {count*100//total_beats}% ({count}/{total_beats})")
    trust_inflation: list = []
    for rec in records:
        for sys, data in rec.get("trust", {}).items():
            if not isinstance(data, dict):
                continue
            w = data.get("weight", 1)
            s = data.get("score", 0.5)
            if isinstance(w, (int, float)) and isinstance(s, (int, float)):
                predicted_w = 1.0 + s * 0.75
                if w > predicted_w + 0.15 and s < 0.30:
                    trust_inflation.append(sys)
    from collections import Counter as _Counter
    inflated = _Counter(trust_inflation)
    for sys, cnt in inflated.most_common(2):
        pct = cnt * 100 // total_beats
        if pct > 20:
            alerts.append(f"🟡 TRUST INFLATION: {sys} high weight / low score on {pct}% of beats")
    if alerts:
        out.append("## Regime Alerts")
        out.extend(f"  {a}" for a in alerts)
        out.append("")
    else:
        out.append("## Regime Health: ✓ ALL CLEAR\n")

    # --- Run Delta (last 2 snapshots) ---
    history_dir = os.path.join(ctx.PROJECT_ROOT, "metrics", "run-history")
    if os.path.isdir(history_dir):
        snaps = sorted([f for f in os.listdir(history_dir) if f.endswith(".json")], reverse=True)
        if len(snaps) >= 2:
            try:
                def _load_snap(fname):
                    with open(os.path.join(history_dir, fname)) as f:
                        return json.load(f)
                cur = _load_snap(snaps[0])
                prev = _load_snap(snaps[1])
                cf = cur.get("features", {})
                pf = prev.get("features", {})
                cp = cur.get("perceptual", {}).get("encodec", {})
                pp = prev.get("perceptual", {}).get("encodec", {})
                delta_lines = []
                for label, key, fmt in [
                    ("totalNotes", "totalNotes", ".0f"),
                    ("densityMean", "densityMean", ".3f"),
                    ("couplingLabels", "couplingLabelCount", ".0f"),
                    ("tensionArc", "tensionArcShape", ".3f"),
                ]:
                    old_v, new_v = pf.get(key), cf.get(key)
                    if old_v is not None and new_v is not None:
                        d = new_v - old_v
                        sign = "+" if d >= 0 else ""
                        delta_lines.append(
                            f"  {label:<16} {format(old_v, fmt)} → {format(new_v, fmt)}  ({sign}{format(d, fmt)})"
                        )
                for regime in ["coherentShare", "exploringShare", "evolvingShare"]:
                    old_v, new_v = pf.get(regime, 0), cf.get(regime, 0)
                    d = new_v - old_v
                    sign = "+" if d >= 0 else ""
                    delta_lines.append(
                        f"  {regime:<16} {old_v:.1%} → {new_v:.1%}  ({sign}{d:.1%})"
                    )
                old_cb0 = pp.get("cb0_entropy")
                new_cb0 = cp.get("cb0_entropy")
                if old_cb0 is not None and new_cb0 is not None:
                    d = new_cb0 - old_cb0
                    sign = "+" if d >= 0 else ""
                    delta_lines.append(f"  CB0 entropy      {old_cb0:.3f} → {new_cb0:.3f}  ({sign}{d:.3f})")
                if delta_lines:
                    out.append(f"## Run Delta  ({prev.get('timestamp','?')[:16]} → {cur.get('timestamp','?')[:16]})")
                    out.extend(delta_lines)
                    out.append("")
            except Exception:
                pass

    # --- Optional critique ---
    if critique:
        try:
            from .digest_analysis import composition_critique as _compose_critique
            out.append("## Musical Critique")
            out.append(_compose_critique())
        except Exception as e:
            out.append(f"## Musical Critique\n*(unavailable: {e})*")

    # --- Inline evolution suggestions (default on) ---
    # Cap total digest output at ~8000 chars (~2000 tokens) to limit Claude context spend.
    # If budget remains after composition arc/delta, include evolution; else skip with note.
    _DIGEST_CHAR_CAP = 8000
    _current_len = sum(len(s) for s in out)
    if evolve:
        try:
            from .evolution_suggest import suggest_evolution as _suggest_ev
            from .synthesis import compress_for_claude as _compress
            _evo = _suggest_ev()
            if _current_len + len(_evo) <= _DIGEST_CHAR_CAP:
                out.append("\n---")
                out.append(_evo)
            else:
                # Over budget: compress via arbiter rather than hard truncation
                _remaining = max(800, _DIGEST_CHAR_CAP - _current_len - 8)
                _compressed = _compress(_evo, max_chars=_remaining,
                                        hint="ranked evolution proposals for next Polychron round")
                out.append("\n---")
                out.append(_compressed)
        except Exception as e:
            out.append(f"\n## Evolution\n*(unavailable: {e})*")

    _touch_digest_sentinel()
    return "\n".join(out)


