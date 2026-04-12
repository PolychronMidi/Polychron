"""HME trace — unified signal flow tracing.

Merges trace_query (module/causal) + coupling_intel(cascade:X) + delta comparison into one tool.
"""
import json
import logging
import os
import subprocess

from server import context as ctx
from . import _track, _load_trace, _budget_gate, BUDGET_TOOL
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def trace(target: str, mode: str = "auto", section: int = -1, limit: int = 15) -> str:
    """Trace signal flow through the system.
    'channelName' → L0 cascade trace (follow signal through consumers 3 hops deep).
    'moduleName' → per-section trace (regime, tension, notes, profile per section).
    mode='auto' (default) detects from target: known L0 channel names → cascade,
    otherwise → module trace. mode='cascade'|'module'|'causal' to force.
    mode='delta': compare current vs previous pipeline run — shows feature deltas,
    section regime shifts, and trust score changes for changed modules.
    Pass target='' or target='auto' for delta mode (auto-detects changed modules from git)."""
    _track("trace")
    append_session_narrative("trace", f"trace({mode}): {target[:60]}")
    ctx.ensure_ready_sync()

    if mode == "delta":
        return _budget_gate(_trace_delta(target if target and target != "auto" else ""))

    if not target or not target.strip():
        return "Error: target cannot be empty. Pass a channel name or module name."

    target = target.strip()

    if mode == "auto":
        mode = _detect_trace_type(target)

    if mode == "cascade":
        from .coupling import coupling_intel as _ci
        return _ci(mode=f"cascade:{target}")

    if mode == "interaction":
        from .evolution_trace import interaction_map as _im
        return _im(module_a=target, module_b="")

    # Module or causal trace
    from .evolution_trace import trace_query as _tq
    return _tq(module=target, section=section, limit=limit, mode=mode if mode not in ("auto", "interaction") else "module")


def _detect_trace_type(target: str) -> str:
    """Detect whether target is an L0 channel name or a module name."""
    # Known L0 channel name patterns: lowercase with hyphens
    if '-' in target:
        return "cascade"
    # Known camelCase L0 channel names (posted via L0.post())
    _KNOWN_CAMEL_CHANNELS = {
        "emergentRhythm", "emergentMelody", "emergentDownbeat",
        "feedbackLoop", "feedbackPitch", "stutterContagion",
        "regimeTransition", "sectionQuality",
    }
    if target in _KNOWN_CAMEL_CHANNELS:
        return "cascade"
    # camelCase starting with uppercase = likely a module (e.g. "crossLayerClimaxEngine")
    # camelCase starting with lowercase but has uppercase = could be module or channel
    # Heuristic: if it matches a JS module naming pattern (multi-word camel) → module
    import re
    if re.search(r'[A-Z][a-z]', target[1:]) and len(target) > 15:
        return "module"  # long camelCase = almost always a module name
    # All lowercase, no hyphens — check known channels
    _KNOWN_CHANNELS = {
        "articulation", "chord", "coherence", "density", "entropy",
        "harmonic", "onset", "spectral", "tension", "velocity",
    }
    if target in _KNOWN_CHANNELS:
        return "cascade"
    return "module"


