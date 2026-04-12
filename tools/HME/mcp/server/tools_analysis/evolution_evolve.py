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
    antagonist bridges with executable monkey-patch code, ready to test."""
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
