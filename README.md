# Polychron

A generative polyrhythmic MIDI composition engine. Two independent metric layers evolve simultaneously, coordinated by cross-layer intelligence, a self-calibrating conductor system, and 27 trust-scored feedback loops. Music emerges through **emergent coherence** — 100+ independent observers nudge a shared signal field, and complex feedback loops resolve contradictions into musicality.

## Quick Start

```bash
npm install
npm run main          # full 18-stage pipeline: lint, typecheck, compose, analyze
npm run render        # CSV -> MIDI -> WAV (requires fluidsynth, ffmpeg, soundfont)
npm run render-lite   # same but 22050Hz for fast iteration
```

Composition output lands in `output/`, metrics in `metrics/`, logs in `log/`.

**Render prerequisites:** `python3`, `fluidsynth`, `ffmpeg`, soundfont at `~/Downloads/SGM-v2.01-NicePianosGuitarsBass-V1.2.sf2`

**Deterministic mode:** `npm run main -- --seed 42`

## Architecture

Polychron generates music through a three-layer nervous system:

```
CONDUCTOR  (42 intelligence modules, 16 hypermeta self-calibrating controllers)
    |  getSignals() / signalReader
    v
CROSS-LAYER  (44 modules: trust, negotiation, entropy, phase, rhythm, harmony)
    |  modified playProb / stutterProb
    v
PLAY LOOP  (section > phrase > measure > beat > div > subdiv > subsubdiv)
    |  note emission
    v
coherenceMonitor -> density correction bias -> back to CONDUCTOR
```

Three firewalls keep it musical:
1. **Top-down steering** — conductor sets climate, cross-layer orchestrates weather, play loop experiences it. No upward writes (ESLint-enforced).
2. **Network dampening** — every feedback loop registers with `feedbackRegistry`. Closed-loop controllers prevent resonance.
3. **Temporal decoupling** — modules communicate via `absoluteTimeGrid` channels, not direct calls.

For the full beat lifecycle, see [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md).

## Subsystems

| Subsystem | Files | Role |
|-----------|-------|------|
| `src/utils/` | 18 | Validator, randoms, MIDI data, feedback registry, trust system names |
| `src/conductor/` | 127 | 42 intelligence modules, dampening, normalization, coupling, profiles, config |
| `src/rhythm/` | 20 | Pattern generation, cross-modulation, phase-locked rhythm, drums |
| `src/time/` | 13 | absoluteTimeGrid (L0), layer management, meter pairs, tempo feel |
| `src/composers/` | 22+6dirs | 11 composers, chord system, motif system, voice leading, factory |
| `src/fx/` | 3+2dirs | Binaural beats, balance/FX, stutter system, noise engines |
| `src/crossLayer/` | 44 | Trust scores, negotiation, entropy, phase lock, rest sync, rhythm complement |
| `src/writer/` | 4 | grandFinale (CSV output), trace drain, logging |
| `src/play/` | 16 | main loop, processBeat (14-stage pipeline), note emission, beat recording |

For module-level detail, see [doc/SUBSYSTEMS.md](doc/SUBSYSTEMS.md).

## Signal Flow

Three pipelines collect multiplicative bias votes from registered modules:

- **Density** (30 biases) — note output probability
- **Tension** (20 biases) — harmonic tension and resolution
- **Flicker** (14 modifiers) — rhythmic variation and stutter

All three: dampened (`conductorDampening`) -> normalized (`pipelineNormalizer`) -> decorrelated (`pipelineCouplingManager`) -> committed to `conductorState` -> read via `signalReader`.

### Feedback Loops

Six registered + two advisory loops maintain coherence. See [doc/TUNING_MAP.md](doc/TUNING_MAP.md) for constants and interaction partners.

### Hypermeta Controllers

16 self-calibrating controllers auto-tune parameters that previously needed manual adjustment. Plus the regime classifier's intrinsic `coherentThresholdScale` self-balancer. Never hand-tune constants a meta-controller manages. See [doc/HYPERMETA.md](doc/HYPERMETA.md).

### Regime Detection

`systemDynamicsProfiler` classifies 6D phase-space trajectory into: **exploring** (searching), **coherent** (locked-in), **evolving** (developing), **drifting**, **oscillating** (stressed), **fragmented**, **stagnant**. Regime drives dampening strength, decorrelation aggressiveness, and profile adaptation.

## Composers

11 specialized composers selected per phrase by `FactoryManager` based on phase affinity, profile, and harmonic context:

ScaleComposer, ModeComposer, BluesComposer, ChromaticComposer, PentatonicComposer, QuartalComposer, HarmonicRhythmComposer, MelodicDevelopmentComposer, ModalInterchangeComposer, TensionReleaseComposer, VoiceLeadingComposer

Organized into 5 families: diatonicCore, harmonicMotion, development, tonalExploration, rhythmicDrive.

## Conductor Profiles

Six named profiles shape behavior: **default**, **minimal**, **atmospheric**, **explosive**, **restrained**, **rhythmicDrive**. Defined in `src/conductor/profiles/`.

## Configuration

Central config in `src/conductor/config.js`. Constants annotated by sensitivity tier:
- **@tier-1** — feedback loop constants (cross-system impact)
- **@tier-2** — musical texture (timbral/rhythmic/harmonic)
- **@tier-3** — structural defaults (safe to experiment)

Key values: `SECTIONS` {min:6, max:7}, `BPM` 72, `PPQ` 30000, `TUNING_FREQ` 432Hz, `BINAURAL` {min:8, max:12} (alpha range, imperceptible neurostimulation only).

## Build Pipeline

`npm run main` runs 18 stages: globals generation, boot-order verification, tuning invariant checks, hypermeta jurisdiction check, feedback graph generation+validation, lint (20 custom ESLint rules), typecheck, composition, trace summary, manifest health, dependency graph, conductor map, cross-layer map, golden fingerprint, narrative digest, run comparison, composition diff, feedback graph visualization.

## Lab

`lab/` is a playground for short experimental sketches:

```bash
node lab/run.js                    # run all sketches
node lab/run.js sketch-name        # run specific sketch
```

Sketches define config overrides, postBoot hooks, and optional custom `mainLoop` functions that bypass the normal composition engine. Combined WAVs land in `lab/` root for easy sampling. See `lab/sketches.js` for current experiments.

## Diagnostics

| Artifact | Format | Purpose |
|----------|--------|---------|
| `metrics/system-manifest.json` | JSON | Primary diagnostic source |
| `metrics/trace.jsonl` | JSONL | Per-beat trace (with `--trace`) |
| `metrics/trace-summary.json` | JSON | Statistical trace summary |
| `metrics/golden-fingerprint.json` | JSON | 7-dimension regression detection |
| `metrics/narrative-digest.md` | Markdown | Prose composition narrative |
| `metrics/conductor-map.md` | Markdown | Per-module intelligence map |
| `metrics/crosslayer-map.md` | Markdown | Cross-layer module map |
| `metrics/feedback-graph.html` | HTML | Interactive feedback graph |
| `metrics/journal.md` | Markdown | Evolution journal + lab findings |

**Trace replay:** `npm run replay -- --timeline|--stats|--section N|--layer L|--search K=V|--json`

**Live dashboard:** `npm run dashboard` (WebSocket on `:3377`)

**Regression detection:** golden fingerprint compares 7 dimensions per run — STABLE (0 drift), EVOLVED (1-2), DRIFTED (3+).

## Documentation

| Doc | Purpose |
|-----|---------|
| [README.md](README.md) | This overview |
| [.github/copilot-instructions.md](.github/copilot-instructions.md) | Coding rules for AI assistants |
| [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) | Beat lifecycle deep-dive |
| [doc/TUNING_MAP.md](doc/TUNING_MAP.md) | Feedback loop constants and invariants |
| [doc/SUBSYSTEMS.md](doc/SUBSYSTEMS.md) | Module-level subsystem detail |
| [doc/HYPERMETA.md](doc/HYPERMETA.md) | Self-calibrating controller reference |
| [metrics/journal.md](metrics/journal.md) | Evolution rounds + lab findings |

## Dependencies

- **`tonal`** (^6.4.2) — music theory (scales, chords, intervals)
- **`@tonaljs/rhythm-pattern`** (^1.0.0) — rhythm pattern generation

TypeScript (^5.9.3) and ESLint (^9.0.0) are dev dependencies. Type-checking via `tsc --noEmit` over JSDoc-annotated JavaScript.

## Resources

- [Tonal.js](https://github.com/tonaljs/tonal) — music theory library
- [CSV Maestro](https://github.com/i1li/csv_maestro) — custom MIDI CSV converter
- [SGM Soundfont](https://musical-artifacts.com/artifacts/855) — soundfont used by Polychron
