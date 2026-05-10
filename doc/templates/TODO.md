# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)

<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->

- [E3] CONSTITUTION.md root + CLAUDE.md override-mechanism + additive-bias scrutiny (night-market-borrow item 3)
- [E3] slop_scan.py Stop-level detector covering identity-leak P0, bare TODO, unbacked README claims (night-market-borrow item 2)
- [E3] tdd_test_first_gate.py PreToolUse hook (HME_TDD_GATE=1 opt-in; shadow-default warn) (night-market-borrow item 1)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source>
  difficulty: E1|E2|E3|E4|E5 (legacy easy/medium/hard accepted) -->

- [E3] tdd_test_first_gate.py PreToolUse hook (impl-without-test floor). Reason: SPEC night-market-borrow item 1
- [E3] slop_scan.py Stop-level detector (identity-leak P0 + bare TODO + unbacked-claim). Reason: SPEC night-market-borrow item 2
- [E3] CONSTITUTION.md root + CLAUDE.md override-mechanism + additive-bias scrutiny. Reason: SPEC night-market-borrow item 3

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
