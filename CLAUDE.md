# Polychron - Coding Rules

> Concise rules guide for AI assistants and contributors.
> For project overview and architecture, see [README.md](../README.md).

## Run

```bash
npm run main   # primary pipeline command - lint, typecheck, generate output, analyze metrics
npm run render # generate MIDI, render both layers to WAV, and mix output/combined.wav
```

Only use "npm run main" to run the full pipeline, never run individual pipeline scripts directly. The main command ensures all steps run in the correct order with necessary validations and context.

## Five Core Principles

### 1. Globals And Clean Self-Documenting Code

Globals are assigned as side-effects of `require()` calls in `index.js` files. Never use `global.`, `globalThis.`, or `/* global */` comments (ESLint-enforced).

- Reference globals directly - never alias into intermediary variables.
- To add a new global: create a side-effect module, require it from the subsystem's `index.js`, declare in `globals.d.ts`. **Never hand-edit `VALIDATED_GLOBALS`** - `scripts/generate-globals-dts.js` rewrites it automatically.
- Boot validation is **graduated**: critical globals throw on missing, advisory globals (annotated `/** @boot-advisory */` in `globals.d.ts`) warn only. ESLint `local/no-typeof-validated-global` bans redundant `typeof` probes.

### 2. Fail Fast - Loud Crashes, Never Silent Corruption

Every module throws on bad input. No silent early returns. No `|| 0` fallbacks. No graceful degradation.

Use `validator.create('ModuleName')` for all validation:
```js
const V = validator.create('ModuleName');
const ms = V.requireFinite(timeMs, 'timeMs');
```
Use `optionalFinite(val, fallback)` **only** for legitimately optional numerics.

### 3. Self-Registration

Modules self-register at load time. Two registries:
- **`crossLayerRegistry`** - `register(name, module, scopes)` where scopes ⊆ `['all','section','phrase']`
- **`conductorIntelligence`** - `registerDensityBias`, `registerTensionBias`, `registerFlickerModifier`, `registerRecorder`, `registerStateProvider`, `registerModule`

16 hypermeta self-calibrating controllers auto-tune coupling targets, regime distribution, pipeline centroids, flicker range, trust starvation, coherent relaxation, entropy amplification, progressive strength, gain budgets, meta-telemetry, inter-controller conflict detection, whole-system coupling energy homeostasis, axis-level energy equilibration (two-layer pair-hotspot + axis-balance with graduated coherent gate), phase energy floor (adaptive collapse detection and graduated boost), per-pair gain ceilings (adaptive ceiling from rolling p95 EMA), and section-0 warmup ramps (adaptive per-pair ramp from S0 exceedance history). The regime classifier additionally self-balances coherent share via auto-adjusting `coherentThresholdScale`. Never manually tune constants that a meta-controller already manages.

To add a module: write the file, self-register at end of IIFE, require from subsystem `index.js`.

### 4. Single-Manager Hub per Subsystem

One `*Manager` per subsystem (Facade + service locator). Helpers load first via `index.js`, then the manager. When a file exceeds ~200 lines, extract a focused helper loaded **before** the consumer.

### 5. Coherent Files, One Responsibility

Target ≤ 200 lines. File name matches main export. `const` and pure functions preferred. Comments reserved for complex logic. Only classes use PascalCase; everything else camelCase.

## Code Style Rules

- **Language:** JavaScript (CommonJS), TypeScript checking via `tsc --noEmit`
- **Console output:** script start, successful output, and temporary debug traces only. Limited `console.warn('Acceptable warning: ...')`.
- **No ad-hoc validation:** use `validator`, not `typeof` / `|| []` / `|| 0` / ternary fallbacks.
- **No typeof on boot-validated globals:** trust bootstrap; reference directly.
- **Globals are truth:** initialize correctly at the source. Never sanitize downstream.

## Load Order

`src/index.js` requires subsystems in this exact order:

```
utils - conductor - rhythm - time - composers - fx - crossLayer - writer - play
```

Each subsystem `index.js`: helpers first, then manager/orchestrator last.

## Architectural Boundaries

