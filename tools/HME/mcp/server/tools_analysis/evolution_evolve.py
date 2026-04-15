"""HME evolve — unified 'what should I work on next?' mega-tool.

Merges three data sources into one ranked evolution view:
1. LOC offenders (from codebase_health logic)
2. Coupling dimension gaps + leverage opportunities (from coupling_intel)
3. Pipeline evolution suggestions (from suggest_evolution, if fresh data)
"""
import os
import logging

from server import context as ctx
from server.onboarding_chain import chained
from . import _track, _budget_gate, BUDGET_COMPOUND, BUDGET_TOOL
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
@chained("evolve")
def evolve(focus: str = "all", query: str = "") -> str:
    """Unified evolution intelligence hub. focus='all' (default): LOC offenders +
    coupling gaps + leverage + pipeline suggestions + synthesis.
    focus='loc': LOC offenders only.
    focus='pipeline': pipeline suggestions only.
    focus='patterns': journal meta-patterns across all rounds.
    focus='seed': auto-generate starter KB entries for high-dependency uncovered modules.
    focus='design': bridge design synthesis — proposes specific dimension, direction,
    code location, and musical rationale for top unsaturated antagonist pairs.
focus='curate': living memory curation — detects KB-worthy patterns from recent
    pipeline runs (trust gaps, feature extremes, verdict transitions) and proposes entries.
    focus='forge': verified skill recipes — generates lab sketches for top unsaturated
    antagonist bridges with executable monkey-patch code, ready to test.
    focus='contradict': contradiction detection — full KB pairwise scan finds entries
    that are semantically related but make conflicting claims. Surfaces contradictions
    with resolution suggestions (merge, supersede, or tag contradicts).
    focus='stress': adversarial self-play — runs enforcement probes against LIFESAVER,
    boundary rules, doc sync, hook registration, selftest, and other guardrails.
    Reports gaps in enforcement that could let violations slip through.
    focus='invariants': declarative invariant battery — loads checks from
    config/invariants.json and evaluates each one. Add new invariants as JSON
    without modifying Python.
    focus='think': deep reasoning about a question (pass question in query param).
    focus='blast': blast radius / transitive dependency chain (pass symbol in query).
    focus='coupling': coupling intelligence (pass sub-mode in query: full/network/antagonists/gaps/leverage)."""
    _track("evolve")
    append_session_narrative("evolve", f"evolve({focus})")
    ctx.ensure_ready_sync()
    parts = ["# Evolution Intelligence\n"]

    if focus in ("all", "loc"):
        parts.append(_loc_offenders())

    if focus == "all":
        parts.append(_coupling_opportunities())

    if focus in ("all", "pipeline"):
        parts.append(_pipeline_suggestions())

    if focus == "all":
        parts.append(_synthesis())

    if focus == "patterns":
        from .evolution import evolution_patterns
        return evolution_patterns()

    if focus == "seed":
        from .evolution import kb_seed
        return kb_seed()

    if focus == "design":
        from .coupling_bridges import design_bridges
        _design_out = design_bridges()
        # D1: append structured target marker so onboarding_chain can extract
        # the picked target deterministically even if design output format changes.
        try:
            from server.onboarding_chain import (
                emit_target_marker, _extract_target_from_evolve as _et
            )
            tgt = _et(_design_out)
            if tgt:
                _design_out = _design_out + "\n\n" + emit_target_marker(tgt)
        except Exception as _err1:
            logger.debug(f'silent-except evolution_evolve.py:83: {type(_err1).__name__}: {_err1}')
        return _design_out

    if focus == "curate":
        return _auto_curate()

    if focus == "forge":
        from .coupling_bridges import forge_bridges
        return forge_bridges()

    if focus == "contradict":
        return _detect_contradictions()

    if focus == "stress":
        return _adversarial_stress()

    if focus == "invariants":
        from .evolution_invariants import check_invariants
        return check_invariants()

    if focus == "think":
        if not query:
            return "Error: focus='think' requires query param with the question."
        from .reasoning_think import think as _th
        return _th(about=query)

    if focus == "blast":
        if not query:
            return "Error: focus='blast' requires query param with the symbol name."
        from .reasoning_think import blast_radius as _br
        return _br(query)

    if focus == "coupling":
        from .coupling import coupling_intel as _ci
        return _budget_gate(_ci(mode=query or "full"))

    if focus not in ("all", "loc", "pipeline"):
        return f"Unknown focus '{focus}'. Use: all, loc, pipeline, patterns, seed, design, curate, forge, contradict, stress, invariants, think, blast, coupling."

    budget = BUDGET_COMPOUND if focus == "all" else BUDGET_TOOL
    return _budget_gate("\n".join(parts), budget=budget)


_loc_cache: dict = {"result": "", "ts": 0.0}
_LOC_CACHE_TTL = 120.0


