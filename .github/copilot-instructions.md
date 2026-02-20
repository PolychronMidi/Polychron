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
- To add a new global: create a side-effect module, require it from the subsystem's `index.js`, and declare it in `globals.d.ts`.

### 2. Fail Fast — Loud Crashes, Never Silent Corruption

Every module throws on bad input. No silent early returns. No `|| 0` fallbacks. No "graceful degradation." If a value can be absent, the *source* must guarantee it — not the consumer.

The **Validator** (`src/utils/validators.js`) is the immune system:
```js
const V = Validator.create('ModuleName');
const t = V.requireFinite(timeMs, 'timeMs'); // returns value or throws
```
Key methods: `requireFinite`, `requireDefined`, `requireType`, `requireEnum`, `assertRange`, `assertObject`, `assertArray`, `assertKeysPresent`, `assertAllowedKeys`, `getEventsOrThrow` (and more). Every thrown error is stamped with the module name for instant traceability.

### 3. Self-Registration — Modules Announce Themselves

New modules plug in by registering at load time. The hub iterates registrants — no `typeof` probes, no central file edits needed.

**Two registries:**

| Registry | Location | How to register |
|---|---|---|
| `CrossLayerRegistry` | `src/crossLayer/CrossLayerRegistry.js` | `CrossLayerRegistry.register(name, module, scopes)` where scopes ⊆ `['all','section','phrase']`. Lifecycle manager calls `resetAll/Section/Phrase` automatically. |
| `ConductorIntelligence` | `src/conductor/ConductorIntelligence.js` | `registerDensityBias(name, getter, lo, hi)`, `registerTensionBias(...)`, `registerFlickerModifier(...)`, `registerRecorder(name, fn)`, `registerStateProvider(name, getter)`. `GlobalConductorUpdate` collects all contributions each beat. |

**To add a new module:** write the file, self-register at the end of the IIFE, require it from the subsystem's `index.js`. Done.

### 4. Single-Manager Hub per Subsystem

Each subsystem has one `*Manager` (Façade + service locator) that composes lightweight helpers (registry, config, metrics, strategies). Helpers load first via `index.js`, then the manager. Managers assume helpers exist and fail fast if not.

- Algorithms → Strategy pattern (e.g., `SimplexNoise`)
- Configs → Factory methods (e.g., `noiseConfig`)
- Per-effect variants → Strategy implementations (e.g., stutterFade/pan/fx)

One manager per subsystem. Additional files are helpers, not more managers.

### 5. Small Files, One Responsibility

Target ≤ 200 lines. File name matches its main export. `const` and pure functions where possible; writable globals only where the project convention requires them (timing, play-state).

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
| `src/utils/` | Validator, clamps, randoms, MIDI data, instrumentation | `Validator.create()` |
| `src/conductor/` | ~65 intelligence modules (dynamics, harmonic, melodic, rhythmic, texture). Merged each beat into a single composite signal. | `ConductorIntelligence`, `GlobalConductorUpdate`, `ConductorState` |
| `src/rhythm/` | Pattern generators, onset makers, drum map, rhythm registry | `RhythmManager`, `RhythmRegistry` |
| `src/time/` | Tick/time math, polyrhythm calculator, layer manager, absolute-time grid | `AbsoluteTimeGrid`, `LayerManager` |
| `src/composers/` | Scale, chord, motif, voice-leading composers (one per file). Factory selects and blends. | `ComposerFactory` |
| `src/fx/` | Noise engine (simplex/fbm/worley) + stutter subsystem | `noiseManager`, `StutterManager` |
| `src/crossLayer/` | 33 modules coordinating L1↔L2 (phase lock, groove transfer, entropy regulation...) | `CrossLayerRegistry`, `crossLayerLifecycleManager` |
| `src/writer/` | CSV/MIDI output formatting | `grandFinale` |
| `src/play/` | Top-level loops: section → phrase → measure → beat → div → subdiv → subsubdiv | `main.js` |

---

## Code Style Summary

- **Language:** JavaScript (CommonJS), TypeScript checking via `tsc --noEmit`
- **Console output:** only script start, successful output, and temporary debug traces. Limited `console.warn('Acceptable warning: ...')` for long-run pulse checks.
- **No ad-hoc validation:** use `Validator`, not `typeof` / `|| []` / `|| 0`.
- **Globals are truth:** initialize correctly at the source. Never "sanitize" downstream.

---

*This document is the source of truth for project conventions. If anything contradicts the codebase, update this file.*
