# Polychron — Coding Rules

> Imperative-only rule guide. For *what things are*, see [README.md](../README.md), [doc/ARCHITECTURE.md](../doc/ARCHITECTURE.md), [doc/HME.md](../doc/HME.md), [doc/TUNING_MAP.md](../doc/TUNING_MAP.md), [doc/SUBSYSTEMS.md](../doc/SUBSYSTEMS.md).

## Run

`npm run main` — full pipeline. **Never run individual pipeline scripts directly.**

## Five Core Principles

1. **Globals via side-effect `require()` in `index.js`.** Never `global.` / `globalThis.` / `/* global */`. Reference globals directly — never alias. To add: side-effect module → require from subsystem `index.js` → declare in `globals.d.ts`. **Never hand-edit `VALIDATED_GLOBALS`** (auto-generated). Critical globals throw on missing; advisory globals (`/** @boot-advisory */`) warn only. Never `typeof` a boot-validated global.
2. **Fail fast.** Every module throws on bad input. No silent early returns. No `|| 0` / `|| []` fallbacks. No graceful degradation. Use `validator.create('ModuleName')` for all validation. Use `optionalFinite(val, fallback)` only for legitimately optional numerics.
3. **Self-registration.** Modules self-register at load time via `crossLayerRegistry` or `conductorIntelligence`. To add: write file, self-register at end of IIFE, require from subsystem `index.js`. **Never manually tune constants that a meta-controller already manages** (see Hypermeta-First below).
4. **Single-Manager Hub per subsystem.** One `*Manager` per subsystem (Facade + service locator). Helpers load first via `index.js`, then the manager. When a file exceeds ~200 lines, extract a focused helper loaded **before** the consumer.
5. **Coherent files, one responsibility.** Target ≤200 lines. File name matches main export. `const` and pure functions preferred. Only classes use PascalCase; everything else camelCase.

## Code Style

- JavaScript (CommonJS); TypeScript checking via `tsc --noEmit`.
- Console output: script start, successful output, temporary debug traces only. `console.warn` must use `'Acceptable warning: ...'` format.
- No ad-hoc validation: use `validator`, never raw `typeof` / `|| []` / `|| 0` / ternary fallbacks.
- Globals are truth: initialize correctly at the source. Never sanitize downstream.
- Comments are terse. No essay comments, no verbose JSDoc. One-line inline only where logic isn't self-evident.

## Load Order

`src/index.js` requires subsystems in this exact order:
`utils → conductor → rhythm → time → composers → fx → crossLayer → writer → play`

Each subsystem `index.js`: helpers first, manager/orchestrator last.

## Architectural Boundaries (rules — no exceptions)

- **Cross-layer cannot write to conductor.** Only local `playProb`/`stutterProb` and `explainabilityBus` diagnostics.
- **Conductor cannot mutate cross-layer state.** Read-only via getters is fine; writes are banned (`local/no-direct-crosslayer-write-from-conductor`).
- **Signal reading:** always through `signalReader`, never `conductorIntelligence.getSignalSnapshot()` directly.
- **New feedback loops:** must register with `feedbackRegistry` and declare in `output/metrics/feedback_graph.json`.
- **Trust system names:** always use `trustSystems.names.*` / `trustSystems.heatMapSystems.*`. Never hardcode strings.
- **Cross-layer emission:** route all buffer writes through `crossLayerEmissionGateway.emit(sourceModule, buffer, event)`. Never `push()` directly.
- **Inter-module communication:** via `L0` (L0) channels, not direct calls. Channel names must use `L0_CHANNELS.xxx` constants; bare strings in L0 method calls are a hard error (`local/no-bare-l0-channel`). New channel: add to `l0Channels.js`, declare in `globals.d.ts`.
- **Firewall ports:** the 9 controlled cross-boundary openings are declared in `output/metrics/feedback_graph.json` under `firewallPorts`. New cross-boundary data flow → declare a port.

### Hypermeta-First (no whack-a-mole overrides)

The 18 hypermeta self-calibrating controllers manage all 6 axes and own coupling targets, regime distribution, pipeline centroids, flicker range, trust starvation, coherent relaxation, entropy amplification, progressive strength, gain budgets, axis equilibration, phase energy floor, per-pair gain ceilings, section-0 warmup ramps, and `coherentThresholdScale`.