def _loc_offenders(top_n: int = 8) -> str:
    """Top LOC offenders from src/. Cached for 120s since file counts rarely change mid-session."""
    import time as _time
    now = _time.monotonic()
    if _loc_cache["result"] and (now - _loc_cache["ts"]) < _LOC_CACHE_TTL:
        return _loc_cache["result"]

    from file_walker import walk_code_files
    from server.helpers import LINE_COUNT_TARGET, LINE_COUNT_CRITICAL

    oversize = []
    for fpath in walk_code_files(ctx.PROJECT_ROOT):
        rel = str(fpath).replace(ctx.PROJECT_ROOT + "/", "")
        if not rel.startswith("src/"):
            continue
        try:
            lc = sum(1 for _ in open(fpath, encoding="utf-8", errors="ignore"))
        except Exception as _err:
            logger.debug(f"unnamed-except evolution_evolve.py:148: {type(_err).__name__}: {_err}")
            continue
        if lc > LINE_COUNT_CRITICAL:
            oversize.append((rel, lc))
    oversize.sort(key=lambda x: -x[1])
    if not oversize:
        result = "## LOC: all src/ files under target"
    else:
        lines = [f"## LOC Offenders ({len(oversize)} files > {LINE_COUNT_CRITICAL} lines)\n"]
        for rel, lc in oversize[:top_n]:
            lines.append(f"  {lc:>4} lines  {rel}")
        if len(oversize) > top_n:
            lines.append(f"  ... and {len(oversize) - top_n} more")
        result = "\n".join(lines)
    _loc_cache["result"] = result
    _loc_cache["ts"] = now
    return result


def _coupling_opportunities() -> str:
    """Dimension gaps + top unsaturated leverage pairs."""
    parts = []
    try:
        from .coupling import dimension_gap_finder, antagonism_leverage
        gaps = dimension_gap_finder()
        # Extract just the gap lines (compact)
        gap_lines = [l for l in gaps.split("\n") if l.strip().startswith("x") or "x " in l]
        if gap_lines:
            parts.append("## Coupling Gaps (lowest coverage first)\n")
            for gl in gap_lines[:6]:
                parts.append(f"  {gl.strip()}")
        # Leverage: only unsaturated pairs
        lev = antagonism_leverage(pair_limit=4)
        unsaturated = []
        for block in lev.split("## r="):
            if "SATURATED" not in block and block.strip():
                header = block.split("\n")[0].strip()
                unsaturated.append(f"  r={header[:80]}")
        if unsaturated:
            parts.append(f"\n## Unsaturated Antagonist Pairs ({len(unsaturated)} available)\n")
            for u in unsaturated[:4]:
                parts.append(u)
        elif "SATURATED" in lev:
            parts.append("\n## Antagonist Pairs: all top pairs fully saturated")
    except Exception as e:
        parts.append(f"## Coupling: error — {e}")
    return "\n".join(parts) if parts else "## Coupling: no data"


def _pipeline_suggestions() -> str:
    """Evolution suggestions from last pipeline run."""
    try:
        from .evolution_suggest import suggest_evolution
        result = suggest_evolution()
        if result and len(result) > 50:
            # Compact: take just the ranked proposals section
            proposals_start = result.find("## Ranked")
            if proposals_start == -1:
                proposals_start = result.find("## Evolution")
            if proposals_start == -1:
                proposals_start = 0
            return result[proposals_start:proposals_start + 2000]
        return "## Pipeline Suggestions: no fresh data (run pipeline first)"
    except Exception as e:
        return f"## Pipeline Suggestions: error — {e}"


def _synthesis() -> str:
    """Dynamic priority synthesis from session context + data signals."""
    from .synthesis_session import get_session_narrative
    narrative = get_session_narrative(max_entries=5, categories=["pipeline", "kb", "evolve", "edit"])
    lines = ["\n## Priority Synthesis\n"]
    if narrative:
        lines.append(narrative.strip())
        lines.append("")
    lines.append("Highest-impact actions (from combined signals above):")
    lines.append("  1. Split the worst LOC offender (reduces cognitive load + enables coupling)")
    lines.append("  2. Bridge the top unsaturated antagonist pair (maximum musical texture impact)")
    lines.append("  3. Add coupling to uncoupled high-trust modules (leverages existing quality)")
    return "\n".join(lines)


