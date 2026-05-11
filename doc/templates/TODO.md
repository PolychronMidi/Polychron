# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)





<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->




- [medium] (d) `todo_spec_archive._strip_per_cycle_scratch` added: on archive, `## Deferred to next cycle` section content is replaced with an empty-placeholder comment. Per-cycle scratch was accumulating verbatim across cycles. Durable sections (out-of-scope, Glossary, NEVER lists, How-evolves, Worthiness gate) still preserved. One-time purge applied to the live SPEC. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (c) `tests_failing_in_scope.py` accepts pytest exit code 5 (no tests collected) as ok. Detector's purpose is to surface FAILED tests; "no tests collected" means no failures exist. Closes the false-positive that was logging `no tests ran in 0.01s` to `hme-errors.log` every stop chain. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (b) `_SELF_REFERENCE_FILES` broadened to include `pretooluse_edit.sh`, `verify_landed_block.sh`, `pretooluse_read.sh`, `audit-comment-bloat.py`. Gate-maintenance turns editing these files no longer trip self-fire. All 10 evasion_intent tests still pass. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [medium] (a) 90-char comment-line rule landed in audit + pretooluse gate. 751 existing violations queued for separate sweep. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
