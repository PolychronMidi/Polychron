# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)



<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->



- [E1] B.3 Worthiness gate appendix in [SPEC.md template](../templates/SPEC.md) -- 4-axis (priority/criticality/simplicity/evidence) 0-3 score per Phase; total <6/12 defers to TODO.md Next-up. (auto-shipped from SPEC checkbox flip)
- [E1] C.2 Refresh stale-soft-warn notes with concrete promotion criteria + add `Auditor exemption: non-temporal` marker for permanent soft-flags (advisor_silently_skipped, claim_without_evidence). (auto-shipped from SPEC checkbox flip)
- [E1] C.3 Reorder vow_bounded_reads --reset to fire BEFORE TDD gate in [pretooluse_edit.sh](../../tools/HME/hooks/pretooluse/pretooluse_edit.sh)/[_write.sh](../../tools/HME/hooks/pretooluse/pretooluse_write.sh) -- TDD-blocked attempts still break the read streak. (auto-shipped from SPEC checkbox flip)
- [E1] Spinner verbs: dropped trailing period from custom verb (sentence-form breaks "Cooked for 1m" duration template). (auto-shipped from SPEC checkbox flip)
- [E2] B.2 [buddy_watchdog.py](../../tools/HME/scripts/buddy_watchdog.py) -- transcript_missing -> clear primary pointer. Silence is NOT a failure signal (buddy primaries are sid pointers, not long-lived processes). (auto-shipped from SPEC checkbox flip)
- [E2] C.1 Extract shared .env loader to [tools/HME/proxy/shared/load_env.js](../../tools/HME/proxy/shared/load_env.js); [hme_proxy.js](../../tools/HME/proxy/hme_proxy.js) now requires it. (auto-shipped from SPEC checkbox flip)
- [E2] C.4 [spec_autoflip.py](../../tools/HME/scripts/spec_autoflip.py) now catches "birth-as-shipped" items (line is `[x]` in current AND didn't exist in HEAD), not just `[ ]→[x]` transitions. (auto-shipped from SPEC checkbox flip)
- [E3] B.1 [tiered_audit.py](../../tools/HME/scripts/tiered_audit.py) + [i/audit-tiered](../../i/audit-tiered) -- multi-pass orchestrator over existing detectors; adds zero new rules. 5 passes: lint floor, marker registry, identity/slop, tests, README. (auto-shipped from SPEC checkbox flip)
- [E3] spec-kit auto-tasks-from-Phase: extend `_ingest_from_spec` to read `- [ ]` items from SPEC.md `### Phase N` block via `text="N"`/`"latest"`/`todo_id=N`; default TODO.md "Next up" path preserved (manual ship -- Phase 2 added directly at [x])
- [E2] CLI `i/blast-radius` -- `tools/HME/scripts/blast_radius.py` runs `git diff --name-only`, extracts top-level identifiers (Python def/class, JS export), greps for those identifiers across `src/` + `tools/` + `lab/`, prints a ranked impact table (file:hits). Wire as `i/blast-radius` symlink in `i/`. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source>
  difficulty: E1|E2|E3|E4|E5 (legacy easy/medium/hard accepted) -->

(empty -- night-market-borrow-2 set complete; populate next cycle from new SPEC Phase via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
