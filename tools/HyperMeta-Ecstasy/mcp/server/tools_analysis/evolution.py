"""HME evolution intelligence — patterns, causal trace, introspection."""
import json
import os
import re
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, BUDGET_LIMITS
from symbols import find_callers as _find_callers
from .synthesis import (
    _get_api_key, _claude_think, _local_think, _think_local_or_claude,
    _format_kb_corpus, _THINK_MODEL, _get_max_tokens, _get_effort, _get_tool_budget,
)
from . import _get_compositional_context, _track, _usage_stats

logger = logging.getLogger("HyperMeta-Ecstasy")

@ctx.mcp.tool()
def evolution_patterns() -> str:
    """Analyze metrics/journal.md for meta-patterns across evolution rounds. Identifies confirm/refute rates, subsystem receptivity, recurring themes, and stabilization timelines. Use to understand HOW the system evolves, not just what changed."""
    ctx.ensure_ready_sync()
    _track("evolution_patterns")
    import re
    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    if not os.path.isfile(journal_path):
        return "No journal found at metrics/journal.md"
    content = open(journal_path, encoding="utf-8").read()

    rounds = re.findall(r'## R(\d+)', content)
    confirmed = re.findall(r'confirmed', content, re.IGNORECASE)
    refuted = re.findall(r'refuted', content, re.IGNORECASE)
    inconclusive = re.findall(r'inconclusive', content, re.IGNORECASE)
    total_outcomes = len(confirmed) + len(refuted) + len(inconclusive)
    subsystem_counts = {}
    for sub in ['conductor', 'crossLayer', 'composers', 'rhythm', 'fx', 'time', 'play', 'writer']:
        count = len(re.findall(sub, content, re.IGNORECASE))
        if count:
            subsystem_counts[sub] = count

    parts = [
        f"## Evolution Patterns ({len(rounds)} rounds analyzed)\n",
        f"**Outcomes:** {len(confirmed)} confirmed, {len(refuted)} refuted, {len(inconclusive)} inconclusive",
        f"**Confirm rate:** {len(confirmed) / max(1, total_outcomes):.0%}\n",
        "**Subsystem activity:**",
    ]
    for sub, count in sorted(subsystem_counts.items(), key=lambda x: -x[1]):
        parts.append(f"  {sub}: {count} mentions")

    journal_tail = content[-4000:]
    user_text = (
        f"Evolution journal excerpt (last ~4000 chars of {len(content)} total):\n{journal_tail}\n\n"
        f"Stats: {len(rounds)} rounds, {len(confirmed)} confirmed, "
        f"{len(refuted)} refuted, {len(inconclusive)} inconclusive\n\n"
        "In 5 bullet points identify:\n"
        "(1) which types of evolutions succeed most often and why,\n"
        "(2) which subsystems are most vs least receptive to change,\n"
        "(3) recurring constants or areas that keep needing adjustment,\n"
        "(4) how many rounds changes typically take to stabilize,\n"
        "(5) any anti-patterns in the evolution approach that should be avoided."
    )
    synthesis = _think_local_or_claude(user_text, _get_api_key())
    if synthesis:
        parts.append(f"\n## Pattern Analysis *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)


@ctx.mcp.tool()
def causal_trace(symptom: str, max_depth: int = 3) -> str:
    """Trace the causal chain from a symptom (constant name, module name, signal dimension, or description like 'density too high in coherent') through controllers, metrics, and regime behavior to its musical effect on the listener. Shows the complete cascade: constant -> controller -> metric -> musical character."""
    ctx.ensure_ready_sync()
    _track("causal_trace")
    if not symptom.strip():
        return "Error: symptom cannot be empty. Pass a constant name, module name, signal dimension, or description of the issue."
    parts = [f"# Causal Trace: {symptom}\n"]

    callers = _find_callers(symptom, ctx.PROJECT_ROOT)
    callers = [r for r in callers if symptom not in os.path.basename(r.get('file', ''))]
    caller_files = sorted(set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in callers))
    parts.append(f"## Direct References ({len(caller_files)} files)")
    for f in caller_files[:15]:
        parts.append(f"  {f}")

    subsystems = set()
    for f in caller_files:
        for sub in ['conductor', 'crossLayer', 'composers', 'rhythm', 'fx', 'time', 'play', 'writer']:
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
            tuning = open(tuning_path, encoding="utf-8").read()
            tuning_lines = [l for l in tuning.split("\n") if symptom.lower() in l.lower()]
            if tuning_lines:
                tuning_context = "Tuning map references:\n" + "\n".join(tuning_lines[:10])
        except Exception:
            pass

    # Ground synthesis in actual source code — prevents hallucination
    from .synthesis import _read_module_source
    source_code = _read_module_source(symptom, max_chars=2000)
    source_block = f"\nSource code (first 2000 chars):\n```\n{source_code}\n```\n" if source_code else ""

    user_text = (
        f"Trace the causal chain for: {symptom}\n"
        f"Direct callers ({len(caller_files)}): {', '.join(caller_files[:10])}\n"
        f"Subsystems touched: {', '.join(sorted(subsystems))}\n"
        + source_block
        + (f"\n{tuning_context}\n" if tuning_context else "")
        + "\nBased on the ACTUAL source code above, trace the causal chain from this "
        "module to the listener's experience. Format: A -> B -> C -> [musical effect]. "
        "Only reference functions and behaviors visible in the code. Do NOT invent behaviors. "
        "Be specific about musical quality (e.g. 'less rhythmic tension', 'denser texture')."
    )
    api_key = _get_api_key()
    synthesis = None
    if api_key:
        synthesis = _claude_think(user_text, api_key, kb_context=_format_kb_corpus(),
                                   max_tool_calls=_get_tool_budget())
    if not synthesis:
        synthesis = _local_think(user_text, max_tokens=1024)
    if synthesis:
        parts.append(f"\n## Causal Chain *(adaptive)*")
        parts.append(synthesis)

    return "\n".join(parts)