- **Never hand-tune meta-controller constants.** Modify the controller logic instead.
- **Never set `coherentThresholdScale` per-profile** — the regime self-balancer owns it.
- **Never add manual axis floors/caps/thresholds** (e.g. SpecialCaps in `axisEnergyEquilibratorAxisAdjustments.js`). When an axis is suppressed/dominant, diagnose WHY the responsible controller isn't working and fix its logic.
- **Coupling matrix firewall:** never read `.couplingMatrix` from `systemDynamicsProfiler.getSnapshot()` outside the coupling engine, meta-controllers, profiler, diagnostics, or pipeline plumbing. Modules needing coupling awareness register a bias via `conductorIntelligence` and respond through the controller chain (`local/no-direct-coupling-matrix-read`).
- **Bias bounds are locked:** 93 registrations validated against `scripts/bias-bounds-manifest.json`. Snapshot after legitimate structural changes: `node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds`.

Enforced by `check-hypermeta-jurisdiction.js` (4 phases). Query topology via `metaControllerRegistry.getAll()` / `getById()` / `getByAxis()`.

## Layer Isolation (L1/L2 Polyrhythmic Safety)

Two polyrhythmic layers alternate via `LM.activate()`. Mutable globals bleed between layers unless explicitly per-layer.

- **Per-layer globals** live in `LM.perLayerState`, saved/restored on every `activate()` call. Currently: `crossModulation, lastCrossMod, balOffset, sideBias, lBal, rBal, cBal, cBal2, cBal3, refVar, bassVar, flipBin`.
- **Conductor recorders** tick L1-only via the registry gate. Only `conductorSignalBridge` runs on L2. Never add beat counters or ring buffers to recorders without accounting for this.
- **Closure-based per-layer state** uses `byLayer` maps keyed by `LM.activeLayer` (e.g. `stutterTempoFeel`, `crossLayerDynamicEnvelope`, `journeyRhythmCoupler`, `emissionFeedbackListener`).
- **Adding new mutable state:** ask "is this written per-beat and read by both layers?" If yes, it needs per-layer treatment.

## Pipeline Discipline

- **Lab runner** at `lab/run.js` uses isolated temp working directories — never touches `output/`. 180s timeout.
- **Non-fatal step error scanning:** `main-pipeline.js` captures stdout+stderr from post-composition steps and scans for error keywords. Detected errors are written to `output/metrics/pipeline-summary.json` under `errorPatterns`. **A non-fatal step marked OK with exit code 0 can still contain real failures** — always check `errorPatterns` in the summary.
- **Lab sketches:** every `postBoot()` must contain real implementation code that creates the described behavior. A `setActiveProfile()`-only postBoot is empty and tests nothing. Monkey-patching globals/functions in postBoot is the integration prototyping mechanism.

## Hard Rules (Never Violate)

- **Binaural is imperceptible neurostimulation only.** Alpha range 8-12Hz. Never go below 8Hz or above 12Hz. Never experiment with binaural frequency. `setBinaural` runs from `grandFinale` post-loop walk ONLY, never from `processBeat`.
- **Never delete unused code/config before checking if it should be implemented.** Only delete code that can't be reasonably adapted and whose concerns are already covered elsewhere. Otherwise, wire it up and implement.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Never abandon a plan mid-execution.** Finish the current atomic unit before pivoting. If user feedback changes direction, explicitly acknowledge the pivot, state what was left undone, and confirm before switching. Never leave code/tools in a broken intermediate state. Clarifying questions belong BEFORE starting implementation. Atomic units: a file sweep is not done until every file in scope is fixed; a merge is not done until the routing logic exists; a KB cleanup is not done until every candidate entry has been processed.

## Working Style

- **User messages via system-reminder:** respond immediately. Do not wait for any running process or tool call to finish first. Drop everything and reply now. Resume prior work after responding, unless the message says to stop.
- **Context budget:** when the window has headroom, be greedy — use parallel research agents, read full files, investigate deeply. Only economize when window pressure is high or the task is clearly trivial. Default to thoroughness.
- **Auto-commits:** after each verified non-regressive pipeline run (STABLE or EVOLVED), auto-commit all changed files with format `RXX: brief description`. Do not commit DRIFTED runs or failed pipelines.
- **Act on feedback immediately and thoroughly.** Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction ("clear lab and build next round"), do the entire sequence without pausing. Investigate root causes of every bug surfaced — don't cherry-pick one and ignore the rest.
- **If you find yourself violating a rule here, the fix is behavioral, not more memories or hooks.**

## HyperMeta Mandatory Workflow