- **Cross-layer cannot write to conductor** - only local `playProb`/`stutterProb` modifications and `explainabilityBus` diagnostics.
- **Conductor cannot mutate cross-layer state** - read-only access via getters is fine; writes are banned (ESLint `local/no-direct-crosslayer-write-from-conductor`).
- **Signal reading:** always through `signalReader`, never `conductorIntelligence.getSignalSnapshot()` directly.
- **New feedback loops** must register with `feedbackRegistry` to prevent catastrophic resonance. Declare in `metrics/feedback_graph.json` and ensure `scripts/validate-feedback-graph.js` passes.
- **Trust system names:** always use `trustSystems.names.*` / `trustSystems.heatMapSystems.*` constants. Never hardcode trust name strings. Boot validation asserts completeness.
- **Cross-layer emission:** route all cross-layer buffer writes through `crossLayerEmissionGateway.emit(sourceModule, buffer, event)`. Never `push()` directly.
- **Meta-controller constants** (coupling targets, pair baselines, coherent relaxation, coherent threshold scale, progressive strength, flicker dampening base, axis energy distribution, global gain multiplier) are managed by hypermeta self-calibrating controllers. Never hand-tune these; modify the controller logic instead. Never set `coherentThresholdScale` per-profile -- the regime self-balancer owns it. Query topology via `metaControllerRegistry.getAll()` / `getById()` / `getByAxis()`.
- **Hypermeta-first rule (no whack-a-mole overrides):** Never add manual axis floors/caps/thresholds in `axisEnergyEquilibratorAxisAdjustments.js` SpecialCaps or similar locations. The 17 hypermeta controllers already manage all 6 axes. When an axis is suppressed or dominant, diagnose WHY the responsible controller isn't working and fix its logic (e.g., dead thresholds, asymmetric handlers, self-reinforcing decay). Pipeline script `check-hypermeta-jurisdiction.js` enforces this across 4 phases: Phase 1 (SpecialCaps overrides), Phase 2 (coupling matrix reads), Phase 3 (bias registration bounds lock — 92 registrations locked against `scripts/bias-bounds-manifest.json`), Phase 4 (5 watched controller-managed constants). New manual overrides, changed bias bounds, or watched constant violations cause pipeline failure. Legacy violations are allowlisted and tracked for removal. To update the bias manifest after legitimate structural changes: `node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds`.
- **Coupling matrix firewall:** Never read `.couplingMatrix` from `systemDynamicsProfiler.getSnapshot()` outside the coupling engine (`src/conductor/signal/balancing/`), meta-controllers (`src/conductor/signal/meta/`), profiler, diagnostics, or pipeline plumbing. Modules that need coupling awareness must register a bias via `conductorIntelligence` and respond through the controller chain. ESLint `local/no-direct-coupling-matrix-read` enforces this; `check-hypermeta-jurisdiction.js` Phase 2 detects violations at pipeline time. Legacy violations are allowlisted and tracked for removal.
- **Inter-module communication** via `absoluteTimeGrid` channels, not direct calls.

## Custom ESLint Rules

20 project-specific rules in `scripts/eslint-rules/`:

- **`case-conventions`** - PascalCase for classes, camelCase for everything else
- **`no-bare-math`** - ban direct `Math.*` access; use the project `m = Math` alias
- **`no-conductor-registration-from-crosslayer`** - prevent cross-layer modules from registering with conductor
- **`no-console-acceptable-warning`** - restrict `console.warn` to `'Acceptable warning: ...'` format
- **`no-direct-buffer-push-from-crosslayer`** - ban direct buffer `push()` in cross-layer modules (use `crossLayerEmissionGateway.emit()`)
- **`no-direct-conductor-state-from-crosslayer`** - prevent cross-layer modules from reading `conductorState` directly (must use `conductorSignalBridge`)
- **`no-direct-coupling-matrix-read`** - ban `.couplingMatrix` reads outside coupling engine, meta-controllers, and pipeline plumbing (use controller chain)
- **`no-direct-crosslayer-write-from-conductor`** - prevent conductor modules from mutating cross-layer state (read-only access allowed)
- **`no-direct-signal-read`** - ban `conductorIntelligence.getSignalSnapshot()` - use `signalReader`
- **`no-math-random`** - ban `Math.random()` - use project random sources
- **`no-non-ascii`** - ban non-ASCII characters in source
- **`no-requires-outside-index`** - restrict `require()` to `index.js` files
- **`no-silent-early-return`** - ban silent early returns - fail fast
- **`no-typeof-validated-global`** - ban `typeof` checks on boot-validated globals
- **`no-unregistered-feedback-loop`** - require feedback loop registration with `feedbackRegistry` (closedLoopController auto-registers)
- **`no-unstamped-validator`** - require module name stamp on `validator.create()`
- **`no-useless-expose-dependencies-comments`** - ban `/* expose-dependencies */` comments
- **`only-error-throws`** - require `throw new Error(...)` - no throwing strings/objects
- **`prefer-validator`** - prefer `validator` methods over ad-hoc `typeof`/`Number.isFinite`/`Array.isArray` guards
- **`validator-name-matches-filename`** - require validator stamp to match filename