def hme_introspect() -> str:
    """Self-benchmarking: report HME tool usage patterns for this session. Shows which tools are called most, which mandatory tools are underused, and compositional context from the last pipeline run."""
    _track("hme_introspect")
    parts = ["## HME Session Introspection\n"]

    if _usage_stats:
        sorted_usage = sorted(_usage_stats.items(), key=lambda x: -x[1])
        parts.append("### Tool Usage This Session")
        for tool, count in sorted_usage:
            parts.append(f"  {tool}: {count}")
        parts.append(f"\n**Total tracked calls:** {sum(c for _, c in sorted_usage)}")
        expected = {"before_editing", "what_did_i_forget", "search_knowledge", "search_code", "add_knowledge"}
        unused = expected - set(_usage_stats.keys())
        if unused:
            parts.append(f"**Mandatory but unused:** {', '.join(sorted(unused))}")
    else:
        parts.append("### Tool Usage: no tracked calls yet")

    parts.append("")

    comp = _get_compositional_context("system")
    if comp:
        parts.append("### Last Run Musical Context")
        parts.append(comp)

    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    if os.path.isfile(journal_path):
        try:
            header_lines = []
            for line in open(journal_path, encoding="utf-8"):
                if header_lines and line.startswith("## R"):
                    break
                header_lines.append(line.rstrip())
                if len(header_lines) > 15:
                    break
            if header_lines:
                parts.append("\n### Latest Journal Entry")
                parts.append("\n".join(header_lines[:15]))
        except Exception:
            pass

    kb_count = 0
    try:
        ctx.ensure_ready_sync()
        all_kb = ctx.project_engine.list_knowledge()
        kb_count = len(all_kb)
    except Exception:
        pass
    idx = {"files": 0, "chunks": 0, "symbols": 0}
    try:
        status = ctx.project_engine.get_status()
        idx["files"] = status.get("total_files", 0)
        idx["chunks"] = status.get("total_chunks", 0)
        sym_status = ctx.project_engine.get_symbol_status()
        idx["symbols"] = sym_status.get("total_symbols", 0) if sym_status.get("indexed") else 0
    except Exception:
        pass
    parts.append(f"\n### System Health")
    parts.append(f"  KB entries: {kb_count}")
    parts.append(f"  Index: {idx['files']} files, {idx['chunks']} chunks, {idx['symbols']} symbols")

    return "\n".join(parts)


