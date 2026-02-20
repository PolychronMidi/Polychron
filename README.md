# Polychron

Polychron is a generative polyrhythmic MIDI composition engine. It produces
dual-layer (L1/L2) musical pieces where two independent metric streams — each
with its own BPM, meter and rhythmic subdivisions — evolve simultaneously and
interact through a rich set of cross-layer intelligence modules.

## Quick start

```bash
npm install
npm run main          # the ONE command — builds, validates and generates output
```

Output lands in `output/` as CSV + MIDI files.

## Architecture overview

### Load-order spine

All source lives under `src/`. The master `src/index.js` requires subsystems in
a strict order so that naked globals are available to later modules:

```
utils → conductor → rhythm → time → composers → fx → crossLayer → writer → play
```

Each subsystem has its own `index.js` that loads helpers first, then managers.

### Three key abstractions

| Abstraction | Module | Purpose |
|---|---|---|
| **Naked globals** | various `index.js` | ~450 writable globals assigned via side-effect `require()`. Timing values (`tpBeat`, `beatStart`, etc.) and subsystem singletons (`ConductorState`, `HarmonicContext`, etc.) live here. |
| **AbsoluteTimeGrid** | `src/time/absoluteTimeGrid.js` | Shared cross-layer event bus. Modules `.post(channel, layer, absTimeMs, data)` and `.findClosest(channel, absTimeMs, tolerance, excludeLayer?)` to coordinate across the two metric streams. |
| **Validator** | `src/utils/validators.js` | Fail-fast contract enforcer. `Validator.create('Module')` returns a scoped instance; every method either returns the validated value or throws with the module name stamped in the error. |

### Subsystem map

| Directory | Role |
|---|---|
| `src/composers/` | Scale, chord, motif, voice-leading composers (one per file). `ComposerFactory` selects and blends them. |
| `src/conductor/` | ~65 intelligence modules across `dynamics/`, `harmonic/`, `melodic/`, `rhythmic/`, `texture/`. `GlobalConductorUpdate` collects their biases each beat; `ConductorState` publishes the merged signal. |
| `src/crossLayer/` | 33 modules that coordinate L1↔L2 interactions (phase lock, groove transfer, entropy regulation, etc.). `CrossLayerLifecycleManager` resets state at section/phrase boundaries. |
| `src/rhythm/` | Pattern generators, onset makers, drum map, rhythm registry. |
| `src/time/` | Tick/time conversions, polyrhythm calculator, layer manager, absolute-time grid. |
| `src/fx/` | Noise engine (simplex/fbm/worley) and stutter subsystem with manager/registry pattern. |
| `src/writer/` | CSV/MIDI output formatting and the grand-finale renderer. |
| `src/play/` | `main.js` — the top-level section→phrase→measure→beat→div→subdiv→subsubdiv loops for both layers. |

## Conventions

- **No `global.` / `globalThis.` / `/* global */`** — ESLint enforces this.
  All globals are declared in `src/types/globals.d.ts` and assigned via
  side-effect module loads.
- **Fail-fast** — loud throws, never silent fallbacks. Use `Validator.create()`
  for input validation; ad-hoc `typeof` / `|| 0` guards are prohibited.
- **Small files** — target ≤ 200 lines per file, one responsibility each.
- **Single-manager hub** per subsystem (FX, rhythm, etc.) — see
  `.github/copilot-instructions.md` for the full design-pattern guide.

## Project guidelines

See [`.github/copilot-instructions.md`](.github/copilot-instructions.md) for
the complete code-style guide, architectural conventions, and design patterns
that AI agents and contributors should follow.
