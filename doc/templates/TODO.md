# File Format Rules: 1 todo item per line. Each line must start with one of the following todo status codes:
0_ default status upon creation,
1_ in progress,
2_ revisit (default is in 10 minutes, or whenever all todos in list completed, move to top of list as status 0_). Specify minutes by appending like "2_60",
3_ major block via architechtural design, scope, or low confidence/high risk needing explicit confirmation,
4_ nominally complete, but needs a follow-up. Must be followed by the follow-up todo on the next line with the following code,
4f_ follow up todo, automatically becomes status 0_ in 30 minutes, or specify custom minutes like "4f_60" for 60 minutes. If needs qualifier before becoming status 0_, append _q="qualifier explanation here". Auto-added to new todo sets
5_ Completed totally, no danglers, nothing missing.

Example:
#1 5_ make todo template with rules so agents can simply fill out below. A set auto-archives to `log/todo/set<number>.md` once no item is still in progress (none at 0_/1_/2_) and at least one item is 5_; the non-5_ items (3_/4_/4f_) carry forward into the next set with their codes preserved

### Todo - Set 52

#20 5_ built quote_provenance detector core: tools/HME/scripts/detectors/quote_provenance.py (sibling of fabrication_check.py, reuses _transcript helpers). Parses RAW final assistant text, extracts only 2nd-person-attributed delimited quotes, builds corpus from ALL is_real_user_prompt turns with [ALERT]/<task-notification>/Note: banners stripped, normalizes alnum-only (case/whitespace/curly-quote/apostrophe folded via \u escapes -- pure ASCII source), min len 3, names the offending span verbatim, HARD-DENY no waiver, skips self-edit turn. DECLARED_VERDICTS={"ok","quote_fabrication"}. Executable bit set in git index.
#21 5_ registered quote_provenance in all three wiring points: registry.json entry (category:security, scope:transcript, fires_when:quote_fabrication, bash_var:QUOTE_PROVENANCE; verify_registry_consistency 27 bash_vars OK), DECLARED_VERDICTS exposed (run_all no drift), and anti_patterns.js (QUOTE_PROVENANCE default + REASONS entry + deny line on v.QUOTE_PROVENANCE==='quote_fabrication'; node -c clean).
#22 5_ wrote test_quote_provenance.py negative-control suite, all 6 cases pass: real-quote-of-user->ok, fabricated attributed quote->quote_fabrication, paraphrase->ok, tool-output-quote->ok, injected-banner-quote->quote_fabrication, apostrophe/case/whitespace variance->ok. Executable bit set in git index.
#23 5_ verified whole chain: declared-verdict drift none, python spec leg run_py.py 51/51, invariant battery 181/181 (after restoring Phase 15/16 plan anchors phase-evidence requires + fixing the ASCII violation from literal curly quotes), quote_provenance 6/6. The detector chain's lone red (stop_work proxy-noop-local-turn-exempt, 1/72) is preexisting and unrelated -- carried as #24.
#24 0_ preexisting detector-chain failure: stop_work proxy-noop-local-turn-exempt expects ok, gets TEXT_ONLY_SHORT (1/72 in test_detector_chain.py). Verified NOT caused by the quote_provenance work -- fails identically with the registry change reverted, and stop_work.py/test_detector_chain.py are unmodified. Diagnose stop_work's proxy-noop-local-turn exemption (a local-turn no-op should be exempt from the TEXT_ONLY_SHORT verdict) and fix or update the fixture.
