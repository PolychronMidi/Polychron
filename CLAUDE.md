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

The 19 hypermeta self-calibrating controllers manage all 6 axes and own coupling targets, regime distribution, pipeline centroids, flicker range, trust starvation, coherent relaxation, entropy amplification, progressive strength, gain budgets, axis equilibration, phase energy floor, per-pair gain ceilings, section-0 warmup ramps, and `coherentThresholdScale`.

- **Never hand-tune meta-controller constants.** Modify the controller logic instead.
- **Never set `coherentThresholdScale` per-profile** — the regime self-balancer owns it.
- **Never add manual axis floors/caps/thresholds** (e.g. SpecialCaps in `axisEnergyEquilibratorAxisAdjustments.js`). When an axis is suppressed/dominant, diagnose WHY the responsible controller isn't working and fix its logic.
- **Coupling matrix firewall:** never read `.couplingMatrix` from `systemDynamicsProfiler.getSnapshot()` outside the coupling engine, meta-controllers, profiler, diagnostics, or pipeline plumbing. Modules needing coupling awareness register a bias via `conductorIntelligence` and respond through the controller chain (`local/no-direct-coupling-matrix-read`).
- **Bias bounds are locked:** 93 registrations validated against `scripts/bias-bounds-manifest.json`. Snapshot after legitimate structural changes: `node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds`.

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
- **Never remove `tmp/run.lock`.** A lock means a run was abandoned without canceling. Do not suggest, attempt, or execute removal. Enforced by PreToolUse hook + deny rule.
- **Never delete unused code/config before checking if it should be implemented.** Only delete code that can't be reasonably adapted and whose concerns are already covered elsewhere. Otherwise, wire it up and implement.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Never abandon a plan mid-execution.** Finish the current atomic unit before pivoting. If user feedback changes direction, explicitly acknowledge the pivot, state what was left undone, and confirm before switching. Never leave code/tools in a broken intermediate state. Clarifying questions belong BEFORE starting implementation. Atomic units: a file sweep is not done until every file in scope is fixed; a merge is not done until the routing logic exists; a KB cleanup is not done until every candidate entry has been processed.

## Working Style

- **User messages via system-reminder:** respond immediately. Do not wait for any running process or tool call to finish first. Drop everything and reply now. Resume prior work after responding, unless the message says to stop.
- **Context budget:** when the window has headroom, be greedy — use parallel research agents, read full files, investigate deeply. Only economize when window pressure is high or the task is clearly trivial. Default to thoroughness.
- **Auto-commits:** after each verified non-regressive pipeline run (STABLE or EVOLVED), auto-commit all changed files with format `RXX: brief description`. Do not commit DRIFTED runs or failed pipelines.
- **Act on feedback immediately and thoroughly.** Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction ("clear lab and build next round"), do the entire sequence without pausing. Investigate root causes of every bug surfaced — don't cherry-pick one and ignore the rest.
- **If you find yourself violating a rule here, the fix is behavioral, not more memories or hooks.**
- **Memories are deprecated. Never read from or write to `.claude/projects/*/memory/` (incl. `MEMORY.md`).** Memory is the wrong abstraction for this project — it's invisible to the rest of the system, can't be semantically searched, accumulates without retirement, and tends to accrete "reminder-to-self" entries instead of real behavioral fixes. HME KB is the canonical cross-session knowledge store: `i/learn title="…" content="…" category=pattern` to persist, `i/learn query="…"` to retrieve. Rule-level directives (what-you-should-always-do) belong in CLAUDE.md, not KB, not memory. Pretooluse hooks (Read/Write/Edit) and proxy middleware enforce this; if any slips through, the fix is to route it to KB, not to add it back to memory.
- **Exhaust protocol for open-ended HME rounds.** When the user has signalled continuous motion on HME/chat/tooling ("improve X", "make HME more Y", "do followups"), do not stop after the first landing to ask "anything missing?" or wait for "do all". In the same turn, enumerate remaining gaps honestly (include items you deferred, items an audit would surface, anti-patterns like silent failures/duplicate writers/hardcoded magics/missing tests) and proceed through them. Stop only when remaining items are (a) genuinely low-leverage polish, (b) require architectural decisions the user owns, or (c) require machine access you don't have. KB entry `dae793e748f9` has the full rationale and anchors; narrow-scope user prompts ("rename foo to bar") explicitly override this.

## HyperMeta Mandatory Workflow

All HME tools are invoked via executable shell wrappers in `i/` (e.g. `i/review`, `i/trace`). The proxy middleware owns MCP transport; Claude no longer connects to an MCP server. Full reference: [doc/HME.md](../doc/HME.md).

- **After implementing changes:** `i/review mode=forget` — auto-detects changed files from git. Checks KB constraints, boundary rules, new L0 channels, doc update needs.
- **After each listen-confirmed round:** `i/learn title="…" content="…" category=pattern` for calibration anchors. Do NOT add until user confirms task complete. If the user gives a listening verdict, also record it as ground truth: `i/learn action=ground_truth title=<SECTION> tags=[moment_type,sentiment] content=<COMMENT> query=<ROUND>` — lands in `output/metrics/hme-ground-truth.jsonl`, mirrored into KB with unconditional HIGH trust tier.
- **Close the round window:** between the user's pipeline run and querying `i/status` (budget/coherence/trajectory modes), emit `python3 tools/HME/activity/emit.py --event=round_complete --session=RNN --verdict=STABLE` so the activity bridge's coherence score isn't polluted by pre-round instrumentation edits. The `stop.sh` hook does this at turn end automatically; do it manually mid-turn.
- **When pipeline fails:** read pipeline output, fix root cause. `i/hme-read target=<moduleName> mode=before` on the failing file.

## Reference Pointers

- Lab calibration anchors → [output/metrics/journal.md](../metrics/journal.md)
- ESLint rules (24) → `scripts/eslint-rules/` (enforced at lint time; no need to memorize)
- Per-run diagnostics → `output/metrics/conductor-map.md`, `output/metrics/crosslayer-map.md`, `output/metrics/narrative-digest.md`, `output/metrics/trace-replay.json`, `output/metrics/runtime-snapshots.json`, `output/metrics/feedback-graph.html`
- Cross-run state → `output/metrics/adaptive-state.json`
- Feedback loop topology → [output/metrics/feedback_graph.json](../metrics/feedback_graph.json)
