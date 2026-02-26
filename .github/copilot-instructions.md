# Polychron — Project Guide *This document is the source of truth for project conventions and overview. If anything contradicts the codebase, update this file.*

> A generative polyrhythmic MIDI composition engine.
> Two independent metric layers (L1/L2) evolve simultaneously,
> coordinated by cross-layer intelligence and a conductor system.

The system generates music through **emergent coherence** — not by simply planning notes, but by having 100+ independent observers each nudge a shared signal field, then letting feedback loops resolve contradictions into musicality. The complexity is real but the code is clean because every module follows five simple rules. Simplicity and complexity are not opposites when coherence is the medium between them.

---

## Run

```bash
npm run main   # the ONE command — lint, typecheck, generate output
```

Wait for completion before acting on results. Output lands in `output/`, logs in `log/`.

---

## Five Core Principles

Everything in this project follows from five rules. Learn these and the rest is derivable.

### 1. How To Avoid Anti-Patterns: Globals And Clean Self-Documenting Code

Globals are the project's circulatory system. They are assigned as side-effects of `require()` calls in `index.js` files — (never via `global.`, `globalThis.`, or `/* global */` comments, since this is considered a useless spam anti-pattern, and enforced with ESLint).

- Always reference globals directly — never alias them into intermediary variables.
- To add a new global: create a side-effect module (or update `init.js`), require it from the subsystem's `index.js`, and declare it in `globals.d.ts`. **Never hand-edit `VALIDATED_GLOBALS` in `fullBootstrap.js`** — `scripts/generate-globals-dts.js` rewrites it automatically from `globals.d.ts` at the start of `npm run main`.
- Boot validation (`mainBootstrap.assertBootstrapGlobals()`) proves every entry exists before the main loop. ESLint rule `local/no-typeof-validated-global` bans redundant `typeof` probes — reference globals directly and trust the boot check.

### 2. Fail Fast — Loud Crashes, Never Silent Corruption

Every module throws on bad input. No silent early returns. No `|| 0` fallbacks. No "graceful degradation." If a value can be absent, the *source* must guarantee it — not the consumer.

The **validator** (`src/utils/validator.js`) is the immune system:
```js
const V = validator.create('ModuleName');
const ms = V.requireFinite(timeMs, 'timeMs'); // returns value or throws
```
Key methods: `requireFinite`, `optionalFinite`, `requireDefined`, `requireType`, `requireEnum`, `assertRange`, `assertObject`, `assertArray`, `assertNonEmptyString`, `getEventsOrThrow` (and more). Every error is stamped with the module name.

Use `optionalFinite(val, fallback)` **only** for legitimately optional numerics — never to paper over values that should always be present.

### 3. Self-Registration — Modules Announce Themselves

New modules plug in by registering at load time. The hub iterates registrants — no `typeof` probes, no central file edits needed.

**Two registries:**

| Registry | Location | How to register |
|---|---|---|
| `crossLayerRegistry` | `src/crossLayer/crossLayerRegistry.js` | `crossLayerRegistry.register(name, module, scopes)` where scopes ⊆ `['all','section','phrase']`. Lifecycle manager calls `resetAll/Section/Phrase` automatically. |
| `conductorIntelligence` | `src/conductor/conductorIntelligence.js` | `registerDensityBias(name, getter, lo, hi)`, `registerTensionBias(...)`, `registerFlickerModifier(...)`, `registerRecorder(name, fn)`, `registerStateProvider(name, getter)`, `registerModule(name, {reset}, scopes)` for lifecycle self-registration. `globalConductorUpdate` collects all contributions each beat. |

**To add a new module:** write the file, self-register at the end of the IIFE, require it from the subsystem's `index.js`. Done.

### 4. Single-Manager Hub per Subsystem

Each subsystem has one `*Manager` (Façade + service locator) that composes lightweight helpers (registry, config, metrics, strategies). Helpers load first via `index.js`, then the manager. Managers assume helpers exist and fail fast if not.

- Algorithms → Strategy pattern (e.g., `SimplexNoise`)
- Configs → Factory methods (e.g., `noiseConfig`)
- Per-effect variants → Strategy implementations (e.g., stutterFade/pan/fx)

One manager per subsystem. Additional files are helpers, not more managers.

When a file grows past ~200 lines, extract a focused helper as a new global loaded **before** the consumer in `index.js` (e.g., `emitPickCrossLayerRecord` extracted from `playNotesEmitPick`, `conductorConfigResolvers` extracted from `conductorConfig`). The consumer calls the helper directly — no import needed.

### 5. Coherent Files, One Responsibility

Target ≤ 200 lines of clean minimalist, self-documenting code (including structure-as-documentation), sparingly commented. Detailed comments are reserved for complex logic or non-obvious decisions. File name matches its main export. `const` and pure functions where possible; writable globals only where the project convention requires them (timing, play-state). Only classes get their first name letter capitalized (pascal case), everything else must use standar camelCase.

