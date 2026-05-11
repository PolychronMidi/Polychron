# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)



<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->


- [medium] (j) `evasion_intent.py`: split `EVASION_INTENT_PHRASES` (scaffolding -- exempt under self-reference rescue) from new `FABRICATION_PHRASES` (empty-result narration -- 25+ phrases like "came back empty", "returned empty", "not sure if it landed", "(empty) result", etc.). Fabrication matches scan BOTH thinking AND output (via new `_extract_output_text`). Self-reference rescue NO LONGER applies to fabrication -- editing the detector cannot exempt fabrication-style narration about empty results. Tests added; existing 10 tests still pass. Catches the catastrophic-failure recurrence pattern the user explicitly flagged this turn. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (a) Added `iter_tool_uses` to `exhaust_check.py` import. The detector no longer crashes on the structural-enumeration path. Verified: `_has_tool_call_after_last_text([])` returns False without NameError. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (b) Re-ran audit after (a): detector-chain corpus failures dropped from 3 to 3 (the import was not the root cause of fixture failures; they are genuine behavior-change regressions). Audit total dropped from 7 to 6 findings. Documented inline. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (e) `$SENIOR_CONSULT_DEBT` shell-undefined fixed via `${SENIOR_CONSULT_DEBT:-ok}` default-expansion at the two reference sites. The var IS set by the eval'd output of `emit_detectors_sh.py` at line 13, but static analysis can't see eval-generated assignments. Default-expansion satisfies set -u and the audit. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (c) Fixture updates: `pile_on/two-detector-edits-fire` -> `two-new-detector-writes-fire` (uses Write), added complement `two-detector-edits-pass` (Edits no longer fire); `pile_on/boundary-with-tool-results-fires` -> `boundary-with-tool-results-new-writes-fire` (uses Write). exhaust_check structural-enumeration check now respects `_is_research_evaluation_request` exemption so the corpus `research-eval-exemption` fixture passes. All 3 fixtures now PASS. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (d) Hook coordination cycle resolved: `userpromptsubmit.sh` had `MUST RUN BEFORE: stop. COORDINATES WITH: precompact, sessionstart.` on one line; the audit regex's non-greedy `(.+?)$` consumed the whole tail as the BEFORE list, parsing "sessionstart" as a BEFORE target and forming a cycle with sessionstart->userpromptsubmit. Restructured to put COORDINATES on the prose line and `MUST RUN BEFORE: stop` on its own line; audit now reports `hook:userpromptsubmit: before stop` cleanly, no cycle. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (f) `doc/HME.md` doc-sync: updated "12 agent-callable tools" -> "13 agent-callable tools (... / holograph)" at line 7 + "12 tools above" -> "13 tools above" at line 13 (the latter was the first regex match). Added the 9 detector names (advisor_doctrine, ceremony_dodge, live_probe, phantom_capability, phase_gate, scope_escape, senior_consult_debt, summary_format, trample_gate) plus evasion_intent + scope_vs_shipped to `project-rules.json:known_non_tool_identifiers` so the doc-sync verifier stops misclassifying detector references as missing tools. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