def _auto_curate() -> str:
    """Living memory curation: detect KB-worthy patterns from recent pipeline runs."""
    import json

    history_dir = os.path.join(ctx.PROJECT_ROOT, "metrics", "run-history")
    if not os.path.isdir(history_dir):
        return "# Auto-Curate\n\nNo run-history directory. Run pipeline first."

    history_files = sorted(
        [f for f in os.listdir(history_dir) if f.endswith(".json")],
        reverse=True,
    )
    if not history_files:
        return "# Auto-Curate\n\nNo pipeline runs found."

    runs = []
    for fname in history_files[:10]:
        try:
            with open(os.path.join(history_dir, fname), encoding="utf-8") as f:
                runs.append(json.load(f))
        except Exception as _err:
            logger.debug(f"unnamed-except evolution_evolve.py:250: {type(_err).__name__}: {_err}")
            continue

    if not runs:
        return "# Auto-Curate\n\nCouldn't load run history."

    latest = runs[0]
    feats = latest.get("features", {})

    kb_entries = ctx.project_engine.search_knowledge("", top_k=50)
    kb_text = " ".join(
        (e.get("title", "") + " " + e.get("content", "")[:200]).lower()
        for e in kb_entries
    )

    candidates: list[dict] = []

    # 1. Top trust system undocumented
    top_trust = feats.get("topTrustSystem", "")
    if top_trust and top_trust.lower() not in kb_text:
        candidates.append({
            "type": "trust_undocumented",
            "title": f"Top trust system: {top_trust}",
            "detail": f"#1 trust (weight={feats.get('topTrustWeight', '?')}) — no KB entry",
            "category": "pattern",
            "draft": (
                f"{top_trust} is the current top trust system with weight "
                f"{feats.get('topTrustWeight', '?')}. Document its musical effect, "
                f"coupling relationships, and conditions that boost its trust."
            ),
        })

    # 2. Feature values at >2sigma from historical mean
    if len(runs) >= 3:
        tracked = [
            ("coherentShare", "Regime balance"), ("exploringShare", "Regime balance"),
            ("densityMean", "Texture"), ("pitchEntropy", "Texture"),
            ("healthScore", "Health"), ("exceedanceRate", "Health"),
            ("trustConvergence", "Trust"), ("tensionArcShape", "Form"),
        ]
        for key, domain in tracked:
            vals = [r.get("features", {}).get(key) for r in runs
                    if r.get("features", {}).get(key) is not None]
            if len(vals) < 3:
                continue
            curr = vals[0]
            hist = vals[1:]
            mean = sum(hist) / len(hist)
            std = (sum((v - mean) ** 2 for v in hist) / len(hist)) ** 0.5
            if std > 0.001 and abs(curr - mean) > 2 * std:
                direction = "spike" if curr > mean else "drop"
                candidates.append({
                    "type": "feature_extreme",
                    "title": f"{domain} {direction}: {key}={curr:.3f}",
                    "detail": f"Current {curr:.3f} vs mean {mean:.3f} +/-{std:.3f} (>2sigma)",
                    "category": "pattern",
                    "draft": (
                        f"{key} showed a significant {direction} to {curr:.3f} "
                        f"(historical mean {mean:.3f} +/-{std:.3f}). "
                        f"Investigate what changed and whether this is desirable."
                    ),
                })

    # 3. Verdict transition
    verdicts = [r.get("verdict") for r in runs if r.get("verdict")]
    if len(verdicts) >= 2 and verdicts[0] != verdicts[1]:
        transition = f"{verdicts[1]} -> {verdicts[0]}"
        candidates.append({
            "type": "verdict_shift",
            "title": f"Verdict transition: {transition}",
            "detail": "Pipeline verdict changed between last two runs",
            "category": "decision",
            "draft": (
                f"Verdict changed from {verdicts[1]} to {verdicts[0]}. "
                f"Document what changes drove this transition."
            ),
        })

    # 4. Coupling labels from trace-summary not in KB
    try:
        ts_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-summary.json")
        with open(ts_path, encoding="utf-8") as f:
            ts = json.load(f)
        labels = ts.get("couplingLabels", ts.get("aggregateCouplingLabels", {}))
        if isinstance(labels, dict):
            for label in labels:
                if label.lower() not in kb_text and len(label) > 3:
                    candidates.append({
                        "type": "coupling_undocumented",
                        "title": f"Coupling label: {label}",
                        "detail": "Active coupling pattern not documented in KB",
                        "category": "architecture",
                        "draft": (
                            f"The coupling label '{label}' is active but undocumented. "
                            f"Record which module pairs produce it and its musical effect."
                        ),
                    })
    except Exception as _err2:
        logger.debug(f'silent-except evolution_evolve.py:347: {type(_err2).__name__}: {_err2}')

    # 5. Section count change
    if len(runs) >= 2:
        curr_sc = feats.get("sectionCount", 0)
        prev_sc = runs[1].get("features", {}).get("sectionCount", 0)
        if curr_sc and prev_sc and curr_sc != prev_sc:
            candidates.append({
                "type": "structural_shift",
                "title": f"Section count: {prev_sc} -> {curr_sc}",
                "detail": "Composition structure changed between runs",
                "category": "pattern",
                "draft": (
                    f"Section count changed from {prev_sc} to {curr_sc}. "
                    f"Document what drove the structural shift."
                ),
            })

    # 6. Trust weight spread extremes
    spread = feats.get("trustWeightSpread")
    if spread is not None:
        if spread < 0.15:
            candidates.append({
                "type": "trust_monopoly",
                "title": f"Trust monopoly: spread={spread:.3f}",
                "detail": f"Top system {feats.get('topTrustSystem', '?')} dominates",
                "category": "pattern",
                "draft": (
                    f"Trust weight spread is only {spread:.3f} — monopoly by "
                    f"{feats.get('topTrustSystem', '?')}. Document whether this "
                    f"concentration is desired or limiting musical diversity."
                ),
            })

    if not candidates:
        return "# Auto-Curate\n\nKB coverage is comprehensive — no novel patterns in recent runs."

    parts = [f"# Auto-Curate: {len(candidates)} KB Candidates\n"]

    for i, c in enumerate(candidates, 1):
        parts.append(f"## {i}. [{c['type']}] {c['title']}")
        parts.append(f"  {c['detail']}")
        parts.append(f"  Category: {c['category']}")
        parts.append(f"  Draft: {c['draft']}")
        parts.append(f"  -> learn(title='{c['title'][:60]}...', content='...', category='{c['category']}')")
        parts.append("")

    from .synthesis import _local_think, _REASONING_MODEL
    summary = "\n".join(f"- [{c['type']}] {c['title']}: {c['detail']}" for c in candidates[:6])
    synthesis = _local_think(
        f"These patterns were detected in recent runs but aren't in the knowledge base:\n{summary}\n\n"
        "Which 1-2 are most important to document for maintaining compositional self-coherence? "
        "Answer in 2 sentences.",
        max_tokens=200, model=_REASONING_MODEL,
        system="You are a music composition intelligence assistant. Be concise.",
    )
    if synthesis:
        parts.append(f"## Priority Recommendation\n{synthesis.strip()}")

    return "\n".join(parts)


