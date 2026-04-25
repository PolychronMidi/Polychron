"""HME review — unified post-pipeline analysis tool.

Merges pipeline_digest, regime_report, trust_report, section_compare,
and audio_analyze into one tool with mode routing.
"""
import logging

from server import context as ctx
from server.onboarding_chain import chained
from . import _track, _budget_gate, _budget_section, BUDGET_COMPOUND, BUDGET_SECTION, BUDGET_TOOL
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
@chained("review")
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
    # mode=full concatenates three subsections; emit explicit `# ` headers
    # before each so they don't blur together. Single-mode calls don't need
    # the header — the subsection's own output is the whole response.
    _HEADERS = {
        "digest": "# Pipeline Digest",
        "regime": "# Regime Timeline",
        "trust":  "# Trust Ecology",
    }

    for m in modes:
        if mode == "full" and m in _HEADERS:
            parts.append(f"\n{_HEADERS[m]}\n")
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
                parts.append(
                    "i/review mode=sections — compare two sections side-by-side.\n\n"
                    "Usage: i/review mode=sections section_a=<N> section_b=<M>\n"
                    "  section_a, section_b: 0-indexed section numbers to compare.\n\n"
                    "Example: i/review mode=sections section_a=0 section_b=3"
                )
            else:
                from .section_compare import section_compare as _sc
                parts.append(_sc(section_a, section_b))
        elif m == "audio":
            # Read the cached perceptual report (~0ms) instead of running
            # EnCodec+CLAP inference fresh (~12s warm, 2m cold). This is
            # the same path status mode=perceptual takes. Users wanting
            # live re-inference call `i/hme audio_analyze` directly.
            from .status_unified import _mode_perceptual
            parts.append(_mode_perceptual())
        elif m == "composition":
            from .composition import composition_events as _ce
            # drama_finder inside composition_events does a 60s LLM
            # "What the Listener Hears" call. Review is a snapshot surface,
            # not a synthesis surface — skip the narrative here. Users
            # wanting it can call `i/hme drama_finder` directly.
            import os as _os
            _prev = _os.environ.get("HME_DRAMA_NO_SYNTHESIS")
            _os.environ["HME_DRAMA_NO_SYNTHESIS"] = "1"
            try:
                parts.append(_ce(mode="full"))
            finally:
                if _prev is None:
                    _os.environ.pop("HME_DRAMA_NO_SYNTHESIS", None)
                else:
                    _os.environ["HME_DRAMA_NO_SYNTHESIS"] = _prev
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
                        capture_output=True, text=True, timeout=2
                    )
                    _cf = ",".join(f.strip() for f in _git.stdout.strip().splitlines() if f.strip())
                except Exception as _err1:
                    logger.debug(f'silent-except review_unified.py:86: {type(_err1).__name__}: {_err1}')
            # If still no files (e.g. auto-committed before review), read EDIT backlog from nexus
            if not _cf:
                import os as _os
                try:
                    _nexus_path = _os.path.join(ctx.PROJECT_ROOT, "tmp", "hme-nexus.state")
                    with open(_nexus_path) as _nf:
                        _edit_entries = [l.strip() for l in _nf if l.startswith("EDIT:")]
                    _nexus_files = [e.split(":", 2)[2] for e in _edit_entries if e.count(":") >= 2]
                    if _nexus_files:
                        _cf = ",".join(_nexus_files)
                except Exception as _err2:
                    logger.debug(f'silent-except review_unified.py:98: {type(_err2).__name__}: {_err2}')
            # Log cascade predictions for each changed file so reconcile-predictions.js
            # has data to score. These are non-injected (post-hoc) predictions.
            if _cf:
                try:
                    from .cascade_analysis import _log_prediction, _forward_bfs
                    for _fpath in _cf.split(","):
                        _mod = _fpath.strip().rsplit("/", 1)[-1].rsplit(".", 1)[0]
                        if _mod:
                            _chain = _forward_bfs(_mod, depth=2)
                            if _chain:
                                _log_prediction(_mod, [n for _, n, _ in _chain], injected=False)
                except Exception as _cp_err:
                    logger.info(f"cascade prediction in review FAILED: {type(_cp_err).__name__}: {_cp_err} (files: {_cf[:200]})")
            try:
                from .workflow_audit import what_did_i_forget as _wdif
                _wdif_out = _wdif(_cf or "")
                parts.append(_wdif_out)
                # D2: emit structured verdict marker so onboarding_chain can
                # advance state deterministically regardless of output format.
                try:
                    from server.onboarding_chain import emit_review_verdict_marker
                    import re as _re_vw
                    lo = _wdif_out.lower()
                    if "warnings: none" in lo or "no changed files" in lo:
                        verdict = "clean"
                    elif "warning" in lo:
                        # Parse the `## Warnings (N)` block and see if every
                        # bullet is a SCAFFOLDING reminder (HOOK CHANGE, DOC
                        # CHECK, SKIPPED, KB). workflow_audit's internal
                        # _actionable filter already treats those as
                        # non-defects; the verdict marker should honor the
                        # same filter. Without this, every edit creates two
                        # boilerplate reminders → stop.sh blocks forever.
                        warnings_section = _re_vw.search(
                            r'^## Warnings \(\d+\)\s*\n((?:^[ \t]*-.*\n?)+)',
                            _wdif_out, _re_vw.MULTILINE,
                        )
                        if warnings_section:
                            bullets = [
                                ln for ln in warnings_section.group(1).splitlines()
                                if ln.strip().startswith("-")
                            ]
                            # Single-space after ] to match the regex in
                            # posttooluse_hme_review.sh and the tuple in
                            # workflow_audit.py — the three consumers of
                            # this scaffold convention previously used
                            # \s+ here, exact-string prefixes elsewhere,
                            # which made a two-space producer emission
                            # scaffold-only on THIS side but actionable
                            # on the others. Peer-review iter 111.
                            # "audit skipped" added — same scaffolding
                            # class, surfaces on file-move artifacts
                            # where static audit references a path that
                            # was renamed mid-session.
                            scaffold_re = _re_vw.compile(
                                r'\] (HOOK CHANGE|DOC CHECK|SKIPPED|KB):'
                                r'|audit skipped\s*[:—]'
                            )
                            if not bullets:
                                # "## Warnings (N)" matched but no dash-
                                # bullets extracted — empty list is clean.
                                verdict = "clean"
                            elif all(scaffold_re.search(b) for b in bullets):
                                verdict = "clean"
                            else:
                                verdict = "warnings"
                        else:
                            # Outer guard saw "warning" in output but the
                            # `## Warnings (N)` regex didn't match. Two
                            # cases distinguish:
                            #   (a) Output is "## Warnings: none found" or
                            #       "## Warnings: 0 (clean)" — a clean-shape
                            #       header where the regex fails because it
                            #       requires `(N)` with paren+digit.
                            #   (b) Format drift — workflow_audit.py changed
                            #       its emission shape, regex is now stale,
                            #       all reviews silently fall here.
                            # Distinguish by checking for a header line
                            # mentioning warnings explicitly. If we see a
                            # warnings-header at all (case a), clean is
                            # right; if we don't (case b), it's parse
                            # failure and we mark "warnings" so the hook
                            # surfaces a re-run prompt rather than silently
                            # clearing EDIT against unverified state.
                            if _re_vw.search(r'^##\s+Warnings\b', _wdif_out,
                                             _re_vw.MULTILINE):
                                verdict = "clean"
                            else:
                                verdict = "warnings"
                    else:
                        verdict = "clean"  # No explicit warnings → treat as clean
                    parts.append(emit_review_verdict_marker(verdict))
                except Exception as _err3:
                    logger.debug(f'silent-except review_unified.py:116: {type(_err3).__name__}: {_err3}')
            except Exception as _fe:
                parts.append(f"what_did_i_forget error: {_fe}")
                try:
                    from server.onboarding_chain import emit_review_verdict_marker
                    parts.append(emit_review_verdict_marker("error"))
                except Exception as _err4:
                    logger.debug(f'silent-except review_unified.py:123: {type(_err4).__name__}: {_err4}')
        elif m == "convention":
            if not file_path:
                parts.append(
                    "i/review mode=convention — check a single file against project conventions.\n\n"
                    "Usage: i/review mode=convention file_path=<relative/path.js>\n"
                    "  file_path: path relative to project root (e.g. src/utils/clamps.js).\n\n"
                    "Example: i/review mode=convention file_path=src/utils/clamps.js"
                )
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
    result = "\n\n\n\n".join(parts) if len(parts) > 1 else parts[0] if parts else "No data."

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
    except Exception as _err5:
        logger.debug(f'silent-except review_unified.py:189: {type(_err5).__name__}: {_err5}')

    # 2. Cascade bypass detection (direct callers >> L0 consumers).
    # Originally this called _count_direct_callers(prod) for each producer,
    # and each call walked ~500 src files. With ~40 producers that's 20k
    # file reads per evolve call = ~4s. Batch version reads each src file
    # once and checks all producer names in a single pass — ~500 reads
    # total instead of 20k.
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
                    except Exception:
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
                        "detail": f"{direct} direct callers vs {l0_count} L0 consumers — {direct - l0_count} bypass L0.",
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
                        "detail": "Consistently underperforming — may need outcome scoring recalibration.",
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
        icon = {"dead-end": "📡", "orphan": "👻", "bypass": "⚡", "dimension-gap": "🔲",
                "virgin-pair": "🌉", "low-trust": "📉"}.get(rec["type"], "•")
        out.append(f"**{i}. {icon} [{rec['type']}] {rec['title']}** (priority: {rec['priority']:.1f})")
        out.append(f"   {rec['detail']}")
        out.append("")

    return "\n".join(out)
