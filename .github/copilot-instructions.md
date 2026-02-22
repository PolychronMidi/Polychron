# Polychron — Project Guide

> A generative polyrhythmic MIDI composition engine.
> Two independent metric layers (L1/L2) evolve simultaneously,
> coordinated by cross-layer intelligence and a conductor system.

---

## Run

```bash
npm run main   # the ONE command — lint, typecheck, generate output
```

Wait for completion before acting on results. Output lands in `output/`.

---

## Five Core Principles

Everything in this project follows from five rules. Learn these and the rest is derivable.

### 1. Naked Globals via Side-Effect Require

Globals are the project's circulatory system. They are assigned as side-effects of `require()` calls in `index.js` files — never via `global.`, `globalThis.`, or `/* global */` comments (ESLint enforces this). All globals are declared in `src/types/globals.d.ts`.

- Always reference globals directly — never alias them into intermediary variables.
- To add a new global: create a side-effect module, require it from the subsystem's `index.js`, and declare it in `globals.d.ts`. That's it — **never hand-edit `VALIDATED_GLOBALS` in `fullBootstrap.js`**.
- **Single source of truth:** `src/types/globals.d.ts` is the canonical registry. `scripts/generate-globals-dts.js` runs automatically at the start of `npm run main` and rewrites the `VALIDATED_GLOBALS` array in `src/play/fullBootstrap.js` from it. `globals.d.ts` is never modified by the script.
- Boot validation: `mainBootstrap.assertBootstrapGlobals()` proves every `VALIDATED_GLOBALS` entry exists before the main loop runs. ESLint rule `local/no-typeof-validated-global` bans redundant `typeof` probes on these globals — reference them directly and trust the boot check.

### 2. Fail Fast — Loud Crashes, Never Silent Corruption

Every module throws on bad input. No silent early returns. No `|| 0` fallbacks. No "graceful degradation." If a value can be absent, the *source* must guarantee it — not the consumer.

The **Validator** (`src/utils/validators.js`) is the immune system:
```js
const V = Validator.create('ModuleName');
const t = V.requireFinite(timeMs, 'timeMs'); // returns value or throws
```
Key methods: `requireFinite`, `optionalFinite`, `requireDefined`, `requireType`, `requireEnum`, `assertRange`, `assertObject`, `assertPlainObject`, `assertArray`, `assertNonEmptyString`, `assertKeysPresent`, `assertAllowedKeys`, `getEventsOrThrow` (and more). Every thrown error is stamped with the module name for instant traceability.

Use `optionalFinite(val, fallback)` **only** for legitimately optional numerics (e.g., external prior weights). Never use it to paper over values that should always be present — use `requireFinite` for those.

### 3. Self-Registration — Modules Announce Themselves

New modules plug in by registering at load time. The hub iterates registrants — no `typeof` probes, no central file edits needed.

**Two registries:**

| Registry | Location | How to register |
|---|---|---|
| `CrossLayerRegistry` | `src/crossLayer/CrossLayerRegistry.js` | `CrossLayerRegistry.register(name, module, scopes)` where scopes ⊆ `['all','section','phrase']`. Lifecycle manager calls `resetAll/Section/Phrase` automatically. |
| `ConductorIntelligence` | `src/conductor/ConductorIntelligence.js` | `registerDensityBias(name, getter, lo, hi)`, `registerTensionBias(...)`, `registerFlickerModifier(...)`, `registerRecorder(name, fn)`, `registerStateProvider(name, getter)`, `registerModule(name, {reset}, scopes)` for lifecycle self-registration. `GlobalConductorUpdate` collects all contributions each beat. |

**To add a new module:** write the file, self-register at the end of the IIFE, require it from the subsystem's `index.js`. Done.

### 4. Single-Manager Hub per Subsystem

Each subsystem has one `*Manager` (Façade + service locator) that composes lightweight helpers (registry, config, metrics, strategies). Helpers load first via `index.js`, then the manager. Managers assume helpers exist and fail fast if not.

- Algorithms → Strategy pattern (e.g., `SimplexNoise`)
- Configs → Factory methods (e.g., `noiseConfig`)
- Per-effect variants → Strategy implementations (e.g., stutterFade/pan/fx)

One manager per subsystem. Additional files are helpers, not more managers.

When a file grows past ~200 lines, extract a focused helper as a new global loaded **before** the consumer in `index.js` (e.g., `emitPickCrossLayerRecord` extracted from `playNotesEmitPick`, `conductorConfigResolvers` extracted from `conductorConfig`). The consumer calls the helper directly — no import needed.

### 5. Coherent Files, One Responsibility

Target ≤ 200 lines of clean minimalist, self-documenting code (including structure-as-documentation), sparingly commented. File name matches its main export. `const` and pure functions where possible; writable globals only where the project convention requires them (timing, play-state).

---

## Code Style Summary

