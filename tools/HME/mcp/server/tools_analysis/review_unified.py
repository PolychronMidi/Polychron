"""HME review — unified post-pipeline analysis tool.

Merges pipeline_digest, regime_report, trust_report, section_compare,
and audio_analyze into one tool with mode routing.
"""
import logging

from server import context as ctx
from . import _track, _budget_gate, _budget_section, BUDGET_COMPOUND, BUDGET_SECTION, BUDGET_TOOL
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def review(mode: str = "digest", section_a: int = -1, section_b: int = -1,
           system_a: str = "", system_b: str = "", changed_files: str = "",
           file_path: str = "", critique: bool = False) -> str:
    """Unified review hub. mode='digest' (default): pipeline_digest + evolution suggestions.
    mode='regime': regime distribution + transition analysis.
    mode='trust': trust ecology (system_a/system_b for rivalry mode).
    mode='sections': compare two sections (section_a, section_b required).
    mode='audio': perceptual audio analysis.
    mode='composition': section arc + drama + hotspot leaderboard.
    mode='health': codebase health sweep (LOC, boundary violations, conventions).
    mode='forget': what_did_i_forget check (changed_files='file1.js,file2.js').
    mode='convention': convention check for a specific file (file_path required).
    mode='symbols': symbol audit (dead code + importance).
    mode='docs': doc sync check.
    mode='evolve': unified evolution recommender (dead-ends + bypasses + gaps + bridges + trust).
    mode='full': digest + regime + trust in one call."""
    _track("review")
    if mode != "forget":
        append_session_narrative("review", f"{mode}: {changed_files[:60] or file_path[:60] or 'full'}")
    ctx.ensure_ready_sync()
    parts = []

    modes = [mode] if mode != "full" else ["digest", "regime", "trust"]

    for m in modes:
        if m == "digest":
            from .digest import pipeline_digest as _pd
            try:
                result = _pd(evolve=True, critique=critique)
            except Exception as e:
                result = f"pipeline_digest error: {e}"
            # In 'full' mode, truncate verbose blocking messages to a single line
            if mode == "full" and ("BLOCKED" in result or "STOP POLLING" in result or "IN PROGRESS" in result):
                parts.append("pipeline_digest: pipeline is still running — cannot digest partial results.")
            else:
                parts.append(result)
            continue
        elif m == "regime":
            from .section_compare import regime_report as _rr
            parts.append(_rr())
        elif m == "trust":
            from .trust_analysis import trust_report as _tr
            parts.append(_tr(system_a=system_a, system_b=system_b))
        elif m == "sections":
            if section_a < 0 or section_b < 0:
                parts.append("Error: sections mode requires section_a and section_b (0-indexed).")
            else:
                from .section_compare import section_compare as _sc
                parts.append(_sc(section_a, section_b))
        elif m == "audio":
            from .perceptual import audio_analyze as _aa
            parts.append(_aa())
        elif m == "composition":
            from .composition import composition_events as _ce
            parts.append(_ce(mode="full"))
        elif m == "health":
            from .health import codebase_health as _ch
            parts.append(_ch())
        elif m == "forget":
            _cf = changed_files
            if not _cf:
                try:
                    import subprocess as _sp
                    _git = _sp.run(
                        ["git", "-C", ctx.PROJECT_ROOT, "diff", "--name-only", "HEAD"],
                        capture_output=True, text=True, timeout=5
                    )
                    _cf = ",".join(f.strip() for f in _git.stdout.strip().splitlines() if f.strip())
                except Exception:
                    pass
            # Hard 10s wall cap — thread wrapper at MCP entry point.
            # Cannot be bypassed by stale imports or downstream blocking.
            import threading as _forget_t
            _forget_box = [None]
            def _run_forget():
                try:
                    from .workflow_audit import what_did_i_forget as _wdif
                    _forget_box[0] = _wdif(_cf or "")
                except Exception as _fe:
                    _forget_box[0] = f"what_did_i_forget error: {_fe}"
            _ft = _forget_t.Thread(target=_run_forget, daemon=True)
            _ft.start()
            _ft.join(timeout=10)
            if _ft.is_alive():
                parts.append("## Post-Change Audit\nAdaptive synthesis timed out (10s cap). Static analysis skipped to protect MCP connection.\nRe-run with fewer files or use `evolve(focus='think', query='...')` for deep analysis.")
            else:
                parts.append(_forget_box[0] or "No audit data.")
        elif m == "convention":
            if not file_path:
                parts.append("Error: convention mode requires file_path.")
            else:
                from .health import convention_check as _cc
                parts.append(_cc(file_path))
        elif m == "symbols":
            from .health import symbol_audit as _sa
            parts.append(_sa())
        elif m == "docs":
            from .health import doc_sync_check as _ds
            parts.append(_ds())
        elif m == "evolve":
            parts.append(_unified_evolution_recommender())
        else:
            parts.append(f"Unknown mode '{m}'. Use: digest, regime, trust, sections, audio, composition, health, forget, convention, symbols, docs, evolve, full.")

    # Apply per-section budgets for compound modes, single budget otherwise
    if len(parts) > 1:
        parts = [_budget_section(p, BUDGET_SECTION) for p in parts]
    result = "\n\n---\n\n".join(parts) if len(parts) > 1 else parts[0] if parts else "No data."

    # Auto-draft KB entry after digest with run delta
    if "digest" in modes and "Run Delta" in result and "ALL CLEAR" in result:
        result += ("\n\n## Quick KB Draft\n"
                   "  Pipeline STABLE + regime health ALL CLEAR. Save round with:\n"
                   "  learn(title='RXX: ...describe evolutions...', content='...run delta + what changed...', "
                   "category='pattern', listening_notes='...')")

    budget = BUDGET_COMPOUND if mode == "full" else BUDGET_TOOL
    return _budget_gate(result, budget=budget)


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
    except Exception:
        pass

    # 2. Cascade bypass detection (direct callers >> L0 consumers)
    try:
        from .coupling_channels import _count_direct_callers
        for ch, data in topo.items():
            prods = data.get("producers", [])
            cons = data.get("consumers", [])
            for prod in prods:
                direct = _count_direct_callers(prod)
                l0_count = len(cons)
                if direct > l0_count * 2 and l0_count > 0:
                    bypass_ratio = direct / max(l0_count, 1)
                    recommendations.append({
                        "priority": 8.0 + min(bypass_ratio, 5.0),
                        "type": "bypass",
                        "title": f"Route {prod} callers through L0 '{ch}'",
                        "detail": f"{direct} direct callers vs {l0_count} L0 consumers — {direct - l0_count} bypass L0.",
                    })
    except Exception:
        pass

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
    except Exception:
        pass

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
    except Exception:
        pass

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
                        "detail": "Consistently underperforming — may need outcome scoring recalibration.",
                    })
    except Exception:
        pass

    # Sort by priority descending and format
    recommendations.sort(key=lambda r: -r["priority"])

    if not recommendations:
        out.append("No evolution opportunities detected. System is fully wired.")
        return "\n".join(out)

    out.append(f"Found {len(recommendations)} evolution opportunities, ranked by impact:\n")
    for i, rec in enumerate(recommendations[:12], 1):
        icon = {"dead-end": "📡", "orphan": "👻", "bypass": "⚡", "dimension-gap": "🔲",
                "virgin-pair": "🌉", "low-trust": "📉"}.get(rec["type"], "•")
        out.append(f"**{i}. {icon} [{rec['type']}] {rec['title']}** (priority: {rec['priority']:.1f})")
        out.append(f"   {rec['detail']}")
        out.append("")

    return "\n".join(out)