## Hard Rules (Never Violate)

- **Binaural is imperceptible neurostimulation only.** Alpha range 8-12Hz. Never go below 8Hz or above 12Hz. Never experiment with binaural frequency. setBinaural runs from grandFinale post-loop walk ONLY, never from processBeat.
- **Never remove `tmp/run.lock`.** If a lock exists, it's because you abandoned a run without canceling it. Do not suggest, attempt, or execute removal. Enforced by PreToolUse hook + deny rule in `.claude/settings.json`.
- **Never delete unused code/config.** Unused constants are intentional design — wire them up and implement them.
- **"Review" = read-only analysis.** No code changes unless explicitly asked.
- **Comments are terse.** No essay comments, no verbose JSDoc. One-line inline only where logic isn't self-evident.

## Working Style

**Context budget:** When the context window has significant headroom (e.g. after compaction or early in a session), be greedy — use parallel research agents, read full files, investigate deeply, explore multiple approaches. Only economize context when window pressure is actually high or the task is clearly simple/familiar. Default to thoroughness; err on the side of over-researching rather than under-researching.

**Enforcement:** This file is loaded every prompt. The lock file deny rule in `.claude/settings.json` is the only mechanical hook — everything else is enforced by adherence to these instructions. If you find yourself violating a rule here, the fix is behavioral, not more memories or hooks.

Act on feedback immediately and thoroughly. Never summarize without fixing. Never make token changes when thorough investigation is needed. When given direction ("clear lab and build next round"), do the entire sequence without pausing to update or confirm. Investigate root causes of every bug surfaced — don't cherry-pick one and ignore the rest.

## Lab Findings (Calibration Anchors)

[metrics/journal.md](../metrics/journal.md) - Listening-confirmed constraints from lab sessions, with detailed descriptions and results. Use these to anchor calibration and validate that changes have the intended effect. Track whether changes took effect at all, and if so, whether the effect size is in the expected direction and magnitude. "Inconclusive" is a valid outcome when the effect is too small to confirm or deny with confidence, but "opposite effect" is a red flag that the change may not be working as intended, in which case it should be abandoned or revised.

## Related Documentation

- [README.md](../README.md) - Comprehensive project overview, architecture, subsystem details, diagnostics
- [doc/ARCHITECTURE.md](../doc/ARCHITECTURE.md) - Beat lifecycle deep-dive, signal flow from conductor to emission
- [doc/TUNING_MAP.md](../doc/TUNING_MAP.md) - Feedback loop constants, interaction partners, cross-constant invariants
- [metrics/journal.md](../metrics/journal.md) - Evolution journal with lab findings and calibration anchors
- [metrics/feedback_graph.json](../metrics/feedback_graph.json) - Feedback loop topology (source of truth for visualization). 6 loops, auto-generated by `scripts/generate-feedback-graph.js` and cross-validated by `scripts/validate-feedback-graph.js` on every pipeline run.
- `metrics/conductor-map.md` - Auto-generated conductor intelligence map (per-run)
- `metrics/crosslayer-map.md` - Auto-generated cross-layer intelligence map (per-run)
- `metrics/narrative-digest.md` - Auto-generated prose narrative (per-run)
- `metrics/feedback-graph.html` - Interactive feedback graph visualization (per-run)