@ctx.mcp.tool()
def trace_query(module: str, section: int = -1, limit: int = 15) -> str:
    """Query the last pipeline run's trace.jsonl for runtime behavior of a specific module.
    Shows what a module ACTUALLY DID: when it fired, what values it produced, which
    sections/regimes it was active in. Set section=N to filter to a specific section.
    Works for trust system names, snap fields, coupling labels, and top-level trace keys."""
    ctx.ensure_ready_sync()
    _track("trace_query")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found. Run `npm run main` to generate."

    # Stream trace.jsonl and extract module-specific data
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
                # Parse section from beatKey (format: "section:phrase:beat:sub")
                sec = -1
                if isinstance(beat_key, str) and ":" in beat_key:
                    try:
                        sec = int(beat_key.split(":")[0])
                    except ValueError:
                        pass
                if section >= 0 and sec != section:
                    continue

                # Extract module-specific values from different trace locations
                values = {}

                # 1. Trust system: trust.{moduleName}.score/weight
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

                # 2. Snap fields: snap.{field} containing module name
                snap = record.get("snap", {})
                for k, v in snap.items():
                    if module_lower in k.lower():
                        if isinstance(v, (int, float)):
                            values[k] = round(v, 4) if isinstance(v, float) else v
                        elif isinstance(v, str) and len(v) < 50:
                            values[k] = v

                # 3. Top-level fields containing module name
                for k, v in record.items():
                    if k in ("trust", "snap", "notes", "stageTiming"):
                        continue
                    if module_lower in k.lower():
                        if isinstance(v, (int, float)):
                            values[k] = round(v, 4) if isinstance(v, float) else v
                        elif isinstance(v, str) and len(v) < 80:
                            values[k] = v

                # 4. Coupling labels mentioning module
                labels = record.get("couplingLabels", {})
                if isinstance(labels, dict):
                    for k, v in labels.items():
                        if module_lower in k.lower():
                            values[f"coupling:{k}"] = v

                if values:
                    beats.append({"beatKey": beat_key, "section": sec, "regime": regime, "values": values})
    except Exception as e:
        return f"Error reading trace: {e}"

    if not beats:
        return (f"No trace data for '{module}' across {total_beats} beats. "
                "Try: trust system name (e.g. 'coherenceMonitor'), snap field, or coupling label.")

    # Summarize
    sections_seen = sorted(set(b["section"] for b in beats if b["section"] >= 0))
    regime_counts = {}
    for b in beats:
        regime_counts[b["regime"]] = regime_counts.get(b["regime"], 0) + 1

    # Compute value ranges for numeric fields
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

    # Regime transitions — the musically dramatic moments
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

    # Sample entries — spread across the composition (every Nth)
    step = max(1, len(beats) // limit)
    samples = beats[::step][:limit]
    parts.append(f"\n### Samples ({len(samples)} of {len(beats)}, evenly spaced)")
    for b in samples:
        vals = ", ".join(f"{k}={v}" for k, v in list(b["values"].items())[:4])
        parts.append(f"  {b['beatKey']} [{b['regime']}] {vals}")

    return "\n".join(parts)


@ctx.mcp.tool()
def interaction_map(module_a: str, module_b: str = "") -> str:
    """Show how two modules interact at runtime by correlating their trust scores,
    weight trajectories, and hotspot co-occurrence across the last pipeline run.
    Reveals whether modules cooperate, compete, or are independent.
    If only module_a is given, shows its interactions with all other traced modules."""
    ctx.ensure_ready_sync()
    _track("interaction_map")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    if not os.path.isfile(trace_path):
        return "No trace.jsonl found."

    # Single-module mode: find all modules it interacts with
    if not module_b.strip():
        try:
            modules_seen = set()
            with open(trace_path, encoding="utf-8") as f:
                for line in f:
                    try:
                        record = json.loads(line)
                    except Exception:
                        continue
                    trust = record.get("trust", {})
                    modules_seen.update(k for k in trust.keys() if k.lower() != module_a.lower())
            if not modules_seen:
                return f"No other modules found in trace data to compare with '{module_a}'."
            parts = [f"# Interaction Map: {module_a} vs all\n"]
            for other in sorted(modules_seen)[:10]:
                # Recursive call for each pair — limited to top 10
                parts.append(f"---\n## vs {other}")
                # Inline a lightweight correlation check
                parts.append(f"  (use interaction_map module_a='{module_a}' module_b='{other}' for details)")
            return "\n".join(parts)
        except Exception as e:
            return f"Error scanning trace: {e}"

    a_lower, b_lower = module_a.lower(), module_b.lower()
    a_scores, b_scores, a_weights, b_weights = [], [], [], []
    co_hotspot = 0
    total = 0

    try:
        with open(trace_path, encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                trust = record.get("trust", {})
                a_data = next((v for k, v in trust.items() if k.lower() == a_lower), None)
                b_data = next((v for k, v in trust.items() if k.lower() == b_lower), None)
                if not a_data or not b_data or not isinstance(a_data, dict) or not isinstance(b_data, dict):
                    continue
                total += 1
                a_scores.append(a_data.get("score", 0))
                b_scores.append(b_data.get("score", 0))
                a_weights.append(a_data.get("weight", 1))
                b_weights.append(b_data.get("weight", 1))
                if a_data.get("hotspotPressure", 0) > 0.1 and b_data.get("hotspotPressure", 0) > 0.1:
                    co_hotspot += 1
    except Exception as e:
        return f"Error reading trace: {e}"

    if total < 10:
        return f"Insufficient data: only {total} beats with both '{module_a}' and '{module_b}' trust data."

    # Compute correlation
    import math
    def _corr(xs, ys):
        n = len(xs)
        mx, my = sum(xs)/n, sum(ys)/n
        cov = sum((x-mx)*(y-my) for x, y in zip(xs, ys)) / n
        sx = math.sqrt(sum((x-mx)**2 for x in xs) / n)
        sy = math.sqrt(sum((y-my)**2 for y in ys) / n)
        return cov / (sx * sy) if sx > 0 and sy > 0 else 0

    score_corr = _corr(a_scores, b_scores)
    weight_corr = _corr(a_weights, b_weights)

    # Interpret
    if score_corr > 0.5:
        relationship = "COOPERATIVE (scores rise and fall together)"
    elif score_corr < -0.3:
        relationship = "COMPETITIVE (one gains when the other loses)"
    else:
        relationship = "INDEPENDENT (scores uncorrelated)"

    parts = [f"## Interaction Map: {module_a} <-> {module_b}\n"]
    parts.append(f"**Relationship:** {relationship}")
    parts.append(f"**Score correlation:** {score_corr:.3f}")
    parts.append(f"**Weight correlation:** {weight_corr:.3f}")
    parts.append(f"**Hotspot co-occurrence:** {co_hotspot}/{total} beats ({co_hotspot/total:.0%})")
    parts.append(f"\n**{module_a}:** score {min(a_scores):.3f}-{max(a_scores):.3f} (avg {sum(a_scores)/len(a_scores):.3f}), weight {min(a_weights):.3f}-{max(a_weights):.3f}")
    parts.append(f"**{module_b}:** score {min(b_scores):.3f}-{max(b_scores):.3f} (avg {sum(b_scores)/len(b_scores):.3f}), weight {min(b_weights):.3f}-{max(b_weights):.3f}")

    # Callers overlap — do they share code dependencies?
    a_callers = set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in _find_callers(module_a, ctx.PROJECT_ROOT))
    b_callers = set(r['file'].replace(ctx.PROJECT_ROOT + '/', '') for r in _find_callers(module_b, ctx.PROJECT_ROOT))
    shared = a_callers & b_callers
    if shared:
        parts.append(f"\n**Shared callers ({len(shared)}):** {', '.join(sorted(shared)[:5])}")

    return "\n".join(parts)


@ctx.mcp.tool()
def kb_seed(top_n: int = 15) -> str:
    """Auto-generate starter KB entries for the highest-dependency modules that have
    zero KB entries. Reads each module's source code and uses a single batched LLM
    call to generate concise architectural constraint summaries. Returns the entries
    as add_knowledge calls you can execute.

    Performance: single-pass file scan for all caller counts (not N scans per symbol),
    plus one batched LLM call for all candidates (not N sequential calls)."""
    ctx.ensure_ready_sync()
    _track("kb_seed")
    from .health import _compute_iife_caller_counts

    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    sym_files, caller_counts, _ = _compute_iife_caller_counts(src_root, ctx.PROJECT_ROOT)
    if not sym_files:
        return "No IIFE globals found in src/."

    modules = sorted(
        [(count, name, sym_files[name]) for name, count in caller_counts.items()],
        key=lambda x: -x[0]
    )

    # --- Load doc content once for doc-coverage filter ---
    from . import _filter_kb_relevance
    import glob as _glob
    doc_content = ""
    doc_paths = _glob.glob(os.path.join(ctx.PROJECT_ROOT, "doc", "*.md"))
    for root_doc in ["CLAUDE.md", "README.md"]:
        rp = os.path.join(ctx.PROJECT_ROOT, root_doc)
        if os.path.isfile(rp):
            doc_paths.append(rp)
    for dp in doc_paths:
        try:
            doc_content += open(dp, encoding="utf-8").read().lower()
        except Exception:
            pass

    # --- Filter: skip if already in KB or already documented ---
    candidates = []
    for count, name, path in modules:
        if count == 0:
            break  # zero callers → self-registered or truly unused, stop here
        kb = ctx.project_engine.search_knowledge(name, top_k=2)
        if _filter_kb_relevance(kb, name):
            continue
        if name.lower() in doc_content:
            continue
        candidates.append((count, name, path))
        if len(candidates) >= top_n:
            break

    if not candidates:
        return "All high-dependency modules already have KB entries."

    # --- Single batched LLM call for all candidates ---
    # Read source snippets
    sources: dict[str, str] = {}
    for _, name, path in candidates:
        try:
            sources[name] = open(path, encoding="utf-8", errors="ignore").read()[:800]
        except Exception:
            sources[name] = ""

    # Build one prompt covering all candidates
    batch_sections = []
    for count, name, _ in candidates:
        src = sources.get(name, "")
        batch_sections.append(
            f"### {name} ({count} callers)\n```\n{src}\n```"
        )
    batch_prompt = (
        "For each module below, write ONE sentence (max 120 chars) stating: "
        "the key architectural constraint AND what breaks if edited carelessly.\n\n"
        + "\n\n".join(batch_sections)
        + "\n\nReply in this exact format (one line per module):\n"
        + "\n".join(f"{name}: <constraint>" for _, name, _ in candidates)
    )
    raw = _local_think(batch_prompt, max_tokens=80 * len(candidates))

    # Parse responses: expect "name: summary" lines
    summaries: dict[str, str] = {}
    if raw:
        for line in raw.splitlines():
            for _, name, _ in candidates:
                if line.startswith(f"{name}:"):
                    summaries[name] = line[len(name) + 1:].strip()
                    break

    parts = [f"## KB Seed — {len(candidates)} modules need KB entries\n"]
    for count, name, _ in candidates:
        summary = summaries.get(name) or f"{name}: {count} callers, needs KB documentation"
        parts.append(f"**{name}** ({count} callers)")
        parts.append(f"  {summary[:200]}")
        parts.append("")

    parts.append(f"\n### To persist, call add_knowledge for each entry above.")
    return "\n".join(parts)


def hme_selftest() -> str:
    """Verify HME's own health: tool registration, doc sync, index integrity,
    Ollama connectivity, hash cache consistency. Run after structural changes."""
    _track("hme_selftest")
    results = []

    # 1. Tool count
    tool_count = 0
    server_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for root, dirs, files in os.walk(server_root):
        for f in files:
            if f.endswith(".py"):
                try:
                    for line in open(os.path.join(root, f), encoding="utf-8"):
                        if line.strip() == "@ctx.mcp.tool()":
                            tool_count += 1
                except Exception:
                    pass
    results.append(f"{'PASS' if tool_count > 40 else 'FAIL'}: {tool_count} tools registered")

    # 2. Doc sync
    try:
        from .health import doc_sync_check
        sync = doc_sync_check("doc/HyperMeta-Ecstasy.md")
        is_sync = "IN SYNC" in sync
        results.append(f"{'PASS' if is_sync else 'FAIL'}: doc sync — {sync[:80]}")
    except Exception as e:
        results.append(f"FAIL: doc sync — {e}")

    # 3. Index health
    try:
        ctx.ensure_ready_sync()
        status = ctx.project_engine.get_status()
        files = status.get("total_files", 0)
        chunks = status.get("total_chunks", 0)
        results.append(f"{'PASS' if files > 100 else 'FAIL'}: index — {files} files, {chunks} chunks")
    except Exception as e:
        results.append(f"FAIL: index — {e}")

    # 4. Hash cache consistency
    try:
        hashes = ctx.project_engine._file_hashes
        table_files = status.get("total_files", 0)
        hash_count = len(hashes)
        consistent = abs(hash_count - table_files) < 50
        results.append(f"{'PASS' if consistent else 'WARN'}: hash cache — {hash_count} hashes vs {table_files} indexed files")
    except Exception as e:
        results.append(f"FAIL: hash cache — {e}")

    # 5. Ollama connectivity
    try:
        from .synthesis import _local_think
        test = _local_think("respond with OK", max_tokens=5)
        results.append(f"{'PASS' if test else 'FAIL'}: Ollama — {'connected' if test else 'no response'}")
    except Exception as e:
        results.append(f"FAIL: Ollama — {e}")

    # 6. KB health
    try:
        kb = ctx.project_engine.list_knowledge()
        results.append(f"{'PASS' if len(kb) > 0 else 'WARN'}: KB — {len(kb)} entries")
    except Exception as e:
        results.append(f"FAIL: KB — {e}")

    # 7. Symlinks
    for name, target in [
        ("~/.claude/mcp/HyperMeta-Ecstasy", "mcp symlink"),
        ("~/.claude/skills/HyperMeta-Ecstasy", "skills symlink"),
    ]:
        path = os.path.expanduser(name)
        results.append(f"{'PASS' if os.path.islink(path) else 'FAIL'}: {target} — {path}")

    passed = sum(1 for r in results if r.startswith("PASS"))
    total = len(results)
    header = f"## HME Self-Test: {passed}/{total} passed\n"
    return header + "\n".join(f"  {r}" for r in results)


@ctx.mcp.tool()
def hme_inspect(mode: str = "both") -> str:
    """Merged HME self-inspection. mode: 'introspect' (session tool usage + compositional context),
    'selftest' (health check: tool count, doc sync, index integrity, Ollama), or 'both' (default).
    Replaces calling hme_introspect + hme_selftest separately."""
    _track("hme_inspect")
    parts = []
    if mode in ("introspect", "both"):
        parts.append(hme_introspect())
    if mode in ("selftest", "both"):
        parts.append(hme_selftest())
    if not parts:
        return f"Unknown mode '{mode}'. Use 'introspect', 'selftest', or 'both'."
    return "\n\n".join(parts)
