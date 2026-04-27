# Polychron

Generative polyrhythmic composition engine. Two independent rhythmic layers interact through 64 cross-layer modules, governed by 27 trust-scored systems and 18 self-calibrating hypermeta controllers. Produces MIDI compositions with emergent musical behaviors arising from cross-system interaction.

7 feedback loops · 19 stutter variants · 12 CIM coordination dials · 27 ESLint rules

## Quick Start

```bash
npm install
npm run main   # lint, typecheck, compose, analyze metrics
npm run render # MIDI -> WAV via FluidSynth + FFmpeg
```

**Prerequisites:** Node.js 20+, Python 3, FluidSynth, FFmpeg, SF2 soundfont at `~/Downloads/SGM-v2.01-NicePianosGuitarsBass-V1.2.sf2`

**Lab experiments:**
```bash
node lab/run.js                    # run all sketches
node lab/run.js sketch-name        # run specific sketch
```

## Architecture Overview

The system has three interacting layers:

**Conductor** -- unified signal pipeline computing density, tension, and flicker products every beat. 37 registered recorders advance state. 18 hypermeta controllers self-calibrate coupling targets, thresholds, and gains. Tick L1-only to prevent polyrhythmic double-counting.

**Cross-Layer** -- 45 registered modules managing inter-layer dynamics: rhythmic complement (hocket/antiphony/canon), spectral gap-filling, velocity interference, articulation contrast, convergence detection, stutter contagion, and the Coordination Independence Manager (CIM) with 12 module-pair dials.

**Play Loop** -- alternates L1/L2 via `LM.activate()` with full per-layer state isolation (crossModulation, balance, flipBin). Each beat: conductor tick -> processBeat -> playNotes -> crossLayerBeatRecord -> trust/feedback updates.

Signal flow: [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md)

## Subsystems

- [src/utils/](src/utils/) — core utilities, registries, random, validation
- [src/conductor/](src/conductor/) — signal pipeline, profiles, dynamics, coupling, meta
- [src/rhythm/](src/rhythm/) — pattern generation, feedback listeners, drums
- [src/time/](src/time/) — LayerManager, tempo feel, timing
- [src/composers/](src/composers/) — 11 composer types, voice management, motif
- [src/fx/](src/fx/) — stutter (19 variants), binaural, balance, noise
- [src/crossLayer/](src/crossLayer/) — dynamics, harmony, rhythm, structure, trust, CIM
- [src/writer/](src/writer/) — CSV output, grandFinale
- [src/play/](src/play/) — beat loop, emission, layer passes

Details: [doc/SUBSYSTEMS.md](doc/SUBSYSTEMS.md)

## Key Systems

### Stutter Variant Ecosystem
19 note stutter variants selected per-beat by 12 weighted signal dimensions (regime, phase, articulation, harmonic distance, coupling labels, entropy reversal, call-response, phrase boundary, hocket mode, self-balancing frequency). Euclidean pattern gating (75%) + sustain-proportional probabilistic gate.

Details: [doc/STUTTER_SYSTEM.md](doc/STUTTER_SYSTEM.md)

### Coordination Independence Manager (CIM)
12 module-pair dials (0=independent, 1=coordinated) dynamically driven by regime, phase, topology, intent curves, and entropy. Phase-gated operation, chaos mode, oscillation mode. Controls rest synchronization, stutter contagion, spectral complementarity, phase lock, velocity interference, and more.

Details: [doc/COORDINATION_INDEPENDENCE.md](doc/COORDINATION_INDEPENDENCE.md)

### Hypermeta Self-Calibrating Controllers
18 controllers auto-tune coupling targets, regime distribution, pipeline centroids, flicker range, trust starvation, gain budgets, phase floors, pair ceilings, warmup ramps, and correlation shuffling. Health-gated evolution scaling. Structural discontinuity detection with fast reconvergence.

Details: [doc/HYPERMETA.md](doc/HYPERMETA.md)

### Trust Ecology
27 trust-scored cross-layer systems compete for influence via EMA-weighted payoffs. Trust dominance biases composer family selection and instrument palette. Starvation auto-nourishment prevents permanent module death. Trust velocity tracking with hysteresis.

Details: [doc/TRUST_ECOLOGY.md](doc/TRUST_ECOLOGY.md)

### Feedback Loops
7 registered closed-loop feedback controllers with resonance dampening. Correlation shuffler detects pathological correlations (reinforcement spirals, tug-of-war, stasis) and applies graduated perturbations. FeedbackOscillator creates multi-round-trip cross-layer energy loops with pitch class memory.

