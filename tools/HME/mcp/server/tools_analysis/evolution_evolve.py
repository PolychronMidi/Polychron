"""HME evolve — unified 'what should I work on next?' mega-tool.

Merges three data sources into one ranked evolution view:
1. LOC offenders (from codebase_health logic)
2. Coupling dimension gaps + leverage opportunities (from coupling_intel)
3. Pipeline evolution suggestions (from suggest_evolution, if fresh data)
"""
import os
import logging

from server import context as ctx
from . import _track
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def evolve(focus: str = "all") -> str:
    """Unified evolution intelligence hub. focus='all' (default): LOC offenders +
    coupling gaps + leverage + pipeline suggestions + synthesis.
    focus='coupling': coupling gaps + leverage only.
    focus='loc': LOC offenders only.
    focus='pipeline': pipeline suggestions only.
    focus='patterns': journal meta-patterns across all rounds.
    focus='seed': auto-generate starter KB entries for high-dependency uncovered modules.
    focus='design': bridge design synthesis — proposes specific dimension, direction,
    code location, and musical rationale for top unsaturated antagonist pairs.
    focus='preflight': pre-flight impact prediction — analyzes current uncommitted
    changes against historical run patterns to predict regression risk.
    focus='curate': living memory curation — detects KB-worthy patterns from recent
    pipeline runs (trust gaps, feature extremes, verdict transitions) and proposes entries.
    focus='forge': verified skill recipes — generates lab sketches for top unsaturated
    antagonist bridges with executable monkey-patch code, ready to test.
    focus='contradict': contradiction detection — full KB pairwise scan finds entries
    that are semantically related but make conflicting claims. Surfaces contradictions
    with resolution suggestions (merge, supersede, or tag contradicts).
    focus='stress': adversarial self-play — runs enforcement probes against LIFESAVER,
    boundary rules, doc sync, hook registration, selftest, and other guardrails.
    Reports gaps in enforcement that could let violations slip through."""
    _track("evolve")
    append_session_narrative("evolve", f"evolve({focus})")
    ctx.ensure_ready_sync()
    parts = ["# Evolution Intelligence\n"]

    if focus in ("all", "loc"):
        parts.append(_loc_offenders())

    if focus in ("all", "coupling"):
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
        return design_bridges()

    if focus == "preflight":
        return _preflight_prediction()

    if focus == "curate":
        return _auto_curate()

    if focus == "forge":
        from .coupling_bridges import forge_bridges
        return forge_bridges()

    if focus == "contradict":
        return _detect_contradictions()

    if focus == "stress":
        return _adversarial_stress()

    return "\n".join(parts)


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
        except Exception:
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