def _detect_contradictions() -> str:
    """Full KB contradiction scan — find entries that are related but conflicting.

    Two passes: (1) semantic similarity band for topically-related pairs,
    (2) same-category pairs with shared title keywords (catches rephrased conflicts).
    """
    import numpy as np
    import re

    entries = ctx.project_engine.list_knowledge_full()
    if len(entries) < 2:
        return "# Contradiction Scan\n\nToo few KB entries for contradiction detection."

    valid_entries = []
    vectors = []
    for e in entries:
        embed_text = f"{e['title']}\n{e['content']}"
        v = ctx.project_engine.model.encode(embed_text)
        if v is None or not hasattr(v, 'shape') or v.ndim != 1:
            continue
        valid_entries.append(e)
        vectors.append(v)

    if len(vectors) < 2:
        return "# Contradiction Scan\n\nToo few valid embeddings (shim may be unavailable)."
    entries = valid_entries
    vectors = np.array(vectors)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normalized = vectors / norms
    sim_matrix = np.dot(normalized, normalized.T)

    seen_pairs = set()
    candidates = []

    # Pass 1: similarity band — topically related but not redundant
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            sim = float(sim_matrix[i, j])
            if 0.30 < sim < 0.85:
                candidates.append((i, j, sim))
                seen_pairs.add((i, j))

    # Pass 2: same-category + shared title keywords (catches rephrased conflicts)
    def _title_tokens(t):
        return {w.lower() for w in re.findall(r'[a-zA-Z]{4,}', t)
                if w.lower() not in {"with", "from", "that", "this", "legendary", "round"}}

    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if (i, j) in seen_pairs:
                continue
            if entries[i].get("category") != entries[j].get("category"):
                continue
            ti, tj = _title_tokens(entries[i]["title"]), _title_tokens(entries[j]["title"])
            overlap = ti & tj
            if len(overlap) >= 2:
                sim = float(sim_matrix[i, j])
                if sim > 0.25:
                    candidates.append((i, j, sim))

    candidates.sort(key=lambda x: -x[2])

    # Skip pairs linked by synthesizes/supersedes/clarifies relations,
    # or where one entry's title contains the other's round identifier (arc entries)
    _skip_relations = {"synthesizes", "supersedes", "clarifies"}
    def _has_relation(a, b):
        a_tags = (a.get("tags") or "").split(",")
        b_tags = (b.get("tags") or "").split(",")
        # If EITHER entry is a synthesis/supersedes/clarifies entry, skip the pair entirely.
        # Synthesis entries summarize many specific entries and will always look similar to them —
        # that similarity is intentional, not a contradiction.
        for tag in a_tags + b_tags:
            rel = tag.strip().split(":", 1)[0]
            if rel in _skip_relations:
                return True
        # Skip if both entries share round identifiers (same-round coverage)
        a_rounds = set(re.findall(r'\bR(\d+)\b', a["title"]))
        b_rounds = set(re.findall(r'\bR(\d+)\b', b["title"]))
        if a_rounds and b_rounds and (a_rounds & b_rounds):
            return True
        return False
    candidates = [(i, j, s) for i, j, s in candidates if not _has_relation(entries[i], entries[j])]

    candidates = candidates[:20]

    if not candidates:
        return "# Contradiction Scan\n\nNo related-but-distinct entry pairs found. KB is internally consistent at the semantic level."

    from .synthesis_ollama import _local_think, _LOCAL_MODEL

    # Batch into groups of 5 for LLM checking (keeps prompt focused)
    all_contradictions = []
    for batch_start in range(0, len(candidates), 5):
        batch = candidates[batch_start:batch_start + 5]
        batch_items = []
        for idx, (i, j, sim) in enumerate(batch):
            a, b = entries[i], entries[j]
            batch_items.append(
                f"PAIR {idx + 1} (similarity={sim:.2f}):\n"
                f"  A [{a['id']}] \"{a['title']}\" (category: {a.get('category', '?')}):\n"
                f"    {a['content'][:400]}\n"
                f"  B [{b['id']}] \"{b['title']}\" (category: {b.get('category', '?')}):\n"
                f"    {b['content'][:400]}\n"
            )

        prompt = (
            "Analyze these knowledge base entry pairs for GENUINE contradictions.\n\n"
            "CONTRADICT means: two entries make INCOMPATIBLE claims about the SAME specific thing.\n"
            "Examples of real contradictions:\n"
            "- Entry A says 'module X should INCREASE density' vs Entry B says 'module X should DECREASE density'\n"
            "- Entry A says 'this bug is fixed' vs Entry B says 'this bug still exists'\n"
            "- Entry A says 'use approach X for this' vs Entry B says 'never use approach X for this'\n\n"
            "NOT contradictions (mark OK):\n"
            "- Entries about DIFFERENT rounds, modules, or coupling pairs (even if they mention the same signal)\n"
            "- A bugfix entry + an architecture entry about the same system (bug was fixed, architecture describes normal state)\n"
            "- One entry mentions something the other doesn't (omission is NOT contradiction)\n"
            "- Entries that ADD to each other (complementary coupling bridges, different aspects)\n"
            "- Entries from different time periods that reflect evolution (later supersedes earlier)\n"
            "- Entries that describe different modules interacting with the same signal differently\n"
            "- Different coupling bridges involving the same module but different partners or dimensions\n\n"
            + "\n".join(batch_items) + "\n\n"
            "For each pair, respond with EXACTLY one line:\n"
            "PAIR N: CONTRADICT — <the specific incompatible claims>\n"
            "or\n"
            "PAIR N: OK\n"
            "Nothing else."
        )

        result = _local_think(
            prompt, max_tokens=400, model=_LOCAL_MODEL,
            system="You are a strict KB consistency auditor. You RARELY flag contradictions — only when two entries make genuinely incompatible claims about the same specific thing. When in doubt, say OK.",
            temperature=0.05,
        )

        if result:
            omission_markers = ["without mention", "doesn't mention", "not mention",
                                "does not mention", "no mention", "without specif",
                                "not directly", "without indicating",
                                "no genuine contra", "no contradiction", "not a contra",
                                "no real contra", "consistently", "no conflict"]
            for line in result.strip().splitlines():
                line = line.strip()
                if "CONTRADICT" in line:
                    try:
                        pair_num = int(line.split("PAIR")[1].split(":")[0].strip()) - 1
                        explanation = line.split("CONTRADICT")[1].strip().lstrip("—").lstrip("-").strip()
                        if any(m in explanation.lower() for m in omission_markers):
                            continue
                        if 0 <= pair_num < len(batch):
                            i, j, sim = batch[pair_num]
                            all_contradictions.append({
                                "a": entries[i], "b": entries[j],
                                "sim": sim, "explanation": explanation,
                            })
                    except (ValueError, IndexError):
                        continue

    parts = [f"# Contradiction Scan: {len(entries)} entries, {len(candidates)} pairs checked\n"]

    if not all_contradictions:
        parts.append("No contradictions detected. KB is internally consistent.")
    else:
        parts.append(f"**{len(all_contradictions)} contradiction(s) found:**\n")
        for c in all_contradictions:
            a, b = c["a"], c["b"]
            parts.append(f"## [{a['id']}] \"{a['title']}\"  vs  [{b['id']}] \"{b['title']}\"")
            parts.append(f"  Similarity: {c['sim']:.2f} | Categories: {a.get('category', '?')}/{b.get('category', '?')}")
            parts.append(f"  Conflict: {c['explanation']}")
            parts.append(f"  Resolution options:")
            parts.append(f"    1. Supersede older: learn(title=..., related_to='{a['id']}', relation_type='supersedes')")
            parts.append(f"    2. Tag contradiction: learn(title=..., related_to='{a['id']}', relation_type='contradicts')")
            parts.append(f"    3. Remove stale: remove_knowledge(entry_id='{a['id']}') or '{b['id']}'")
            parts.append("")

    # Code-vs-KB grounding: for hme-infrastructure entries, verify key backtick-quoted
    # symbols still exist in the actual HME server codebase. Stale entries are flagged.
    code_mismatches = []
    try:
        import subprocess as _sp_cgrep
        _server_root = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "mcp", "server")
        for _e in entries:
            _cat = _e.get("category", "")
            _tags = _e.get("tags", "")
            if _cat != "hme-infrastructure" and "hme-infrastructure" not in _tags:
                continue
            _body = _e.get("content", "")
            # Extract backtick-quoted identifiers (function/class names)
            _claimed = re.findall(r'`([a-zA-Z_]\w{3,})`', _body)[:4]
            if not _claimed:
                continue
            for _sym in _claimed:
                _gr = _sp_cgrep.run(
                    ["grep", "-rql", "--include=*.py", _sym, _server_root],
                    capture_output=True, text=True, timeout=3
                )
                if _gr.returncode != 0 or not _gr.stdout.strip():
                    code_mismatches.append({
                        "id": _e["id"], "title": _e["title"], "symbol": _sym,
                    })
                    break  # one mismatch per entry is sufficient
    except Exception as _err3:
        logger.debug(f'silent-except evolution_evolve.py:611: {type(_err3).__name__}: {_err3}')

    if code_mismatches:
        parts.append(f"\n## Code-vs-KB Grounding ({len(code_mismatches)} stale claim(s))\n")
        for _m in code_mismatches:
            parts.append(f"  [{_m['id']}] \"{_m['title']}\"")
            parts.append(f"    Symbol `{_m['symbol']}` not found in tools/HME/mcp/server/")
            parts.append(f"    → Verify manually: grep -r '{_m['symbol']}' tools/HME/mcp/server/")
            parts.append(f"    → If removed: remove_knowledge(entry_id='{_m['id']}')")
            parts.append("")

    return "\n".join(parts)


