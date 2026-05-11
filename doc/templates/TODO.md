# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)




<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->



- [easy] (a) `BuddyPrimaryHealthVerifier` added to `tools/HME/scripts/verify_coherence/runtime_behavior.py` and registered in REGISTRY. Asserts existence + non-empty content + mtime within `BUDDY_SESSION_MAX_AGE_SECS` (default 86400) under `BUDDY_HANDOFF=1 + BUDDY_SYSTEM=1`. Verified live: returns FAIL on this session because `runtime/hme/buddy-primary.sid` is absent. Liveness via kill -0 deferred to a follow-up tightening (existence-only is the false-green concern; mtime guard covers most of it). Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (c.1) Inspection found a confounding factor: my initial "empty features dict" reading was a `.get('features', {})` default in my diagnostic script -- the classifier output schema has no `features` field. Actual telemetry lines carry populated `reason` strings (e.g. "comprehensive/exhaustive scope signal"). The real diagnostic is timestamp-aged: all entries in `output/metrics/mode-classifier.jsonl` are 9 days old corpus-test fixtures. (auto-shipped from SPEC checkbox flip)
- [easy] (c.4-immediate) Age-gate added to all three downstream tier readers: `summary_format._read_tier_and_mode`, `phase_gate._read_tier`, `advisor_doctrine._read_tier`. Each now rejects entries older than `<DETECTOR>_TIER_MAX_AGE_SECS` (default 3600s), returning None so the gate skips rather than false-positiving. Env-overridable for tests. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [medium] (c.2) Repro: any current-session prompt triggers the false-positive because `tier_classifier.py` is never invoked outside test runs. Every detector reading `mode-classifier.jsonl` sees the same stale "E5 / explicit /e5 override" fixture as "latest classification." (auto-shipped from SPEC checkbox flip)
- [medium] (c.3) RCA: `tier_classifier.py` exists with a complete `classify_heuristic()` + `emit_telemetry()` pipeline, but no hook calls it. `userpromptsubmit.sh` does NOT invoke the classifier. Downstream detectors (`summary_format.py`, `phase_gate.py`, `advisor_doctrine.py`) all read "latest line of mode-classifier.jsonl" with no age check, so the 9-day-old test fixture entry drives tier-gating for every live turn. The wiring gap masquerades as classifier malfunction. (auto-shipped from SPEC checkbox flip)
- [easy] (pre) Fix consult-sentinel wipe: `_write_consult_sentinel` helper extracted; called AFTER `synthesis_reasoning.call()` returns (the proxy at 9099 fires UserPromptSubmit during the synthesis HTTP path, which wipes mid-call sentinel writes). Landed 2026-05-10 in `buddy_handoff_consult.py`. (auto-shipped from SPEC checkbox flip)
- [easy] (pre) Fix verify-landed checker: filename-shape regex only (overbroad `\b{mod}\b` match removed); turn-edit recording deferred to AFTER blocking gates. Landed 2026-05-10 in `verify_landed_block.sh` + `pretooluse_edit.sh`. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
