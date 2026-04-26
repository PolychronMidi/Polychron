# Polychron HME Co-Buddy Fanout TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!--
  Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Rewrite (don't append) as the focus narrows. Empty when no skill is running.
-->

## Just shipped (last cycle)

<!--
  Append-on-close, newest first. Format:
  - <one-line summary> — by <skill-name> at <utc-iso>
  Trim to the most recent 10 entries; older history lives in SPEC.md phase
  blocks and `git log`.
-->

- Phase 2 NEVER lists + lifesaver source-tag self-origin classifier — by manual at 2026-04-26T16:30:00Z
- Phase 2.5 manager-guidance file (tmp/hme-operator-guidance.md) — by manual at 2026-04-26T16:25:00Z
- Phase 2.4 fast-path on clean (skip deep walk) — by manual at 2026-04-26T16:20:00Z
- Phase 2.3 citation-required-for-edit gate (in dispatch prompt) — by manual at 2026-04-26T16:15:00Z
- Phase 2.2 verdict-file exit contract — by manual at 2026-04-26T16:10:00Z
- Phase 2.1 iter-boundary drafts sweep (self-heal partial completion) — by manual at 2026-04-26T16:05:00Z
- Phase 1 dispatcher: queue-dir + atomic claim + sentinel + manifest + floor escalation — by manual at 2026-04-26T15:55:00Z
- Phase 1.2 buddy_init.sh extended for N co-buddies + per-slot SID/floor files — by manual at 2026-04-26T15:50:00Z
- Phase 1.1 BUDDY_COUNT + BUDDY_MODEL_FLOORS env knobs — by manual at 2026-04-26T15:45:00Z
- Phase 0 substrate: tier field + ingest_from_spec + promote_to_spec + close_with_spec_update + sessionstart wire + drift guard — by manual at 2026-04-26T15:30:00Z

## Next up (queued for next cycle)

<!--
  One line per queued item. The next cycle picks the top item unless the spec says otherwise.
  Format:
  - [<difficulty>] <one-line description>. Reason: <spec phase X.Y, supervisor verdict <sha>, manager directive, user message>
  Difficulty: easy / medium / hard (model + effort routing — see SPEC.md).
  Order: blockers/highest-impact first (label is independent of priority).
-->

(empty — Phase 0/1/2 fully landed; next user direction sets the queue)

---

When this Next up is empty AND every `- [ ]` in [doc/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>` and the dispatcher aborts the loop cleanly. See SPEC.md "Empty-queue bail" appendix.