All HME tools are invoked via executable shell wrappers in `i/` (e.g. `i/review`, `i/trace`). The proxy middleware owns MCP transport; Claude no longer connects to an MCP server. Full reference: [doc/HME.md](../doc/HME.md).

- **After implementing changes:** `i/review mode=forget` — auto-detects changed files from git. Checks KB constraints, boundary rules, new L0 channels, doc update needs.
- **After each listen-confirmed round:** `i/learn title="…" content="…" category=pattern` for calibration anchors. Do NOT add until user confirms task complete. If the user gives a listening verdict, also record it as ground truth: `i/learn action=ground_truth title=<SECTION> tags=[moment_type,sentiment] content=<COMMENT> query=<ROUND>` — lands in `output/metrics/hme-ground-truth.jsonl`, mirrored into KB with unconditional HIGH trust tier.
- **Close the round window:** between the user's pipeline run and querying `i/status` (budget/coherence/trajectory modes), emit `python3 tools/HME/activity/emit.py --event=round_complete --session=RNN --verdict=STABLE` so the activity bridge's coherence score isn't polluted by pre-round instrumentation edits. The Stop chain does this at turn end automatically (post_hooks stage in the JS evaluator at `tools/HME/proxy/stop_chain/`); do it manually mid-turn.
- **When pipeline fails:** read pipeline output, fix root cause. `i/hme-read target=<moduleName> mode=before` on the failing file.

## Reference Pointers

