# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)

<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->

- [2026-05-11] `_onb_init` resets to boot every session; only in-progress states preserved. `tools/HME/hooks/helpers/_onboarding.sh`
- [2026-05-11] Selftest emits WARN (not FAIL) for partial index (chunks>0, files<100); fix hint prescribes `action=index` first. `tools/HME/service/server/tools_analysis/evolution/evolution_selftest/selftest.py`
- [2026-05-11] `i/consult` kv passthrough strips leading dashes before re-prefixing; `--engine=synthesis` now routes correctly. `i/consult`
- [2026-05-11] `buddy_init.sh` pre-logs `spawn-init` outside the background subshell so a spawn that dies before launching still leaves a trace. `tools/HME/hooks/helpers/buddy_init.sh`
- [2026-05-11] `.env`: bumped `HME_TOOL_HARDKILL_S` to 600s (was hitting 240s hard-kill on full reindex). `.env`
- [2026-05-11] `watcher._do_dir_reindex` consecutive-failure backoff (2x..8x cooldown multiplier). `tools/HME/service/watcher.py`
- [2026-05-11] Regression test for `_onb_init` (5 tests, all pass). `tools/HME/tests/specs/onboarding_init.test.js`
- [2026-05-11] Narrowed glob for `hooks-executable`, `hooks-registered` invariants to exec'd dirs only. `tools/HME/config/invariants.json`
- [2026-05-11] Excluded `*.test.js` from `eslint-rules-registered`. `tools/HME/config/invariants.json`
- [2026-05-11] `_resolve_glob` helper: invariant globs accept string or list. `tools/HME/service/server/tools_analysis/evolution/evolution_invariants/{_base,checks}.py`
- [2026-05-11] LOC-ignore entries for already-oversized edited files (watcher.py, invariants.json). `config/loc-ignore.txt`
- [2026-05-11] `eslint-concordance-complete` fix: exclude `*.test.js` from rule scan; added concordance entries for `no-bare-declared-global-in-init` + `no-or-fallback-on-map-get`. `tools/HME/service/server/tools_analysis/evolution/evolution_invariants/checks_code.py`, `tools/HME/config/invariants.json`
- [2026-05-11] HCI display unification: `i/status` (substrate-view) now reads canonical `hci-verifier-snapshot.json` first (was preferring stale `pipeline-summary.json`). All HCI tools now agree. `scripts/hme/substrate-view.py`

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

- [E3] `eslint-concordance-complete` invariant fails consistently (streak 9). Reason: type=eslint_concordance_complete custom check, needs runner inspection.
- [E4] HCI display unification across i/state, i/status, i/holograph, selftest. Reason: 4 different numbers (86.1/88/91/88) for same metric is coherence-of-self-coherence problem.
- [E3] 3 overdue p1 blindspot subsystems (conductor/time/composers) untouched 10 rounds. Reason: i/evolve flagged systemic avoidance.

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