def _trace_delta(focus: str = "") -> str:
    """Compare current vs previous pipeline run: feature deltas, section shifts, trust changes.

    If focus is a module name, filters trust analysis to that module.
    If empty, auto-detects changed modules from git diff.
    """
    history_dir = os.path.join(ctx.PROJECT_ROOT, "metrics", "run-history")
    if not os.path.isdir(history_dir):
        return "No run-history directory. Need at least 2 pipeline runs for delta."

    history_files = sorted(
        [f for f in os.listdir(history_dir) if f.endswith(".json")],
        reverse=True,
    )
    if len(history_files) < 2:
        return "Need at least 2 pipeline runs for delta comparison."

    try:
        with open(os.path.join(history_dir, history_files[0]), encoding="utf-8") as f:
            curr = json.load(f)
        with open(os.path.join(history_dir, history_files[1]), encoding="utf-8") as f:
            prev = json.load(f)
    except Exception as e:
        return f"Error loading run-history: {e}"

    curr_ts = history_files[0][:19].replace("T", " ")
    prev_ts = history_files[1][:19].replace("T", " ")
    parts = [f"# Trace Delta\n  Current: {curr_ts}\n  Previous: {prev_ts}\n"]

    # Determine changed modules
    changed_modules: set[str] = set()
    if focus:
        changed_modules = {focus}
    else:
        try:
            r = subprocess.run(
                ["git", "diff", "--name-only", "HEAD"],
                capture_output=True, text=True, timeout=5, cwd=ctx.PROJECT_ROOT,
            )
            for line in r.stdout.strip().splitlines():
                if line.startswith("src/") and line.endswith(".js"):
                    changed_modules.add(os.path.basename(line).replace(".js", ""))
        except Exception:
            pass

    # Feature deltas
    cf = curr.get("features", {})
    pf = prev.get("features", {})
    key_features = [
        ("coherentShare", "regime"), ("exploringShare", "regime"), ("evolvingShare", "regime"),
        ("densityMean", "texture"), ("pitchEntropy", "texture"),
        ("healthScore", "health"), ("exceedanceRate", "health"),
        ("trustConvergence", "trust"), ("totalNotes", "output"),
    ]
    last_group = ""
    for key, group in key_features:
        cv, pv = cf.get(key), pf.get(key)
        if cv is None or pv is None:
            continue
        delta = cv - pv
        if abs(delta) < 0.001 and key != "totalNotes":
            continue
        if group != last_group:
            parts.append(f"  [{group}]")
            last_group = group
        arrow = "+" if delta > 0 else ""
        pct = f" ({delta / pv * 100:+.1f}%)" if pv != 0 else ""
        parts.append(f"    {key:<22} {pv:.3f} -> {cv:.3f}  {arrow}{delta:.3f}{pct}")
    parts.append("")

    # Section-level regime comparison
    curr_sections = cf.get("sections", [])
    prev_sections = pf.get("sections", [])
    if curr_sections or prev_sections:
        parts.append("## Section Deltas")
        n_sections = max(len(curr_sections), len(prev_sections))
        for i in range(n_sections):
            cs = curr_sections[i] if i < len(curr_sections) else None
            ps = prev_sections[i] if i < len(prev_sections) else None
            if cs and ps:
                cr = cs.get("dominantRegime", "?")
                pr = ps.get("dominantRegime", "?")
                ct = cs.get("tensionMean", cs.get("avgTension", 0))
                pt = ps.get("tensionMean", ps.get("avgTension", 0))
                try:
                    ct, pt = float(ct), float(pt)
                    t_delta = f" ({ct - pt:+.3f})" if abs(ct - pt) > 0.01 else ""
                except (TypeError, ValueError):
                    t_delta = ""
                regime_flag = f" <- was {pr}" if cr != pr else ""
                parts.append(f"  S{i}: {cr}{regime_flag} | tension={ct:.3f}{t_delta} | {cs.get('beats', '?')}b")
            elif cs:
                parts.append(f"  S{i}: {cs.get('dominantRegime', '?')} (NEW section)")
            elif ps:
                parts.append(f"  S{i}: (REMOVED — was {ps.get('dominantRegime', '?')})")
        parts.append("")

    # Trust score changes for changed modules
    if changed_modules:
        trace_jsonl = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
        records = _load_trace(trace_jsonl)
        if records:
            parts.append(f"## Changed Module Trust ({', '.join(sorted(changed_modules))})")
            for mod in sorted(changed_modules):
                scores = []
                for rec in records:
                    trust = rec.get("trust", {})
                    data = trust.get(mod)
                    if isinstance(data, dict) and "score" in data:
                        scores.append(float(data["score"]))
                if scores:
                    avg = sum(scores) / len(scores)
                    mn, mx = min(scores), max(scores)
                    parts.append(f"  {mod}: avg={avg:.3f} range=[{mn:.3f}, {mx:.3f}] (n={len(scores)})")
                else:
                    parts.append(f"  {mod}: no trust data in trace")
            parts.append("")

    # Verdict comparison
    cv = curr.get("verdict")
    pv = prev.get("verdict")
    if cv or pv:
        parts.append(f"## Verdict: {pv or 'none'} -> {cv or 'none'}")

    # Trace-replay section comparison (if available, richer than run-history sections)
    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-replay.json")
    if os.path.isfile(trace_path):
        try:
            with open(trace_path, encoding="utf-8") as f:
                trace_data = json.load(f)
            stats = trace_data.get("stats", [])
            if stats:
                total_notes = sum(
                    sum(p.get("noteCount", 0) for p in s.get("phrases", []))
                    for s in stats
                )
                parts.append(f"\n## Current Trace Detail")
                for s in stats:
                    phrases = s.get("phrases", [])
                    phrase_info = ", ".join(
                        f"{p['phrase']}({p.get('noteCount', '?')}n)"
                        for p in phrases[:4]
                    )
                    parts.append(
                        f"  {s['section']}: {s.get('dominantRegime', '?')} "
                        f"key={s.get('key', '?')}/{s.get('mode', '?')} "
                        f"tension={s.get('avgTension', '?')} "
                        f"[{phrase_info}]"
                    )
        except Exception:
            pass

    return "\n".join(parts)