---

## Code Style Summary

- **Language:** JavaScript (CommonJS), TypeScript checking via `tsc --noEmit`
- **Console output:** only script start, successful output, and temporary debug traces. Limited `console.warn('Acceptable warning: ...')` for long-run pulse checks.
- **No ad-hoc validation:** use `validator`, not `typeof` / `|| []` / `|| 0` / `Number.isFinite(x) ? x : fallback`.
- **No typeof on boot-validated globals:** ESLint enforces `local/no-typeof-validated-global`. Trust bootstrap; reference globals directly.
- **Globals are truth:** initialize correctly at the source. Never "sanitize" downstream.

---

## Load Order

`src/index.js` requires subsystems in this exact order — later modules depend on earlier globals:

```
utils → conductor → rhythm → time → composers → fx → crossLayer → writer → play
```

Each subsystem `index.js` loads: helpers first, then manager/orchestrator last.

---

## Subsystem Map

| Directory | Role | Key Entry Points |
|---|---|---|
| `src/utils/` | validator, clamps, randoms, MIDI data, instrumentation, shared priors infrastructure, shared lifecycle & caching | `validator.create()`, `modeQualityMap`, `priorsHelpers`, `moduleLifecycle.create()`, `beatCache.create()` |
| `src/conductor/` | ~70 intelligence modules (dynamics, harmonic, melodic, rhythmic, texture) + signal feedback infrastructure. Merged each beat into a single composite signal. | `conductorIntelligence`, `signalReader`, `globalConductorUpdate`, `conductorState` |
| `src/rhythm/` | Pattern generators, onset makers, drum map, rhythm registry | `rhythmManager`, `rhythmRegistry` |
| `src/time/` | Tick/time math, polyrhythm calculator, layer manager, absolute-time grid | `absoluteTimeGrid`, `LayerManager` |
| `src/composers/` | Scale, chord, motif, voice-leading composers (one per file). Factory selects and blends. | `FactoryManager` |
| `src/fx/` | Noise engine (simplex/fbm/worley) + stutter subsystem | `noiseManager`, `StutterManager` |
| `src/crossLayer/` | 35 modules coordinating L1↔L2 (phase lock, groove transfer, entropy regulation, conductor signal bridge...) | `crossLayerRegistry`, `crossLayerLifecycleManager`, `conductorSignalBridge` |
| `src/writer/` | CSV/MIDI output, diagnostic manifest & capability matrix, coherence verdicts | `grandFinale`, `systemManifest`, `coherenceVerdicts` |
| `src/play/` | Top-level loops: section → phrase → measure → beat → div → subdiv → subsubdiv | `main.js` |

---

## Signal & Feedback Topology

The system's nervous system has three layers: conductor (signal producer), cross-layer (layer coordinator), and play loop (executor + observer).

### Data Flow

```
┌─ Conductor ──────────────────────────────────────────────────────┐
│  ~74 intelligence modules each register:                         │
│    densityBias / tensionBias / flickerModifier → multiplicative   │
│    recorder → side-effect per beat                               │
│    stateProvider → fields merged into conductorState             │
│                                                                  │
│  globalConductorUpdate: collects products → compositeIntensity   │
│    ↓                                                             │
│  signalReader ─── the ONE read API for all signal consumers      │
│    ↓                                                             │
│  conductorSignalBridge (recorder) → caches snapshot each beat    │
└──────────────────────────────────────────────────────────────────┘
         ↓ getSignals() / signalReader.*()           ↑ explainabilityBus (diagnostic only)
┌─ Cross-Layer ────────────────────────────────────────────────────┐
│  32 modules coordinate L1↔L2 via:                                │
│    absoluteTimeGrid (shared temporal memory, see below)          │
│    negotiationEngine (conflict arbiter)                          │
│    adaptiveTrustScores (per-module trust weights, see below)     │
│    entropyRegulator (meta-conductor steering entropy to target)  │
│    explainabilityBus (ring buffer of typed diagnostic events)    │
└──────────────────────────────────────────────────────────────────┘
         ↓ eventBus events / modified playProb        ↑ NOTES_EMITTED, STUTTER_APPLIED
┌─ Play Loop ──────────────────────────────────────────────────────┐
│  section → phrase → measure → beat → div → subdiv → subsubdiv   │
│  processBeat: orchestrates cross-layer, emits notes, records     │
│  coherenceMonitor: compares actual vs intended note output       │
└──────────────────────────────────────────────────────────────────┘
```

### Four Feedback Loops

