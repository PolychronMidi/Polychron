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
    mode='partner': partner-review register -- aesthetic / cultural / future-maintainer
        empathy on changed files. Complementary to mode='forget' (forensic register).
        Outputs a brief partner-letter, not tier-1 findings.
    mode='full': digest + regime + trust in one call."""
    _track("review")
    if mode != "forget":
        append_session_narrative("review", f"{mode}: {changed_files[:60] or file_path[:60] or 'full'}")
        ctx.ensure_ready_sync()
    parts = []

    modes = [mode] if mode != "full" else ["digest", "regime", "trust"]
    # mode=full concatenates three subsections; emit explicit `# ` headers
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
                # silent-ok: optional fallback path.
                result = f"pipeline_digest error: {e}"
            # In 'full' mode, truncate verbose blocking messages to a single line
            if mode == "full" and ("BLOCKED" in result or "STOP POLLING" in result or "IN PROGRESS" in result):
                parts.append("pipeline_digest: pipeline is still running -- cannot digest partial results.")
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
                    "i/review mode=sections -- compare two sections side-by-side.\n\n"  # tool-form-ok
                    "Usage: i/review mode=sections section_a=<N> section_b=<M>\n"
                    "  section_a, section_b: 0-indexed section numbers to compare.\n\n"
                    "Example: i/review mode=sections section_a=0 section_b=3"
                )
            else:
                from .section_compare import section_compare as _sc
                parts.append(_sc(section_a, section_b))
        elif m == "audio":
            # Read the cached perceptual report (~0ms) instead of running
            from .status_unified import _mode_perceptual
            parts.append(_mode_perceptual())
        elif m == "composition":
            from .composition import composition_events as _ce
            # drama_finder inside composition_events does a 60s LLM
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
                            scaffold_re = _re_vw.compile(
                                r'\] (HOOK CHANGE|DOC CHECK|SKIPPED|KB):'
                                r'|audit skipped\s*[:\-]'
                            )
                            if not bullets:
                                # "## Warnings (N)" matched but no dash-
                                # bullets extracted -- empty list is clean.
                                verdict = "clean"
                            elif all(scaffold_re.search(b) for b in bullets):
                                verdict = "clean"
                            else:
                                verdict = "warnings"
                        else:
                            # `## Warnings (N)` regex missed but "warning" in
                            if _re_vw.search(r'^##\s+Warnings\b', _wdif_out,
                                             _re_vw.MULTILINE):
                                verdict = "clean"
                            else:
                                verdict = "warnings"
                    else:
                        verdict = "clean"  # No explicit warnings -> treat as clean
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
                    "i/review mode=convention -- check a single file against project conventions.\n\n"  # tool-form-ok
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
        elif m == "partner":
            # Partner-review register -- complementary to 'forget' (forensic).
            from .synthesis import _reasoning_think, _PARTNER_SYSTEM
            _cf = changed_files
            if not _cf:
                try:
                    import subprocess as _sp
                    _git = _sp.run(
                        ["git", "-C", ctx.PROJECT_ROOT, "diff", "--name-only", "HEAD"],
                        capture_output=True, text=True, timeout=2
                    )
                    _cf = ",".join(f.strip() for f in _git.stdout.strip().splitlines() if f.strip())
                except Exception as _ge:
                    logger.debug(f"partner: git diff names failed: {_ge}")
            if not _cf:
                parts.append("# Partner Review\n\nNo changed files detected. "
                             "Pass changed_files='path1,path2' explicitly or make some changes first.")
            else:
                _files_list = [f.strip() for f in _cf.split(",") if f.strip()][:5]
                _diff_excerpt = ""
                try:
                    import subprocess as _sp2
                    _gd = _sp2.run(
                        ["git", "-C", ctx.PROJECT_ROOT, "diff", "HEAD", "--"] + _files_list,
                        capture_output=True, text=True, timeout=3
                    )
                    _diff_excerpt = _gd.stdout[:6000]
                except Exception as _ge2:
                    logger.debug(f"partner: git diff failed: {_ge2}")
                _user_text = (
                    f"Files in this change: {', '.join(_files_list)}\n\n"
                    f"Diff (first 6KB):\n```\n{_diff_excerpt}\n```\n\n"
                    "Write a partner-letter addressed to the author. Mark "
                    "what's well-shaped, identify cultural artifacts worth "
                    "preserving, name where future-self might trip, hold "
                    "puzzlement publicly if anything is genuinely confusing. "
                    "2-4 paragraphs. First-person. Not a bug list."
                )
                try:
                    _pr = _reasoning_think("/no_think\n" + _user_text,
                                           max_tokens=600,
                                           system=_PARTNER_SYSTEM)
                    parts.append("# Partner Review\n\n" + (_pr or "(no response)"))
                except Exception as _pe:
                    # silent-ok: optional fallback path.
                    parts.append(f"# Partner Review\n\nerror: {type(_pe).__name__}: {_pe}")
        else:
            parts.append(f"Unknown mode '{m}'. Use: digest, regime, trust, sections, audio, composition, health, forget, convention, symbols, docs, evolve, partner, full.")

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



# Re-export -- recommender extracted.
from .review_unified_recommender import _unified_evolution_recommender  # noqa: F401, E402
