"""Trace querying, interaction mapping, and causal chain tracing."""
import json
import os
import re
import logging

from server import context as ctx
from server.helpers import SUBSYSTEM_NAMES
from symbols import find_callers as _find_callers
from .synthesis import (
    _two_stage_think, _read_module_source,
)
from . import _get_compositional_context, _track

logger = logging.getLogger("HME")


def causal_trace(symptom: str, max_depth: int = 3) -> str:
    """Trace the causal chain from a symptom through controllers to musical effect."""
    ctx.ensure_ready_sync()
    _track("causal_trace")
    if not symptom.strip():
        return "Error: symptom cannot be empty."
    parts = [f"# Causal Trace: {symptom}\n"]

    callers = _find_callers(symptom, ctx.PROJECT_ROOT)
    callers = [r for r in callers if symptom not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
    parts.append(f"## Direct References ({len(caller_files)} files)")
    for f in caller_files[:15]:
        parts.append(f"  {f}")

    subsystems = set()
    for f in caller_files:
        for sub in SUBSYSTEM_NAMES:
            if sub in f:
                subsystems.add(sub)
    if subsystems:
        parts.append(f"\n## Subsystem Reach: {', '.join(sorted(subsystems))}")

    kb_results = ctx.project_engine.search_knowledge(symptom, top_k=5)
    if kb_results:
        parts.append(f"\n## KB Context ({len(kb_results)} entries)")
        for k in kb_results:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:150]}")

    comp = _get_compositional_context(symptom)
    if comp:
        parts.append(f"\n## Musical Context")
        parts.append(comp)

    tuning_context = ""
    tuning_path = os.path.join(ctx.PROJECT_ROOT, "doc", "TUNING_MAP.md")
    if os.path.isfile(tuning_path):
        try:
            with open(tuning_path, encoding="utf-8") as _f:
                tuning = _f.read()
            tuning_lines = [l for l in tuning.split("\n") if symptom.lower() in l.lower()]
            if tuning_lines:
                tuning_context = "Tuning map references:\n" + "\n".join(tuning_lines[:10])
        except Exception:
            pass

    source_parts = []
    candidate_modules = re.findall(r'[a-z][a-zA-Z]{8,}', symptom)
    candidate_modules.insert(0, symptom)
    for cf in caller_files[:5]:
        candidate_modules.append(os.path.basename(cf).replace('.js', ''))
    for k in kb_results[:3]:
        candidate_modules.extend(re.findall(r'[a-z][a-zA-Z]{8,}', k.get('title', '')))
    seen = set()
    known_modules: set = set()
    for mod in candidate_modules:
        if mod in seen:
            continue
        seen.add(mod)
        src = _read_module_source(mod, max_chars=2000)
        if src:
            source_parts.append(f"### {mod}\n```\n{src}\n```")
            known_modules.add(mod)
        if len(source_parts) >= 4:
            break
    source_block = "\nSource code:\n" + "\n".join(source_parts) + "\n" if source_parts else ""

    raw_context = (
        f"Symptom: {symptom}\n"
        f"Direct callers ({len(caller_files)}): {', '.join(caller_files[:10])}\n"
        f"Subsystems touched: {', '.join(sorted(subsystems))}\n"
        + source_block
        + (f"\n{tuning_context}\n" if tuning_context else "")
    )
    if kb_results:
        raw_context += "\nKB entries:\n" + "\n".join(
            f"  [{k['category']}] {k['title']}: {k['content'][:200]}" for k in kb_results
        ) + "\n"
    question = (
        "Trace the causal chain from this module to the listener's experience. "
        "Format: A -> B -> C -> [musical effect]. "
        "Only reference functions and behaviors visible in the source code. "
        "Be specific about musical quality (e.g. 'less rhythmic tension', 'denser texture')."
    )

    synthesis = _two_stage_think(raw_context, question)
    if synthesis:
        mentioned = set(re.findall(r'[a-z][a-zA-Z]{8,}', synthesis))
        if known_modules and len(known_modules) >= 2:
            unknown = mentioned - known_modules - set(SUBSYSTEM_NAMES) - {"controller", "conductorIntelligence", "signalReader", "crossLayerEmissionGateway"}
            real_unknown = set()
            for unk in unknown:
                if not _read_module_source(unk, max_chars=50):
                    real_unknown.add(unk)
            if real_unknown and len(real_unknown) <= 5:
                synthesis += f"\n\n*Unverified module names in synthesis: {', '.join(sorted(real_unknown))}*"
        parts.append(f"\n## Causal Chain *(two-stage)*")
        parts.append(synthesis)

    return "\n".join(parts)