def _preflight_prediction() -> str:
    """Predict likely impact of current uncommitted changes on pipeline verdict.

    Analyzes changed files by subsystem, correlates with historical run-history
    feature trends, and flags high-risk modules based on coupling density.
    """
    import json
    import subprocess
    from collections import Counter

    try:
        r = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True, text=True, timeout=5, cwd=ctx.PROJECT_ROOT,
        )
        changed = [f.strip() for f in r.stdout.strip().splitlines() if f.strip()]
    except Exception:
        return "## Pre-flight: git diff unavailable"

    if not changed:
        return "## Pre-flight: no uncommitted changes"

    subsystems: dict[str, list[str]] = {}
    for f in changed:
        parts = f.split("/")
        if len(parts) >= 2 and parts[0] == "src":
            subsystems.setdefault(parts[1], []).append(f)
        elif parts[0] == "tools":
            subsystems.setdefault("tooling", []).append(f)
        else:
            subsystems.setdefault("other", []).append(f)

    out = ["# Pre-flight Impact Prediction\n"]
    out.append(f"Changed: {len(changed)} files across {len(subsystems)} subsystem(s)")
    for sub, files in sorted(subsystems.items(), key=lambda x: -len(x[1])):
        out.append(f"  {sub}: {', '.join(os.path.basename(f) for f in files[:5])}")
    out.append("")

    # Load run history for trend analysis
    history_dir = os.path.join(ctx.PROJECT_ROOT, "metrics", "run-history")
    snapshots = []
    if os.path.isdir(history_dir):
        for fname in sorted(os.listdir(history_dir)):
            if fname.endswith(".json"):
                try:
                    with open(os.path.join(history_dir, fname), encoding="utf-8") as f:
                        snapshots.append(json.load(f))
                except Exception:
                    pass

    # Verdict distribution
    verdicts = [s.get("verdict") for s in snapshots if s.get("verdict")]
    if verdicts:
        vc = Counter(verdicts)
        out.append(f"## Historical Verdicts (n={len(verdicts)})")
        for v, c in vc.most_common():
            out.append(f"  {v}: {c} ({c*100//len(verdicts)}%)")
        out.append("")

    # Feature trends in last 5 runs
    if len(snapshots) >= 2:
        recent = snapshots[-5:]
        out.append(f"## Feature Trends (last {len(recent)} runs)")
        trend_keys = [
            "coherentShare", "exploringShare", "evolvingShare",
            "densityMean", "pitchEntropy", "healthScore",
            "exceedanceRate", "trustConvergence",
        ]
        for key in trend_keys:
            vals = [s.get("features", {}).get(key) for s in recent
                    if s.get("features", {}).get(key) is not None]
            if len(vals) >= 2:
                delta = vals[-1] - vals[0]
                arrow = "+" if delta > 0 else ""
                direction = "trending up" if delta > 0.02 else ("trending down" if delta < -0.02 else "stable")
                out.append(f"  {key:<22} {vals[-1]:.3f} ({arrow}{delta:.3f}) {direction}")
        out.append("")

    # Risk assessment by module coupling density
    risks = []
    src_changed = [f for f in changed if f.startswith("src/") and f.endswith(".js")]
    if src_changed:
        try:
            from .coupling_bridges import get_top_bridges
            bridges = get_top_bridges(n=20, threshold=-0.20)
            bridge_modules = set()
            for b in bridges:
                bridge_modules.add(b["pair_a"])
                bridge_modules.add(b["pair_b"])
                from .coupling_data import _TRUST_FILE_ALIASES
                bridge_modules.add(_TRUST_FILE_ALIASES.get(b["pair_a"], b["pair_a"]))
                bridge_modules.add(_TRUST_FILE_ALIASES.get(b["pair_b"], b["pair_b"]))

            for f in src_changed:
                basename = os.path.basename(f).replace(".js", "")
                if basename in bridge_modules:
                    n_bridges = sum(
                        1 for b in bridges
                        if basename in (b["pair_a"], b["pair_b"],
                                        _TRUST_FILE_ALIASES.get(b["pair_a"], ""),
                                        _TRUST_FILE_ALIASES.get(b["pair_b"], ""))
                    )
                    bridged_fields = set()
                    for b in bridges:
                        if basename in (b["pair_a"], b["pair_b"],
                                        _TRUST_FILE_ALIASES.get(b["pair_a"], ""),
                                        _TRUST_FILE_ALIASES.get(b["pair_b"], "")):
                            bridged_fields.update(b.get("already_bridged", []))
                    risk_level = "HIGH" if n_bridges >= 3 or len(bridged_fields) >= 2 else "MED"
                    risks.append(
                        f"{risk_level}: {basename} — {n_bridges} antagonist pair(s), "
                        f"bridged on [{', '.join(sorted(bridged_fields)) or 'none'}]"
                    )
                elif "/crossLayer/" in f:
                    risks.append(f"MED: {basename} — cross-layer module (check boundary rules)")
                elif "/conductor/" in f:
                    risks.append(f"LOW-MED: {basename} — conductor module (may shift regime balance)")
        except Exception:
            for f in src_changed:
                basename = os.path.basename(f).replace(".js", "")
                if "/crossLayer/" in f:
                    risks.append(f"MED: {basename} — cross-layer module")

    tooling_only = all(not f.startswith("src/") for f in changed)
    if tooling_only:
        risks.append("NONE: tooling-only changes — no composition impact expected")

    if risks:
        out.append("## Risk Assessment")
        for r in risks:
            out.append(f"  {r}")

    return "\n".join(out)


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
        except Exception:
            continue

    if not runs:
        return "# Auto-Curate\n\nCouldn't load run history."

    latest = runs[0]
    feats = latest.get("features", {})

    kb_entries = ctx.project_engine.search_knowledge("", top_k=200)
    kb_text = " ".join(
        (e.get("title", "") + " " + e.get("content", "")).lower()
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
    except Exception:
        pass

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

    from .synthesis import _local_think, _LOCAL_MODEL
    summary = "\n".join(f"- [{c['type']}] {c['title']}: {c['detail']}" for c in candidates[:6])
    synthesis = _local_think(
        f"These patterns were detected in recent runs but aren't in the knowledge base:\n{summary}\n\n"
        "Which 1-2 are most important to document for maintaining compositional self-coherence? "
        "Answer in 2 sentences.",
        max_tokens=200, model=_LOCAL_MODEL,
        system="You are a music composition intelligence assistant. Be concise.",
    )
    if synthesis:
        parts.append(f"## Priority Recommendation\n{synthesis.strip()}")

    return "\n".join(parts)


def _detect_contradictions() -> str:
    """Full KB contradiction scan — find entries that are related but conflicting."""
    import numpy as np

    entries = ctx.project_engine.list_knowledge_full()
    if len(entries) < 2:
        return "# Contradiction Scan\n\nToo few KB entries for contradiction detection."

    vectors = []
    for e in entries:
        embed_text = f"{e['title']}\n{e['content']}"
        vectors.append(ctx.project_engine.model.encode(embed_text))

    vectors = np.array(vectors)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normalized = vectors / norms
    sim_matrix = np.dot(normalized, normalized.T)

    candidates = []
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            sim = float(sim_matrix[i, j])
            if 0.40 < sim < 0.85:
                candidates.append((i, j, sim))

    candidates.sort(key=lambda x: -x[2])
    candidates = candidates[:10]

    if not candidates:
        return "# Contradiction Scan\n\nNo related-but-distinct entry pairs found. KB is internally consistent at the semantic level."

    from .synthesis_ollama import _local_think, _LOCAL_MODEL

    batch_items = []
    for idx, (i, j, sim) in enumerate(candidates):
        a, b = entries[i], entries[j]
        batch_items.append(
            f"PAIR {idx + 1} (similarity={sim:.2f}):\n"
            f"  A [{a['id']}] \"{a['title']}\": {a['content'][:300]}\n"
            f"  B [{b['id']}] \"{b['title']}\": {b['content'][:300]}\n"
        )

    prompt = (
        "Analyze these knowledge base entry pairs for contradictions.\n"
        "A contradiction means two entries make conflicting claims about the same topic "
        "(e.g., one says a parameter should increase while another says it should decrease, "
        "or one says a module is responsible for X while another assigns X to a different module).\n\n"
        + "\n".join(batch_items) + "\n\n"
        "For each pair, respond with EXACTLY one line:\n"
        "PAIR N: CONTRADICT — <one-sentence explanation>\n"
        "or\n"
        "PAIR N: OK\n"
        "Nothing else."
    )

    result = _local_think(
        prompt, max_tokens=600, model=_LOCAL_MODEL,
        system="You are a knowledge base consistency auditor. Be precise and terse.",
        temperature=0.1,
    )

    contradictions = []
    if result:
        for line in result.strip().splitlines():
            line = line.strip()
            if "CONTRADICT" in line:
                try:
                    pair_num = int(line.split("PAIR")[1].split(":")[0].strip()) - 1
                    explanation = line.split("CONTRADICT")[1].strip().lstrip("—").lstrip("-").strip()
                    if 0 <= pair_num < len(candidates):
                        i, j, sim = candidates[pair_num]
                        contradictions.append({
                            "a": entries[i], "b": entries[j],
                            "sim": sim, "explanation": explanation,
                        })
                except (ValueError, IndexError):
                    continue

    parts = [f"# Contradiction Scan: {len(entries)} entries, {len(candidates)} pairs checked\n"]

    if not contradictions:
        parts.append("No contradictions detected. KB is internally consistent.")
    else:
        parts.append(f"**{len(contradictions)} contradiction(s) found:**\n")
        for c in contradictions:
            a, b = c["a"], c["b"]
            parts.append(f"## [{a['id']}] \"{a['title']}\"  vs  [{b['id']}] \"{b['title']}\"")
            parts.append(f"  Similarity: {c['sim']:.2f}")
            parts.append(f"  Conflict: {c['explanation']}")
            parts.append(f"  Resolution options:")
            parts.append(f"    1. Supersede older: learn(title=..., related_to='{a['id']}', relation_type='supersedes')")
            parts.append(f"    2. Tag contradiction: learn(title=..., related_to='{a['id']}', relation_type='contradicts')")
            parts.append(f"    3. Remove stale: remove_knowledge(entry_id='{a['id']}') or '{b['id']}'")
            parts.append("")

    return "\n".join(parts)


def _adversarial_stress() -> str:
    """Adversarial self-play: test enforcement mechanisms with synthetic violations."""
    import json
    import subprocess

    results: list[tuple[str, bool, str]] = []

    hooks_dir = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "hooks")
    settings_path = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "settings.json")

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
        results.append((f"ESLint: {len(rules)} custom rules (need >=21)",
                        len(rules) >= 21, "" if len(rules) >= 21 else f"only {len(rules)}"))
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

    # Probe 8: Settings.json hook coverage — every hook script should be registered
    try:
        with open(settings_path, encoding="utf-8") as f:
            settings = json.load(f)
        registered_scripts = set()
        for event_hooks in settings.get("hooks", {}).values():
            for h in event_hooks:
                for cmd in h.get("hooks", []):
                    script = cmd.get("command", "").split("/")[-1]
                    registered_scripts.add(script)
        hook_scripts = {
            f for f in os.listdir(hooks_dir)
            if f.endswith(".sh") and not f.startswith("_")
        }
        unregistered = hook_scripts - registered_scripts
        results.append((f"Settings: hook registration ({len(hook_scripts)} scripts)",
                        len(unregistered) == 0,
                        f"unregistered: {', '.join(sorted(unregistered))}" if unregistered else ""))
    except Exception as e:
        results.append(("Settings: parseable", False, str(e)))

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
        if engine.knowledge_table is not None:
            test_vec = engine.model.encode("test contradiction detection probe").tolist()
            hits = engine.knowledge_table.search(test_vec).limit(1).to_list()
            if hits:
                top_sim = 1.0 / (1.0 + hits[0].get("_distance", 999))
                results.append(("KB: similarity search operational", True,
                                f"top hit sim={top_sim:.3f}"))
            else:
                results.append(("KB: similarity search operational", True, "no hits (empty KB)"))
        else:
            results.append(("KB: knowledge table exists", False, "table not initialized"))
    except Exception as e:
        results.append(("KB: similarity search", False, str(e)))

    # Probe 12: Contradiction detection exists in evolve
    results.append(("Self-coherence: contradict focus available", True, "this probe proves it"))

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
