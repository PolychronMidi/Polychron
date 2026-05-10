# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)


<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->


- [E2] CLI `i/blast-radius` -- `tools/HME/scripts/blast_radius.py` runs `git diff --name-only`, extracts top-level identifiers (Python def/class, JS export), greps for those identifiers across `src/` + `tools/` + `lab/`, prints a ranked impact table (file:hits). Wire as `i/blast-radius` symlink in `i/`. (auto-shipped from SPEC checkbox flip)
- [E2] PreToolUse `vow_bounded_reads.py` -- session-scoped Read/Grep/Glob counter with `HME_READ_BUDGET` (default 15); reset companion fires on Write/Edit/MultiEdit; opt-in via `HME_READ_BUDGET_ENFORCED=1` (default warn-only). Stores counter in `tmp/hme-read-budget-<sid>.txt` with `fcntl.flock` for parallel-Read safety. (auto-shipped from SPEC checkbox flip)
- [E3] CONSTITUTION.md root + CLAUDE.md override-mechanism + additive-bias scrutiny (night-market-borrow item 3)
- [E3] slop_scan.py Stop-level detector covering identity-leak P0, bare TODO, unbacked README claims (night-market-borrow item 2)
- [E3] tdd_test_first_gate.py PreToolUse hook (HME_TDD_GATE=1 opt-in; shadow-default warn) (night-market-borrow item 1)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source>
  difficulty: E1|E2|E3|E4|E5 (legacy easy/medium/hard accepted) -->

- [E2] vow_bounded_reads.py PreToolUse counter (HME_READ_BUDGET, default 15). Reason: SPEC night-market-borrow-2 item 1
- [E2] i/blast-radius CLI -- git-diff + grep cross-file impact analyzer. Reason: SPEC night-market-borrow-2 item 2

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
