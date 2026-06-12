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

#20 0_ build quote_provenance detector core: tools/HME/scripts/detectors/quote_provenance.py, sibling of fabrication_check.py reusing _transcript helpers. Parse RAW final assistant text (NOT strip_quoted), extract 2nd-person-attributed delimited quotes only (you said/asked/wrote/told me, your words/message/request, as you put it + delimiter), build corpus from ALL is_real_user_prompt turns with [ALERT]/<task-notification>/Note: banner prefixes stripped, normalize alnum-only (lowercase, collapse whitespace, fold curly quotes + apostrophe contractions), min len 3, per-span blame naming the offending span verbatim, HARD-DENY no waiver, skip self-edit turn. DECLARED_VERDICTS={"ok","quote_fabrication"}.
#21 0_ register quote_provenance in all three wiring points: registry.json entry (deny:true, category:security, scope:transcript, fires_when:quote_fabrication, bash_var:QUOTE_PROVENANCE), DECLARED_VERDICTS exposed for run_all _check_declared_verdicts, and anti_patterns.js (readVerdicts default + REASONS entry + deny line on v.QUOTE_PROVENANCE==='quote_fabrication').
#22 0_ write test_quote_provenance.py negative-control suite: real-quote-of-user->ok, fabricated attributed quote->quote_fabrication, paraphrase-no-delimited-quote->ok, tool-output-quote->ok, injected-banner-quote->quote_fabrication, apostrophe/case/whitespace variance of real span->ok.
#23 0_ verify whole chain green: run_all.py declared-verdict check + full detector chain (test_detector_chain.py), invariant battery 181/181, python spec leg run_py.py, no new false-positive on legitimate paraphrase/tool-output/self-edit turn.
