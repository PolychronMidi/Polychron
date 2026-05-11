# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)







<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->






- [easy] (d) Custom buddy persona at `.claude/agents/buddy-primary.md` -- replaces synthesis-engine generic fallback. Encodes tier-gated findings, quote-grounding, promise-vs-delivers framing, anti-pray-and-spray refusal, KB-crystallize mandate. Closes BUDDY_SYSTEM.md forward-evolution item 1. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (e) `scope_vs_shipped` detector promoted to `deny: true` for both verdicts. Added `SCOPE_STACKED` + `SCOPE_NOT_TRACKED` reasons to `work_checks.js`. Gate enforces tick-or-revert. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (f) SessionStart banner surfaces missing `runtime/hme/buddy-primary.sid` under `BUDDY_HANDOFF=1 + BUDDY_SYSTEM=1`. Points operator at `log/hme-buddy-spawn.log`. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (g) `exhaust_check` structural enumeration signal: 3+ line-start list items in closing 60% of final text with no tool_use after fires `exhaust_violation` unconditionally. Phrase-game unwinnable, structure air-tight. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (h) `verify_landed_block.sh` regex tightened to filename-shape only. Parallel verify-landed branch added to `pretooluse_read.sh` so Read calls do not bypass. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (i) `buddy_handoff_consult.py` consult sentinel write deferred to AFTER `synthesis_reasoning.call()` returns. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (j) `pretooluse_edit.sh` turn-edit recording deferred to AFTER blocking gates -- no longer poisons `verify_landed_block.sh` on blocked edits. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (k) `strip_agent_artifacts` sanitizer added to `synthesis_config.py` and wired into every cascade provider. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (l) `26_empty_result_marker.js` middleware: empty body + `is_error=false` -> `[SUCCESS]`; empty + `is_error=true` -> `[FAIL]`. 12/12 tests pass. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (m) `lifecycle_bridge.js` blank-debug rotation cap at 500 newest; bulk-cleanup of pre-existing 3.4GB. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