- **Language:** JavaScript (CommonJS), TypeScript checking via `tsc --noEmit`
- **Console output:** only script start, successful output, and temporary debug traces. Limited `console.warn('Acceptable warning: ...')` for long-run pulse checks.
- **No ad-hoc validation:** use `Validator`, not `typeof` / `|| []` / `|| 0` / `Number.isFinite(x) ? x : fallback`.
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
| `src/utils/` | Validator, clamps, randoms, MIDI data, instrumentation, shared priors infrastructure, shared lifecycle & caching | `Validator.create()`, `modeQualityMap`, `priorsHelpers`, `ModuleLifecycle.create()`, `beatCache.create()` |
| `src/conductor/` | ~70 intelligence modules (dynamics, harmonic, melodic, rhythmic, texture) + signal feedback infrastructure. Merged each beat into a single composite signal. | `ConductorIntelligence`, `signalReader`, `GlobalConductorUpdate`, `ConductorState` |
| `src/rhythm/` | Pattern generators, onset makers, drum map, rhythm registry | `RhythmManager`, `RhythmRegistry` |
| `src/time/` | Tick/time math, polyrhythm calculator, layer manager, absolute-time grid | `AbsoluteTimeGrid`, `LayerManager` |
| `src/composers/` | Scale, chord, motif, voice-leading composers (one per file). Factory selects and blends. | `ComposerFactory` |
| `src/fx/` | Noise engine (simplex/fbm/worley) + stutter subsystem | `noiseManager`, `StutterManager` |
| `src/crossLayer/` | 34 modules coordinating L1↔L2 (phase lock, groove transfer, entropy regulation, conductor signal bridge...) | `CrossLayerRegistry`, `crossLayerLifecycleManager`, `conductorSignalBridge` |
| `src/writer/` | CSV/MIDI output formatting | `grandFinale` |
| `src/play/` | Top-level loops: section → phrase → measure → beat → div → subdiv → subsubdiv | `main.js` |

---

## Signal & Feedback Topology

The conductor pipeline exposes runtime signal data for cross-module reading:

- **`signalReader`** (`src/conductor/signalReader.js`) — **the** standardized read API for inter-module signal reading. All modules read signals through `signalReader` (never call `ConductorIntelligence.getSignalSnapshot()` or `ExplainabilityBus.queryByType()` directly). Key methods: `density()`, `tension()`, `flicker()`, `state(field)`, `snapshot()`, `densityAttribution()`, `tensionAttribution()`, `flickerAttribution()`, `recentEvents(type, limit)`.
- **Product attribution** — `ConductorIntelligence.collectDensityBiasWithAttribution()` (and tension/flicker variants) returns `{ product, contributions: [{ name, raw, clamped }] }`. Enables any module to determine **which** peer is driving the composite signal.
- **`conductorSignalBridge`** (`src/crossLayer/conductorSignalBridge.js`) — refreshes each beat via a ConductorIntelligence recorder, exposes `getSignals()` returning `{ density, tension, flicker, compositeIntensity, sectionPhase, coherenceEntropy }` for cross-layer modules.
- **`profileAdaptation`** (`src/conductor/profileAdaptation.js`) — computes advisory `{ restrainedHint, explosiveHint, atmosphericHint }` from sustained signal conditions. Registered as both recorder and stateProvider.
- **`signalTelemetry`** (`src/conductor/signalTelemetry.js`) — ring buffer of 200 per-beat signal snapshots. `getHistory(n)`, `isAnomalyDetected()`, `getTrend()`. Registered as recorder + stateProvider.
- **`ExplainabilityBus.queryByType(type, limit)`** — filtered read of diagnostic entries by event type (most recent first).

---

## Shared Infrastructure Utilities

`src/utils/` provides two factory globals composed by multiple subsystems:

- **`ModuleLifecycle`** (`src/utils/ModuleLifecycle.js`) — `ModuleLifecycle.create(ownerName)` returns a scoped-reset registry. Composed by both `CrossLayerRegistry` and `ConductorIntelligence` for uniform lifecycle management. Modules self-declare which scopes they participate in (`all`, `section`, `phrase`) at registration time — no central reset list needed.
- **`beatCache`** (`src/utils/beatCache.js`) — `beatCache.create(fn)` wraps an expensive no-arg function so it runs at most once per beat (keyed on global `beatCount`). Use in any conductor module that registers both a bias getter and a stateProvider calling the same costly computation — eliminates redundant per-beat work.

---

## Music21 Integration & Shared Priors Infrastructure

`scripts/music21/` contains Python scripts for musicological analysis via Music21. Outputs `priorsData` files via `npm run music21`.

All four priors modules (`melodicPriors`, `harmonicPriors`, `voiceLeadingPriors`, `rhythmPriors`) share two utility globals loaded from `src/utils/`:

- **`modeQualityMap`** — canonical mode-to-quality map (`normalizeOrNull`, `normalizeOrFail`). Never duplicate this map in priors files.
- **`priorsHelpers`** — `resolvePhase(opts)`, `resolveWeightOrDefault(table, key, fallback)`, `weightedAdjustment(weight, scale)`. All priors modules delegate to these instead of local copies.

---
*This document is the source of truth for project conventions. If anything contradicts the codebase, update this file.*