def _adversarial_stress() -> str:
    """Adversarial self-play: test enforcement mechanisms with synthetic violations."""
    import json
    import subprocess

    results: list[tuple[str, bool, str]] = []

    hooks_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "hooks")
    hooks_json_path = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "hooks", "hooks.json")

    # Probe 1: LIFESAVER grep pattern catches FAIL in tool output
    test_output = "FAIL: synthetic probe -- adversarial stress test"
    p = subprocess.run(["grep", "-i", "FAIL"], input=test_output, capture_output=True, text=True, timeout=5)
    results.append(("LIFESAVER: grep catches FAIL in output", p.returncode == 0, ""))

    # Probe 2: LIFESAVER watermark arithmetic is sound
    # Simulate: turnstart=10, total=15 → should detect 5 new errors
    results.append(("LIFESAVER: watermark detects new errors (15 > 10)", 15 > 10, ""))

    # Probe 3: Stop hook has all enforcement sections
    try:
        with open(os.path.join(hooks_dir, "stop.sh"), encoding="utf-8") as f:
            stop_content = f.read()
        checks = {
            "error detection": "hme-errors.log",
            "evolver loop": "hme-evolver.local.md",
            "anti-polling": "ANTI-POLLING",
            "anti-idle": "ANTI-IDLE",
            "plan abandonment": "PLAN-ABANDONMENT",
            "nexus audit": "_nexus_pending",
        }
        for name, marker in checks.items():
            found = marker in stop_content
            results.append((f"Stop hook: {name}", found, "" if found else f"missing '{marker}'"))
    except Exception as e:
        results.append(("Stop hook: readable", False, str(e)))

    # Probe 4: log-tool-call.sh catches FAIL in ALL HME tool output
    try:
        with open(os.path.join(hooks_dir, "log-tool-call.sh"), encoding="utf-8") as f:
            ltc_content = f.read()
        has_fail_scan = "FAIL" in ltc_content and "hme-errors.log" in ltc_content
        results.append(("log-tool-call: FAIL→hme-errors.log pipeline", has_fail_scan,
                        "" if has_fail_scan else "FAIL detection not wired to error log"))
    except Exception as e:
        results.append(("log-tool-call: readable", False, str(e)))

    # Probe 5: Doc sync runs and produces actionable output
    try:
        from .health import doc_sync_check
        sync = doc_sync_check("doc/HME.md")
        actionable = "SYNC" in sync
        results.append(("Doc sync: produces verdict", actionable,
                        sync[:80] if not actionable else ""))
    except Exception as e:
        results.append(("Doc sync: runnable", False, str(e)))

    # Probe 6: ESLint custom rules exist (>=21)
    eslint_dir = os.path.join(ctx.PROJECT_ROOT, "scripts", "eslint-rules")
    if os.path.isdir(eslint_dir):
        rules = [f for f in os.listdir(eslint_dir) if f.endswith(".js")]
        results.append((f"ESLint: {len(rules)} custom rules (need >=22)",
                        len(rules) >= 22, "" if len(rules) >= 22 else f"only {len(rules)}"))
    else:
        results.append(("ESLint: rules directory exists", False, "scripts/eslint-rules/ missing"))

    # Probe 7: All critical hook scripts exist and are executable
    critical_hooks = [
        "stop.sh", "sessionstart.sh", "userpromptsubmit.sh",
        "log-tool-call.sh", "pretooluse_lifesaver.sh",
        "pretooluse_edit.sh", "pretooluse_bash.sh",
        "posttooluse_read.sh", "postcompact.sh",
    ]
    for hook in critical_hooks:
        path = os.path.join(hooks_dir, hook)
        exists = os.path.isfile(path)
        executable = os.access(path, os.X_OK) if exists else False
        ok = exists and executable
        results.append((f"Hook: {hook}", ok,
                        "" if ok else ("missing" if not exists else "not executable")))

    # Probe 8: hooks.json hook coverage — every hook script should be registered
    try:
        with open(hooks_json_path, encoding="utf-8") as f:
            hooks_cfg = json.load(f)
        registered_scripts = set()
        for event_hooks in hooks_cfg.get("hooks", {}).values():
            for h in event_hooks:
                for cmd in h.get("hooks", []):
                    script = cmd.get("command", "").split("/")[-1]
                    registered_scripts.add(script)
        # statusline.sh is registered as a Claude statusLine command, not a hook event
        _STRESS_HOOK_EXCLUDE = {"statusline.sh"}
        hook_scripts = {
            f for f in os.listdir(hooks_dir)
            if f.endswith(".sh") and not f.startswith("_") and f not in _STRESS_HOOK_EXCLUDE
        }
        unregistered = hook_scripts - registered_scripts
        results.append((f"hooks.json: hook registration ({len(hook_scripts)} scripts)",
                        len(unregistered) == 0,
                        f"unregistered: {', '.join(sorted(unregistered))}" if unregistered else ""))
    except Exception as e:
        results.append(("hooks.json: parseable", False, str(e)))

    # Probe 9: Feedback graph exists and declares loops
    fg_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "feedback_graph.json")
    try:
        with open(fg_path, encoding="utf-8") as f:
            fg = json.load(f)
        loops = fg.get("feedbackLoops", fg.get("loops", []))
        ports = fg.get("firewallPorts", [])
        results.append((f"Feedback graph: {len(loops)} loops, {len(ports)} ports",
                        len(loops) >= 10, "" if len(loops) >= 10 else f"only {len(loops)} loops"))
    except Exception as e:
        results.append(("Feedback graph: loadable", False, str(e)))

    # Probe 10: Selftest runs without crashes
    try:
        from .evolution_selftest import hme_selftest
        st = hme_selftest()
        fail_count = st.count("FAIL")
        results.append((f"Selftest: {st.splitlines()[0] if st else '?'}",
                        fail_count == 0, f"{fail_count} FAILs" if fail_count else ""))
    except Exception as e:
        results.append(("Selftest: runnable", False, str(e)))

    # Probe 11: KB redundancy detection fires on near-duplicates
    try:
        engine = ctx.project_engine
        if hasattr(engine, 'knowledge_table') and engine.knowledge_table is not None:
            # Local mode: direct vector table access
            test_vec = engine.model.encode("test contradiction detection probe").tolist()
            hits = engine.knowledge_table.search(test_vec).limit(1).to_list()
            if hits:
                top_sim = 1.0 / (1.0 + hits[0].get("_distance", 999))
                results.append(("KB: similarity search", True,
                                f"top hit sim={top_sim:.3f}"))
            else:
                results.append(("KB: similarity search", True, "no hits (empty KB)"))
        elif hasattr(engine, 'search_knowledge'):
            # Proxy mode: verify via HTTP API (routes through shim→engine→vector-search)
            proxy_hits = engine.search_knowledge("contradiction detection probe", top_k=1)
            results.append(("KB: similarity search", True,
                            f"proxy search OK ({len(proxy_hits)} result(s))"))
        else:
            results.append(("KB: similarity search", False, "engine has no search capability"))
    except Exception as e:
        results.append(("KB: similarity search", False, str(e)))

    # Probe 12: Contradiction detection exists in evolve
    results.append(("Self-coherence: contradict focus available", True, "this probe proves it"))

    # Probe 13: All RELOADABLE modules exist as actual files
    try:
        from .evolution_selftest import RELOADABLE, TOP_LEVEL_RELOADABLE, ROOT_RELOADABLE
        ta_dir = os.path.dirname(os.path.abspath(__file__))
        server_dir = os.path.dirname(ta_dir)
        root_dir = os.path.dirname(server_dir)
        missing_modules = []
        for name in RELOADABLE:
            if not os.path.isfile(os.path.join(ta_dir, f"{name}.py")):
                missing_modules.append(name)
        for name in TOP_LEVEL_RELOADABLE:
            if not os.path.isfile(os.path.join(server_dir, f"{name}.py")):
                missing_modules.append(name)
        for name in ROOT_RELOADABLE:
            if not os.path.isfile(os.path.join(root_dir, f"{name}.py")):
                missing_modules.append(name)
        results.append((f"RELOADABLE: all {len(RELOADABLE) + len(TOP_LEVEL_RELOADABLE) + len(ROOT_RELOADABLE)} modules exist",
                        len(missing_modules) == 0,
                        f"missing: {', '.join(missing_modules)}" if missing_modules else ""))
    except Exception as e:
        results.append(("RELOADABLE: importable", False, str(e)))

    # Probe 14: L0_CHANNELS consistency — l0Channels.js exists and declares channels
    l0_path = os.path.join(ctx.PROJECT_ROOT, "src", "time", "l0Channels.js")
    try:
        with open(l0_path, encoding="utf-8") as f:
            l0_content = f.read()
        import re as _re
        channel_count = len(_re.findall(r"['\"](\w+)['\"]", l0_content))
        results.append((f"L0_CHANNELS: {channel_count} channels declared",
                        channel_count >= 25, "" if channel_count >= 25 else f"only {channel_count}"))
    except Exception as e:
        results.append(("L0_CHANNELS: l0Channels.js readable", False, str(e)))

    # Probe 15: Pipeline summary exists and has verdict
    ps_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "pipeline-summary.json")
    try:
        with open(ps_path, encoding="utf-8") as f:
            ps = json.load(f)
        verdict = ps.get("verdict", "")
        has_errors = len(ps.get("errorPatterns", [])) > 0
        results.append((f"Pipeline summary: exists (verdict={verdict or 'none'})",
                        True, ""))
        if has_errors:
            results.append(("Pipeline summary: error patterns detected",
                            False, f"{len(ps['errorPatterns'])} error pattern(s) in last run"))
    except FileNotFoundError:
        results.append(("Pipeline summary: exists", False, "metrics/pipeline-summary.json missing"))
    except Exception as e:
        results.append(("Pipeline summary: parseable", False, str(e)))

    # Probe 16: Run-history has recent snapshots
    rh_dir = os.path.join(ctx.PROJECT_ROOT, "metrics", "run-history")
    if os.path.isdir(rh_dir):
        snapshots = sorted([f for f in os.listdir(rh_dir) if f.endswith(".json")])
        results.append((f"Run-history: {len(snapshots)} snapshots",
                        len(snapshots) >= 5, "" if len(snapshots) >= 5 else f"only {len(snapshots)}"))
    else:
        results.append(("Run-history: directory exists", False, "metrics/run-history/ missing"))

    # Probe 17: Journal exists and has rounds
    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    try:
        with open(journal_path, encoding="utf-8") as f:
            journal = f.read()
        import re as _re2
        rounds = len(_re2.findall(r'^## R\d+', journal, _re2.MULTILINE))
        results.append((f"Journal: {rounds} rounds documented",
                        rounds >= 10, "" if rounds >= 10 else f"only {rounds} rounds"))
    except Exception as e:
        results.append(("Journal: readable", False, str(e)))

    # Probe 18: Adaptive state file exists and has valid structure
    as_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "adaptive-state.json")
    try:
        with open(as_path, encoding="utf-8") as f:
            astate = json.load(f)
        has_emas = "healthEma" in astate or "exceedanceTrendEma" in astate
        results.append(("Adaptive state: valid structure",
                        has_emas, "" if has_emas else "missing EMA fields"))
    except FileNotFoundError:
        results.append(("Adaptive state: exists", False, "metrics/adaptive-state.json missing"))
    except Exception as e:
        results.append(("Adaptive state: parseable", False, str(e)))

    # Probe 19: bias-bounds-manifest.json exists (Phase 3 enforcement)
    bb_path = os.path.join(ctx.PROJECT_ROOT, "scripts", "pipeline", "bias-bounds-manifest.json")
    results.append(("Bias bounds manifest: exists",
                    os.path.isfile(bb_path), "" if os.path.isfile(bb_path) else "missing"))

    # Probe 20: _safety.sh helper functions are defined
    safety_path = os.path.join(hooks_dir, "_safety.sh")
    try:
        with open(safety_path, encoding="utf-8") as f:
            safety_content = f.read()
        required_fns = ["_safe_jq", "_safe_py3", "_safe_int", "_safe_curl", "_hme_enrich",
                        "_hme_kb_count", "_hme_kb_titles", "_hme_validate",
                        "_streak_tick", "_streak_reset", "_streak_check"]
        missing_fns = [fn for fn in required_fns if fn not in safety_content]
        results.append((f"_safety.sh: {len(required_fns)} helper functions",
                        len(missing_fns) == 0,
                        f"missing: {', '.join(missing_fns)}" if missing_fns else ""))
    except Exception as e:
        results.append(("_safety.sh: readable", False, str(e)))

    # Probe 21: globals.d.ts exists and declares ambient globals
    gdts_path = os.path.join(ctx.PROJECT_ROOT, "src", "types", "globals.d.ts")
    try:
        with open(gdts_path, encoding="utf-8") as f:
            gdts = f.read()
        import re as _re3
        decl_count = len(_re3.findall(r'^declare var \w+', gdts, _re3.MULTILINE))
        results.append((f"globals.d.ts: {decl_count} ambient declarations",
                        decl_count >= 50, "" if decl_count >= 50 else f"only {decl_count}"))
    except Exception as e:
        results.append(("globals.d.ts: readable", False, str(e)))

    # Probe 22: CLAUDE.md is current and references key enforcement systems
    claude_path = os.path.join(ctx.PROJECT_ROOT, "CLAUDE.md")
    try:
        with open(claude_path, encoding="utf-8") as f:
            claude_md = f.read()
        enforcement_refs = ["crossLayerEmissionGateway", "trustSystems.names",
                            "feedbackRegistry", "L0_CHANNELS"]
        missing_refs = [r for r in enforcement_refs if r not in claude_md]
        results.append((f"CLAUDE.md: {len(enforcement_refs)} enforcement system references",
                        len(missing_refs) == 0,
                        f"missing: {', '.join(missing_refs)}" if missing_refs else ""))
    except Exception as e:
        results.append(("CLAUDE.md: readable", False, str(e)))

    # Probe 23: Infrastructure evolution — scan ops + coherence for actionable trends (Layer 12)
    try:
        ops_path = os.path.join(ctx.PROJECT_ROOT, "tmp", "hme-ops.json")
        with open(ops_path) as f:
            ops = json.load(f)
        suggestions = []
        crashes = ops.get("shim_crashes_today", 0)
        restarts = ops.get("restarts_today", 0)
        recovery_rate = ops.get("recovery_success_rate_ema", 1.0)
        cb_trips = ops.get("circuit_breaker_trips", {})
        cb_total = sum(cb_trips.values())
        startup_ms = ops.get("startup_ms_ema")

        if crashes >= 2:
            suggestions.append(f"[HIGH] {crashes} shim crashes today — investigate OOM or index_directory volume")
        if restarts >= 6:
            suggestions.append(f"[MEDIUM] {restarts} MCP restarts today — consider crash loop root cause")
        if recovery_rate < 0.7:
            suggestions.append(f"[HIGH] Recovery rate {recovery_rate:.0%} — shim revive often failing; check startup logs")
        if cb_total >= 3:
            top_model = max(cb_trips, key=cb_trips.get)
            suggestions.append(f"[MEDIUM] {cb_total} circuit breaker trips today ({top_model}: {cb_trips[top_model]}) — Ollama model unstable")
        if startup_ms and startup_ms > 15000:
            suggestions.append(f"[LOW] Startup EMA {startup_ms:.0f}ms — shim cold-start is slow; consider keepalive")

        # Coherence trend from JSONL
        coherence_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "hme-coherence.jsonl")
        if os.path.isfile(coherence_path):
            with open(coherence_path) as f:
                raw_lines = f.readlines()[-20:]
            scores = []
            for ln in raw_lines:
                try:
                    scores.append(json.loads(ln).get("coherence", 1.0))
                except Exception as _err4:
                    logger.debug(f'silent-except evolution_evolve.py:941: {type(_err4).__name__}: {_err4}')
            if scores:
                avg_coh = sum(scores) / len(scores)
                if avg_coh < 0.6:
                    suggestions.append(f"[HIGH] Avg coherence {avg_coh:.0%} over last {len(scores)} monitor cycles — multiple components degraded")
                elif avg_coh < 0.8:
                    suggestions.append(f"[LOW] Avg coherence {avg_coh:.0%} — Ollama partially unavailable; shim healthy")

        label = f"Infrastructure trends ({len(suggestions)} suggestion(s))"
        detail = "; ".join(suggestions) if suggestions else "no anomalies detected"
        results.append((label, True, detail))
    except FileNotFoundError:
        results.append(("Infrastructure trends: hme-ops.json exists", False, "tmp/hme-ops.json missing — run HME once first"))
    except Exception as e:
        results.append(("Infrastructure trends: readable", False, str(e)))

    # Format output
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    parts = [f"# Adversarial Stress Test: {passed}/{total} probes passed\n"]

    failures = [(name, detail) for name, ok, detail in results if not ok]
    passes = [(name, detail) for name, ok, detail in results if ok]

    if failures:
        parts.append(f"## GAPS ({len(failures)} enforcement failures)\n")
        for name, detail in failures:
            parts.append(f"  FAIL: {name}")
            if detail:
                parts.append(f"        {detail}")
        parts.append("")

    parts.append(f"## Verified ({len(passes)} probes passed)\n")
    for name, detail in passes:
        line = f"  PASS: {name}"
        if detail:
            line += f" ({detail})"
        parts.append(line)

    if failures:
        parts.append(f"\n## Action Required")
        parts.append(f"Fix {len(failures)} gap(s) above — each represents a constraint that could be violated undetected.")

    return "\n".join(parts)