Details: [doc/FEEDBACK_LOOPS.md](doc/FEEDBACK_LOOPS.md)

### Adaptive Infrastructure
Cross-run warm-start via `output/metrics/adaptive-state.json`. Reconvergence accelerator detects structural discontinuities and spikes EMA alphas. Regime-adaptive alphas (3x on transition, decay 0.88/tick). Effectiveness-weighted convergence rates (proven controllers adapt faster).

Details: [doc/ADAPTIVE_INFRASTRUCTURE.md](doc/ADAPTIVE_INFRASTRUCTURE.md)

### Convergence Systems
Cross-layer onset convergence detection, harmonic burst triggers, velocity surges, memory histogram (learned rhythmic accent patterns), and convergence cascades (multi-system impact chains).

Details: [doc/CONVERGENCE_SYSTEMS.md](doc/CONVERGENCE_SYSTEMS.md)

## Layer Isolation

Two polyrhythmic layers (L1/L2) alternate via `LM.activate()`. Critical per-layer state: crossModulation, balance values, flipBin, stutter EMAs, emission metrics, journey boldness, arc types. Conductor recorders tick L1-only via registry gate. Per-layer flipBin prevents binaural detune desync.

Details: [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) (Layer Isolation section)

## Conductor Profiles

- `atmospheric` — dense, lush, high reverb/delay; canon-biased rhythm; oscillating threshold 0.14
- `explosive` — maximum energy, wide dynamics, aggressive stutter rates
- `restrained` — conservative density (0.25-0.42), low emission gates
- `minimal` — very sparse, near-silent, high stutter emission for texture
- `default` — balanced baseline
- `rhythmicDrive` — rhythm-forward, high subdivision counts

## Diagnostics

Generated per-run in `output/metrics/`:

- `trace-summary.json` — beats, regimes, signals, coupling, trust, axis energy
- `golden-fingerprint.json` — 10-dimension stability fingerprint
- `fingerprint-comparison.json` — run-over-run delta with STABLE/EVOLVED/DRIFTED verdict
- `narrative-digest.md` — prose composition story
- `runtime-snapshots.json` — CIM dials, stutter variant counts, shuffler state
- `adaptive-state.json` — cross-run warm-start EMAs
- `feedback_graph.json` — 7 feedback loop topology
- `conductor-map.md` — conductor intelligence map
- `crosslayer-map.md` — cross-layer topology

## Documentation

- [CLAUDE.md](CLAUDE.md) — coding rules, architectural boundaries, hard rules
- [doc/HME.md](doc/HME.md) — local semantic RAG + HME tool reference (invoked via `i/<tool>` shell wrappers)
- [doc/AGENT_PRIMER.md](doc/AGENT_PRIMER.md) — agent-facing walkthrough behavior
- [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) — beat lifecycle, signal flow, layer isolation
- [doc/TUNING_MAP.md](doc/TUNING_MAP.md) — feedback loop constants, cross-constant invariants
- [doc/HYPERMETA.md](doc/HYPERMETA.md) — 18 self-calibrating controllers
- [doc/STUTTER_SYSTEM.md](doc/STUTTER_SYSTEM.md) — 19 variants, selection, gating
- [doc/COORDINATION_INDEPENDENCE.md](doc/COORDINATION_INDEPENDENCE.md) — CIM 12 dials
- [doc/FEEDBACK_LOOPS.md](doc/FEEDBACK_LOOPS.md) — 11 loops, correlation shuffler
- [doc/ADAPTIVE_INFRASTRUCTURE.md](doc/ADAPTIVE_INFRASTRUCTURE.md) — warm-start, reconvergence
- [doc/TRUST_ECOLOGY.md](doc/TRUST_ECOLOGY.md) — 27 trust-scored systems
- [doc/CONVERGENCE_SYSTEMS.md](doc/CONVERGENCE_SYSTEMS.md) — convergence detection, cascades
- [doc/SUBSYSTEMS.md](doc/SUBSYSTEMS.md) — directory overview
- [doc/theory/README.md](doc/theory/README.md) — collection of theory essays about what drives Polychron

## Dependencies

- `@tonaljs/rhythm-pattern` -- Euclidean/binary/hex pattern generation
- Node.js built-ins only (no bundler, no transpiler)
- FluidSynth + FFmpeg for audio rendering (not required for composition)
