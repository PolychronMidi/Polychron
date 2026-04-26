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

- Phase 0 SPEC.md + TODO.md substrate created — by manual at 2026-04-26T15:00:00Z
- Lifesaver-todo dedup + TTL + max-cap + prune store-protection — by manual at 2026-04-26T15:00:00Z (closes the 35-zombie-entries spam class)

## Next up (queued for next cycle)

<!--
  One line per queued item. The next cycle picks the top item unless the spec says otherwise.
  Format:
  - [<difficulty>] <one-line description>. Reason: <spec phase X.Y, supervisor verdict <sha>, manager directive, user message>
  Difficulty: easy / medium / hard (model + effort routing — see SPEC.md).
  Order: blockers/highest-impact first (label is independent of priority).
-->

- [easy] Add `tier` field to i/todo schema (default existing items to `"medium"`, accept `tier=easy|medium|hard` on add). Reason: spec Phase 0
- [medium] Add `i/todo action=ingest_from_spec` — read TODO.md Next up, materialize each as i/todo entry with `source="spec"` and `tier=<label>`. Reason: spec Phase 0
- [medium] Add `i/todo action=promote_to_spec target=<id>` — move ephemeral i/todo entry to TODO.md Next up with Reason cite. Reason: spec Phase 0
- [medium] Add `i/todo action=close_with_spec_update target=<id>` — flip SPEC.md `[ ]→[x]` if entry closes a spec item, append to TODO.md Just shipped, mark i/todo done — atomic. Reason: spec Phase 0
- [medium] Wire `sessionstart.sh` to read `doc/TODO.md` In flight section alongside `list_carried_over()`. Reason: spec Phase 0
- [hard] Pre-commit / autocommit-guard rule: if `src/**` changed AND no spec-item closure noted, require either `doc/SPEC.md` OR `doc/TODO.md` to change in the same commit. Reason: spec Phase 0

---

When this Next up is empty AND every `- [ ]` in [doc/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>` and the dispatcher aborts the loop cleanly. See SPEC.md "Empty-queue bail" appendix.