def trace_query(module: str, section: int = -1, limit: int = 15, mode: str = "module") -> str:
    """Query the last pipeline run's trace.jsonl for runtime behavior of a specific module.
    Shows what a module ACTUALLY DID: when it fired, what values it produced, which
    sections/regimes it was active in. Set section=N to filter to a specific section.
    mode='module' (default): standard trace lookup. mode='causal': causal chain trace from
    module through controllers to musical effect (folds causal_trace behavior).
    Works for trust system names, snap fields, coupling labels, and top-level trace keys."""
    ctx.ensure_ready_sync()
    _track("trace_query")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found. Run `npm run main` to generate."

    module_lower = module.lower()
    beats = []
    total_beats = 0
    try:
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                total_beats += 1
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                beat_key = record.get("beatKey", "?")
                regime = record.get("regime", "?")
                sec = -1
                if isinstance(beat_key, str) and ":" in beat_key:
                    try:
                        sec = int(beat_key.split(":")[0])
                    except ValueError:
                        pass
                if section >= 0 and sec != section:
                    continue

                values = {}
                trust = record.get("trust", {})
                if module_lower in {k.lower() for k in trust}:
                    for k, v in trust.items():
                        if k.lower() == module_lower and isinstance(v, dict):
                            values["score"] = round(v.get("score", 0), 3)
                            values["weight"] = round(v.get("weight", 0), 3)
                            dp = v.get("dominantPair", "")
                            if dp:
                                values["dominantPair"] = dp
                            hp = v.get("hotspotPressure", 0)
                            if hp > 0:
                                values["hotspot"] = round(hp, 3)

                snap = record.get("snap", {})
                for k, v in snap.items():
                    if module_lower in k.lower():
                        if isinstance(v, (int, float)):
                            values[k] = round(v, 4) if isinstance(v, float) else v
                        elif isinstance(v, str) and len(v) < 50:
                            values[k] = v

                for k, v in record.items():
                    if k in ("trust", "snap", "notes", "stageTiming"):
                        continue
                    if module_lower in k.lower():
                        if isinstance(v, (int, float)):
                            values[k] = round(v, 4) if isinstance(v, float) else v
                        elif isinstance(v, str) and len(v) < 80:
                            values[k] = v

                labels = record.get("couplingLabels", {})
                if isinstance(labels, dict):
                    for k, v in labels.items():
                        if module_lower in k.lower():
                            values[f"coupling:{k}"] = v

                if values:
                    beats.append({"beatKey": beat_key, "section": sec, "regime": regime, "values": values})
    except Exception as e:
        return f"Error reading trace: {e}"

    if mode == "causal":
        return causal_trace(module)

    if not beats:
        return (f"No trace data for '{module}' across {total_beats} beats. "
                "Try: trust system name (e.g. 'coherenceMonitor'), snap field, or coupling label.")

    sections_seen = sorted(set(b["section"] for b in beats if b["section"] >= 0))
    regime_counts = {}
    for b in beats:
        regime_counts[b["regime"]] = regime_counts.get(b["regime"], 0) + 1

    numeric_ranges = {}
    for b in beats:
        for k, v in b["values"].items():
            if isinstance(v, (int, float)):
                if k not in numeric_ranges:
                    numeric_ranges[k] = {"min": v, "max": v, "sum": v, "count": 1}
                else:
                    r = numeric_ranges[k]
                    r["min"] = min(r["min"], v)
                    r["max"] = max(r["max"], v)
                    r["sum"] += v
                    r["count"] += 1

    parts = [f"## Trace Query: {module}\n"]
    parts.append(f"**Beats with data:** {len(beats)} / {total_beats}")
    if sections_seen:
        parts.append(f"**Active in sections:** {', '.join(str(s) for s in sections_seen)}")
    regime_str = ", ".join(f"{k}: {v}" for k, v in sorted(regime_counts.items(), key=lambda x: -x[1]))
    parts.append(f"**Regime distribution:** {regime_str}")

    if numeric_ranges:
        parts.append(f"\n### Value Ranges")
        for k, r in sorted(numeric_ranges.items()):
            avg = r["sum"] / r["count"]
            parts.append(f"  {k}: {r['min']:.3f} - {r['max']:.3f} (avg {avg:.3f}, n={r['count']})")

    from .trust_analysis import TRUST_MUSICAL_MEANING as _TM_TQ
    musical_role = _TM_TQ.get(module, "")
    avg_score_tq = (numeric_ranges["score"]["sum"] / numeric_ranges["score"]["count"]) if "score" in numeric_ranges else None
    avg_weight_tq = (numeric_ranges["weight"]["sum"] / numeric_ranges["weight"]["count"]) if "weight" in numeric_ranges else None
    dom_regime_tq = max(regime_counts, key=lambda r: regime_counts[r]) if regime_counts else "?"
    if avg_score_tq is not None:
        _w_str_tq = f"{avg_weight_tq:.3f}" if avg_weight_tq is not None else "?"
        _hp_rate_tq = numeric_ranges.get("hotspot", {}).get("count", 0) / max(len(beats), 1)
        interp_ctx = (
            f"Trust system '{module}' in a generative alien music composition.\n"
            + (f"Musical role: {musical_role}\n" if musical_role else "")
            + f"avg_score={avg_score_tq:.3f} avg_weight={_w_str_tq}\n"
            + f"dominant regime: {dom_regime_tq}\n"
            + f"hotspot_rate: {_hp_rate_tq:.2f}\n"
        )
        interp = _two_stage_think(interp_ctx,
            f"In ONE sentence (max 35 words), interpret what '{module}' was actually doing to the music -- was it active/passive, helping/competing, what did the listener hear?")
        if interp and len(interp.strip()) > 10:
            parts.append(f"\n### Musical Interpretation")
            parts.append(f"  {interp.strip()}")

    transitions = []
    prev_regime = None
    for b in beats:
        if b["regime"] != prev_regime and prev_regime is not None:
            transitions.append({"beatKey": b["beatKey"], "from": prev_regime, "to": b["regime"], "values": b["values"]})
        prev_regime = b["regime"]
    if transitions:
        parts.append(f"\n### Regime Transitions ({len(transitions)})")
        for t in transitions[:12]:
            vals = ", ".join(f"{k}={v}" for k, v in list(t["values"].items())[:3])
            parts.append(f"  {t['beatKey']}: {t['from']} -> {t['to']}  {vals}")

    step = max(1, len(beats) // limit)
    samples = beats[::step][:limit]
    parts.append(f"\n### Samples ({len(samples)} of {len(beats)}, evenly spaced)")
    for b in samples:
        vals = ", ".join(f"{k}={v}" for k, v in list(b["values"].items())[:4])
        parts.append(f"  {b['beatKey']} [{b['regime']}] {vals}")

    return "\n".join(parts)


def interaction_map(module_a: str, module_b: str = "") -> str:
    """Show how two modules interact at runtime by correlating their trust scores."""
    ctx.ensure_ready_sync()
    _track("interaction_map")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    from .coupling_data import _pearson
    from . import _load_trace

    try:
        records = _load_trace(trace_path)
    except Exception as e:
        return f"Error loading trace: {e}"

    if len(records) < 20:
        return "Insufficient trace data (need >= 20 beats)."

    # Extract trust scores for all modules
    all_modules: set = set()
    for rec in records:
        all_modules.update(rec.get("trust", {}).keys())

    a_lower = module_a.lower()
    a_name = None
    for m in all_modules:
        if m.lower() == a_lower:
            a_name = m
            break
    if not a_name:
        return f"Module '{module_a}' not found in trace. Available: {', '.join(sorted(all_modules)[:15])}"

    a_scores = []
    for rec in records:
        td = rec.get("trust", {}).get(a_name, {})
        a_scores.append(td.get("score", 0) if isinstance(td, dict) else 0)

    targets = []
    if module_b:
        b_lower = module_b.lower()
        b_name = None
        for m in all_modules:
            if m.lower() == b_lower:
                b_name = m
                break
        if not b_name:
            return f"Module '{module_b}' not found in trace."
        targets = [b_name]
    else:
        targets = sorted(m for m in all_modules if m != a_name)

    correlations = []
    for t in targets:
        t_scores = []
        for rec in records:
            td = rec.get("trust", {}).get(t, {})
            t_scores.append(td.get("score", 0) if isinstance(td, dict) else 0)
        r = _pearson(a_scores, t_scores)
        correlations.append((t, r))

    correlations.sort(key=lambda x: x[1])

    out = [f"## Interaction Map: {a_name}\n"]
    out.append(f"Correlations across {len(records)} beats:\n")

    cooperators = [(n, r) for n, r in correlations if r >= 0.30]
    antagonists_list = [(n, r) for n, r in correlations if r <= -0.20]

    if antagonists_list:
        out.append("### Antagonists (r <= -0.20)")
        for n, r in antagonists_list:
            bar = "<" * min(int(abs(r) * 10), 8)
            out.append(f"  r={r:+.3f} {bar}  {n}")
        out.append("")

    if cooperators:
        out.append("### Cooperators (r >= 0.30)")
        for n, r in sorted(cooperators, key=lambda x: -x[1]):
            bar = ">" * min(int(r * 10), 8)
            out.append(f"  r={r:+.3f} {bar}  {n}")
        out.append("")

    neutrals = [(n, r) for n, r in correlations if -0.20 < r < 0.30]
    if neutrals and not module_b:
        out.append(f"### Independent ({len(neutrals)} modules with |r| < 0.30)")

    return "\n".join(out)
