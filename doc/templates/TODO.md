# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)




<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->



- [medium] (c) i/ trivial-dispatch sweep round 2, buddy-consult-driven: applied classify-then-eyeball methodology per buddy's design. Classifier bucketed 34 wrappers into TRIVIAL_SAFE=2, ALREADY_CONVERTED=3, REVIEW_NEEDED=7, SKIP=22. Pre-check: confirmed `i/help` reads `i_registry.json` first + falls back to comment header (so wrapper file + comment must persist; only dispatch body can change). Eyeballed both TRIVIAL_SAFE (`i/pattern`, `i/timeline`); converted both with smoke test. Both still produce correct output AND `i/help <name>` still shows correct registry metadata. Real lesson from the consult: only 2 of the 31 remaining wrappers are actually safe for auto-conversion -- the buddy's "false negatives are silent failures" warning was load-bearing. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (b) `_strip_per_cycle_scratch` extended to wipe BOTH `## Deferred to next cycle` AND `## Deferred / out of scope` on archive (was only wiping the first). The "out of scope" section had accumulated 5 stale items across many cycles (Telegram bot, A2A protocol, Skills-as-bundles, JSON schema, Auto-promote tiers) -- removed from live SPEC and the future archive flow auto-clears both per-cycle scratch sections. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)
- [easy] (a) `scope_vs_shipped._turn_invoked_archive_now()` exemption added: scans Bash tool_uses for `action=archive_now`/`action=clear`; short-circuits to ok when matched. Closes the false-positive where archive_now's devlog write registered as scope-not-tracked against the fresh-slate template's 0 ticks. Verified: synthetic archive turn -> recognized; plain edit turn -> not recognized. Landed 2026-05-11. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