| Loop | Module | Mechanism |
|---|---|---|
| **Density correction** | `coherenceMonitor` | Compares actual note output vs intended density. Feeds correction bias back into density product. The system listens to its own song. |
| **Entropy steering** | `entropyRegulator` | Measures combined pitch/velocity/rhythmic entropy. Steers cross-layer systems toward a target curve driven by section position. |
| **Sustained-condition hints** | `profileAdaptation` | Watches for sustained low-density / high-tension / flat-flicker streaks. Produces advisory hints consumed by `conductorConfig`. |
| **Trust governance** | `adaptiveTrustScores` | EMA-based trust weights (0.4–1.8) per cross-layer module. Payoff table defined in `MAIN_LOOP_CONTROLS.trustPayoffs`. `negotiationEngine` reads weights to gate which systems act. |

### Deliberate Firewall

Cross-layer modules **cannot** directly influence density/tension/flicker products. They modify `playProb`/`stutterProb` locally and emit diagnostics to `explainabilityBus`. The conductor is insulated from cross-layer intelligence by design — feedback is delayed and diagnostic, not real-time closed-loop.

### absoluteTimeGrid — Shared Temporal Memory

`absoluteTimeGrid` is the organism's shared memory. Conductor and cross-layer modules `post()` data to named channels and `findClosest()` / `query()` by absolute millisecond time. Straddles time, conductor, and cross-layer subsystems.

**Key API:** `post(channel, layer, timeMs, data?)`, `query(channel, aroundMs, toleranceMs, opts?)`, `findClosest(channel, aroundMs, toleranceMs, excludeLayer?)`, `reset(channel?)`.

### Signal Reading & Diagnostics

- **`signalReader`** — the ONE read API. Methods: `density()`, `tension()`, `flicker()`, `state(field)`, `snapshot()`, `densityAttribution()`, `tensionAttribution()`, `flickerAttribution()`, `recentEvents(type, limit)`. Never call `conductorIntelligence.getSignalSnapshot()` directly.
- **`conductorSignalBridge`** — refreshes each beat via recorder; exposes `getSignals()` for cross-layer modules. Single chokepoint — liveness-asserted on reset.
- **`signalHealthAnalyzer`** — per-beat pipeline health (boundary saturation, multiplicative crush, pipeline saturation, trust starvation). Grades: `healthy`/`strained`/`stressed`/`critical`. Pure observation.
- **`systemDynamicsProfiler`** — phase-space trajectory analysis. Stores full 6D state (density, tension, flicker, entropy, trust, phase). Computes velocity, curvature, coupling strength, and effective dimensionality from only the 4 compositional dimensions (density, tension, flicker, entropy) — trust (governance meta-signal) and phase (monotonic sawtooth) are excluded from these derivative/aggregate metrics to prevent inflated curvature and confounded coupling. The full 6D coupling matrix is still computed for diagnostic exposure. Pre-differentiation EMA smoothing is adaptive: `stateSmoothing = clamp(0.175 / profileDensitySmoothing, 0.20, 0.40)`, targeting constant effective responsiveness across profiles (explosive 0.35, default 0.22, minimal 0.20). Coupling matrix uses raw (unsmoothed) trajectory to prevent EMA-inflated correlations. Regime classification: `exploring`/`coherent`/`evolving`/`drifting`/`oscillating`/`fragmented`/`stagnant`. Lifecycle scope: `all` (accumulates across sections). Pure observation.
- **`coherenceVerdicts`** — auto-diagnoses actionable findings (severity-graded critical/warning/info) from signal health, dynamics, attribution, trust, and coupling data. The system reflecting on its own coherence state.
- **`coherenceMonitor`** — closed-loop density feedback. Compares picks emitted vs picks intended (not MIDI events — `playNotes.js` tracks `picksEmitted` separately from the `scheduled` MIDI event counter). Feeds correction bias (0.60–1.30) back into density pipeline. Healthy when bias ≈ 1.0.
- **Output:** `system-manifest.json` (complete machine-readable record: config, topology, per-module attribution, health, dynamics, verdicts) + `capability-matrix.md` (human-readable diagnostic view + Coherence Verdicts section). Both emitted by `systemManifest.emit()` after composition. **Use `system-manifest.json` as the primary diagnostic data source**, not capability-matrix.md.

---

## Shared Infrastructure Utilities

- **`moduleLifecycle`** — `moduleLifecycle.create(ownerName)` returns a scoped-reset registry. Composed by both `crossLayerRegistry` and `conductorIntelligence`. Modules self-declare scopes (`all`, `section`, `phrase`) at registration.
- **`beatCache`** — `beatCache.create(fn)` wraps an expensive function to run at most once per beat (keyed on `beatCount`). Use when a module registers both a bias getter and a stateProvider calling the same computation.

---

## Music21 & Priors

`scripts/music21/` — Python scripts for musicological analysis via Music21. Run via `npm run music21`.

All four priors modules share two utility globals from `src/utils/`:
- **`modeQualityMap`** — canonical mode-to-quality map. Never duplicate in priors files.
- **`priorsHelpers`** — `resolvePhase(opts)`, `resolveWeightOrDefault(table, key, fallback)`, `weightedAdjustment(weight, scale)`.

---