- Calibration anchors → KB (`i/learn query=…`); universal principles → [doc/hme-discoveries.md](../doc/hme-discoveries.md); historical round archive (deprecated) → [output/metrics/journal.md](../metrics/journal.md)
- ESLint rules (24) → `scripts/eslint-rules/` (enforced at lint time; no need to memorize)
- HME unit tests → `npm run test:hme` runs [tools/HME/tests/specs/](tools/HME/tests/specs/) via `node:test` (no new dep). Covers stop_chain evaluator, policies registry/config/migrated-rules, secret_sanitizer regex catalog, worker_queue round-trip, telemetry channels. Add a `*.test.js` file under `specs/` to register more tests.
- `i/*` command surface → [tools/HME/i_registry.json](tools/HME/i_registry.json) holds metadata for every wrapper. `i/help` lists everything grouped by category; `i/help <name>` shows usage/modes/examples; `i/help --json` dumps the full registry for tab-completion or external tooling. New `i/*` script: drop the file, add an entry to the registry. Until registered it shows up under `[unregistered]` with the line-2 header comment as fallback description.
- Unified hook-time policy registry → [tools/HME/policies/](tools/HME/policies/) with `i/policies` CLI. Single discovery + config surface for PreToolUse / PostToolUse / Stop / middleware rules: `i/policies list` shows every JS-implemented hook-time rule grouped by category; `i/policies disable <name>` writes to `.hme/policies.json` (project) / `.hme/policies.local.json` (developer-local) / `~/.hme/policies.json` (global) with three-scope merge. Built-ins live in [policies/builtin/](tools/HME/policies/builtin/); custom policies via `customPoliciesPath` in config. Out of scope: ESLint / boot validators / runtime invariants / HCI verifiers — those have load-bearing timing properties incompatible with hook-time evaluation.
- Bash-gate ↔ JS-policy unification: when adding a bash gate that has a JS-policy counterpart in `policies/builtin/`, source [hooks/helpers/_policy_enabled.sh](tools/HME/hooks/helpers/_policy_enabled.sh) and wrap the gate body in `if _policy_enabled <kebab-name> && <existing-condition>; then …`. The helper reads the same three-scope `.hme/policies.json` config that `i/policies` writes, so `i/policies disable <name>` works uniformly across both proxy-up (JS) and proxy-down direct-mode (bash) paths. Without this guard, disabling a JS policy leaves the bash gate firing — the "disable-doesn't-fully-disable" wart now closed across all 7 currently-duplicated rules.
- Test discipline: tests that mutate `process.env.X` MUST `delete process.env.X` (not assign `= undefined`) when the original was unset, otherwise later tests inherit the literal string `"undefined"` which is truthy and breaks `||` fallback patterns. See [tests/specs/policies_config.test.js](tools/HME/tests/specs/policies_config.test.js)'s `_withSandbox` helper for the canonical pattern.
- Test isolation when spawning bash hooks: any test that exercises `runStopChain`, `dispatchEvent`, or `shellPolicy` MUST sandbox `PROJECT_ROOT` to a tmp dir AND bust `require.cache` for everything under `proxy/` + `policies/` (so cached `PROJECT_ROOT` reloads). Without this, fail-loud helpers (`_safe_jq`, `_safe_py3`, `_safe_curl`) write to the real `log/hme-errors.log` when the test deliberately feeds malformed input — and the next real Stop hook's LIFESAVER then surfaces those test-pollution entries as "UNADDRESSED ERRORS FROM PREVIOUS TURN." See [tests/specs/stop_chain.test.js](tools/HME/tests/specs/stop_chain.test.js)'s `_withChainSandbox` helper for the canonical pattern.
- Worktree, not checkout, for prior-state inspection. NEVER `git checkout HEAD~1 -- .` or `git stash && git checkout` to inspect a prior state — either pattern can clobber the working tree (including freshly-popped stashes) and require `git fsck --lost-found` recovery. Use `git show HEAD~1 -- <path>` (read-only stdout) or `git worktree add /tmp/x HEAD~1` (isolated checkout). Lifted from skill-set sst-dev-review §pitfalls; same hazard exists for any HME audit script that wants to compare against an earlier commit.
- Two-tier severity, no third tier: review/audit findings carry exactly **blocker** or **should-fix** — never "nit" / "nice-to-have" / "could-be-clearer." Padding with trivia dilutes signal so the reader skims past the load-bearing items. Self-gate every finding with "would this actually hurt a user / cause a real bug" — if honest answer is no, drop it. A zero-finding review IS a success signal, not a failure to find work. Lifted from skill-set sst-supervisor §2 + sst-dev-review §severity-bar.
- Anti-fork on heuristic lists: any keyword/regex/severity list whose tuning is documented as "intentionally noisy, prefer false positives" CANNOT be loosened with soft matches without spec'ing the change first. Examples in HME: LIFESAVER classifier severity words, fast-path-clean signals, fabrication-check phrase list, exhaust_check deferral phrases. The bias direction is load-bearing — silently relaxing it re-opens the failure mode the conservative tuning was built to close. Skill-set Phase 12 calls this anti-fork; same discipline applies.
- Atomic file writes for state: any JSON/Markdown state file whose partial-write would corrupt downstream readers (manifests, watermarks, registry-entry JSON, feedback_graph.json) MUST write via temp-file + `os.replace` (Python) or `mv` (shell) on the same filesystem so the rename stays atomic per POSIX. Naked `open(target, 'w')` is fine for ephemeral logs but wrong for any file a sibling process reads concurrently. Helper in HME: `tools/HME/scripts/buddy_dispatcher.py:_atomic_write` is the canonical template.
- Liveness probe: PID-file consumers MUST distinguish stale PID files from live processes via `os.kill(pid, 0)` (Python) or `kill -0` (shell), with `PermissionError` treated as alive-but-other-user and `ProcessLookupError` as dead. Naked PID-file existence checks miss the stale-after-crash case and produce singleton-violations when the prior process died without cleanup. Helper: `_is_pid_alive` in `buddy_dispatcher.py`.
- Background-spawn discipline: any `cp.spawn` with `detached: true, stdio: 'ignore'` is a silent-failure-class antipattern — script crashes vanish, downstream metrics silently grow stale, no signal anywhere. The fix template lives in [main-pipeline.js bgScripts loop](scripts/pipeline/main-pipeline.js): pipe stderr to `log/hme-bg-<script>.err` (truncated per round) via an opened FD, keep `detached: true + unref()` so latency stays unblocked. Failures surface to the next `i/review` via the `pipeline-bg-script-health` HCI verifier. Every new bg-spawn site MUST follow this pattern; ad-hoc `stdio: 'ignore'` is a regression.
- Per-run diagnostics → `output/metrics/conductor-map.md`, `output/metrics/crosslayer-map.md`, `output/metrics/narrative-digest.md`, `output/metrics/trace-replay.json`, `output/metrics/runtime-snapshots.json`, `output/metrics/feedback-graph.html`
- Cross-run state → `output/metrics/adaptive-state.json`
- Feedback loop topology → [output/metrics/feedback_graph.json](../metrics/feedback_graph.json)
- Doc-drift on counted architectural claims → `python3 tools/HME/scripts/verify-numeric-drift.py` (surfaced via the `numeric-claim-drift` HCI verifier; catches stale "N hypermeta controllers" / "K verifiers" / "M feedback loops" claims across every `.md` when the code count shifts)
