"""HME review -- unified post-pipeline analysis tool.

Merges pipeline_digest, regime_report, trust_report, section_compare,
and audio_analyze into one tool with mode routing.
"""
import logging

from server import context as ctx
from server.onboarding_chain import chained
from . import _track, _budget_gate, _budget_section, BUDGET_COMPOUND, BUDGET_SECTION, BUDGET_TOOL
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


# meta hidden=True: leading underscore says "internal helper", and the
@ctx.mcp.tool(meta={"hidden": True})
@chained("review")


def _unified_evolution_recommender() -> str:
    """Synthesize dimension gaps, antagonism leverage, cascade bottlenecks,
    signal dead-ends, and trust ecology into a single prioritized evolution plan."""
    import os
    out = ["# Unified Evolution Recommender\n"]
    recommendations = []

    # 1. Signal dead-ends and orphan channels
    try:
        from .coupling_channels import _scan_l0_topology
        src_root = os.path.join(ctx.PROJECT_ROOT, "src")
        topo = _scan_l0_topology(src_root)
        dead_ends = [(ch, d["producers"]) for ch, d in topo.items()
                     if d["producers"] and not d["consumers"]
                     and ch not in {"rest-sync", "section-quality", "binaural", "instrument", "note"}]
        orphans = [(ch, d["consumers"]) for ch, d in topo.items()
                   if d["consumers"] and not d["producers"]]
        for ch, prods in dead_ends:
            recommendations.append({
                "priority": 9.0,
                "type": "dead-end",
                "title": f"Wire consumers for '{ch}' channel",
                "detail": f"Posted by {', '.join(prods)} but never consumed. Adding consumers creates new coupling paths.",
            })
        for ch, cons in orphans:
            recommendations.append({
                "priority": 7.0,
                "type": "orphan",
                "title": f"Fix orphan channel '{ch}'",
                "detail": f"Read by {', '.join(cons)} but never posted. Stale read or missing producer.",
            })
    except Exception as _err5:
        logger.debug(f'silent-except review_unified.py:189: {type(_err5).__name__}: {_err5}')

    # 2. Cascade bypass detection (direct callers >> L0 consumers).
    try:
        import re as _re_bulk
        all_prods: set = set()
        for _d in topo.values():
            for _p in _d.get("producers", []):
                all_prods.add(_p)
        direct_counts: dict = {p: 0 for p in all_prods}
        if all_prods:
            src_root = os.path.join(ctx.PROJECT_ROOT, "src")
            prod_patterns = {
                p: _re_bulk.compile(r'\b' + _re_bulk.escape(p) + r'\b')
                for p in all_prods
            }
            for dirpath, _, filenames in os.walk(src_root):
                for fname in filenames:
                    if not fname.endswith(".js") or fname == "index.js":
                        continue
                    stem = fname[:-3]
                    fpath = os.path.join(dirpath, fname)
                    try:
                        with open(fpath, encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                    except Exception as _exc:
                        # silent-ok: optional fallback path.
                        continue
                    for p, pat in prod_patterns.items():
                        if p == stem:
                            continue  # skip self-reference
                        if pat.search(content):
                            direct_counts[p] += 1
        for ch, data in topo.items():
            prods = data.get("producers", [])
            cons = data.get("consumers", [])
            for prod in prods:
                direct = direct_counts.get(prod, 0)
                l0_count = len(cons)
                if direct > l0_count * 2 and l0_count > 0:
                    bypass_ratio = direct / max(l0_count, 1)
                    recommendations.append({
                        "priority": 8.0 + min(bypass_ratio, 5.0),
                        "type": "bypass",
                        "title": f"Route {prod} callers through L0 '{ch}'",
                        "detail": f"{direct} direct callers vs {l0_count} L0 consumers -- {direct - l0_count} bypass L0.",
                    })
    except Exception as _err6:
        logger.debug(f'silent-except review_unified.py:209: {type(_err6).__name__}: {_err6}')

    # 3. Dimension gaps (underused coupling signals)
    try:
        from .coupling_bridges import dimension_gap_finder as _dgf
        gaps_text = _dgf()
        if gaps_text:
            # Extract the lowest-coverage dimension
            import re as _re_gap
            dims = _re_gap.findall(r'(\w+)\s+x\s*(\d+)', gaps_text)
            if dims:
                lowest = min(dims, key=lambda x: int(x[1]))
                recommendations.append({
                    "priority": 6.5,
                    "type": "dimension-gap",
                    "title": f"Expand '{lowest[0]}' coverage ({lowest[1]} consumers)",
                    "detail": f"Least-used coupling dimension. Adding consumers here creates new signal paths.",
                })
    except Exception as _err7:
        logger.debug(f'silent-except review_unified.py:228: {type(_err7).__name__}: {_err7}')

    # 4. Unexplored antagonist pairs (from leverage analysis KB history)
    try:
        from .coupling_bridges import get_top_bridges as _gtb
        bridges = _gtb(n=8, threshold=-0.20)
        for b in bridges:
            if not b.get("already_bridged"):
                recommendations.append({
                    "priority": 8.5,
                    "type": "virgin-pair",
                    "title": f"Bridge {b['pair_a']} <-> {b['pair_b']} (r={b['r']:.3f})",
                    "detail": f"Antagonist pair with 0 bridges. Field: {b['field']} ({b['eff_a']} / {b['eff_b']})",
                })
    except Exception as _err8:
        logger.debug(f'silent-except review_unified.py:243: {type(_err8).__name__}: {_err8}')

    # 5. Low-trust systems needing attention
    try:
        from .trust_analysis import trust_report as _tr_fn
        # Just check for bottom-tier systems
        from .coupling_data import _load_trust_scores
        trust_scores = _load_trust_scores()
        if trust_scores:
            bottom = sorted(trust_scores.items(), key=lambda x: x[1])[:3]
            for name, score in bottom:
                if score < 0.30:
                    recommendations.append({
                        "priority": 5.0,
                        "type": "low-trust",
                        "title": f"Investigate low-trust system '{name}' (score={score:.2f})",
                        "detail": "Consistently underperforming -- may need outcome scoring recalibration.",
                    })
    except Exception as _err9:
        logger.debug(f'silent-except review_unified.py:262: {type(_err9).__name__}: {_err9}')

    # Sort by priority descending and format
    recommendations.sort(key=lambda r: -r["priority"])

    if not recommendations:
        out.append("No evolution opportunities detected. System is fully wired.")
        return "\n".join(out)

    out.append(f"Found {len(recommendations)} evolution opportunities, ranked by impact:\n")
    for i, rec in enumerate(recommendations[:12], 1):
        icon = {"dead-end": "[ANT]", "orphan": "[GHOST]", "bypass": "[bolt]", "dimension-gap": "[BLOCK]",
                "virgin-pair": "[BRIDGE]", "low-trust": "[DOWN]"}.get(rec["type"], "*")
        out.append(f"**{i}. {icon} [{rec['type']}] {rec['title']}** (priority: {rec['priority']:.1f})")
        out.append(f"   {rec['detail']}")
        out.append("")

    return "\n".join(out)
