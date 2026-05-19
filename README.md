# Polychron

Generative polyrhythmic composition engine. Two independent rhythmic layers
interact through cross-layer musical systems, trust scoring, feedback loops, and
self-calibrating hypermeta controllers to produce MIDI compositions with
emergent structure.

Development has two interleaving domains:

- **Composition engine:** `src/`, documented from [doc/composition.md](doc/composition.md) into
  [doc/composition-full.md](doc/composition-full.md).
- **HME substrate:** `tools/HME/`, documented from [doc/self-coherence.md](doc/self-coherence.md) into
  [doc/self-coherence-full.md](doc/self-coherence-full.md).

HME reads project facts from [config/project-adapter.json](config/project-adapter.json).
A new project should be able to replace `src/` and `doc/composition.md`, then
update that adapter instead of editing HME internals.

[AGENTS.md](doc/templates/AGENTS.md) is the concise operational rule file loaded by agents.
Mechanical rules belong in lint, hooks, validators, and HME policies.

## Quick Start

```bash
npm install
npm run main
npm run render
```

Prerequisites: Node.js 20+, Python 3, FluidSynth, FFmpeg, and the SF2 soundfont
at `~/Downloads/SGM-v2.01-NicePianosGuitarsBass-V1.2.sf2`.

Lab sketches:

```bash
node src/lab/run.js
node src/lab/run.js sketch-name
```

## Core Structure

- **Conductor:** computes density, tension, flicker, regime, and other global
  signals. Hypermeta controllers tune thresholds, gains, and recovery behavior.
- **Cross-layer systems:** coordinate the two rhythmic layers through rhythm,
  harmony, dynamics, structure, trust, convergence, feedback, and CIM dials.
- **Play loop:** alternates L1/L2 with per-layer state isolation, emits notes,
  then records cross-layer outcomes back into trust and feedback systems.
- **HME:** proxy, event kernel, hooks, KB, verifiers, and `i/` commands that keep
  the codebase, docs, and agent loop coherent.

## Documentation Path

Read progressively:

1. [README.md](README.md) - project orientation.
2. [AGENTS.md](doc/templates/AGENTS.md) - agent rules and hard workflow discipline.
3. [doc/composition.md](doc/composition.md) - concise composition-engine rules.
4. [doc/self-coherence.md](doc/self-coherence.md) - concise HME rules and workflow.
5. [doc/composition-full.md](doc/composition-full.md) - detailed composition architecture.
6. [doc/self-coherence-full.md](doc/self-coherence-full.md) - detailed HME architecture.

Templates and long-form theory remain in [doc/templates/](doc/templates/) and
[doc/theory/](doc/theory/).

## Diagnostics

Hook/autocommit wiring and portability:

```bash
tools/HME/scripts/hme-doctor.py --hooks
tools/HME/scripts/hme-doctor.py --portable
```

Composition artifacts live in `src/output/metrics/`:

- `trace-summary.json` - beat, signal, regime, coupling, and trust summary.
- `fingerprint-comparison.json` - STABLE / EVOLVED / DRIFTED verdict.
- `runtime-snapshots.json` - live controller and cross-layer state.
- `adaptive-state.json` - warm-start state for the next run.
- `feedback_graph.json` - closed-loop topology.
- `narrative-digest.md` - prose composition summary.

HME telemetry lives in `tools/HME/runtime/metrics/`.

## Dependencies

- `@tonaljs/rhythm-pattern`
- Node.js built-ins
- FluidSynth + FFmpeg for rendering
