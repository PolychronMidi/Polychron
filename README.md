# Polychron

Generative polyrhythmic composition engine. Two independent rhythmic layers
interact through cross-layer musical systems, trust scoring, feedback loops, and
self-calibrating hypermeta controllers to produce MIDI compositions with
emergent structure.

Development has two interleaving domains:

- **Composition engine:** `src/`, documented from [doc/SRC.md](doc/SRC.md) into
  [doc/src_full.md](doc/src_full.md).
- **HME substrate:** `tools/HME/`, documented from [doc/HME.md](doc/HME.md) into
  [doc/hme_full.md](doc/hme_full.md).

[CLAUDE.md](CLAUDE.md) is the concise operational rule file loaded by agents.
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
node lab/run.js
node lab/run.js sketch-name
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
2. [CLAUDE.md](CLAUDE.md) - agent rules and hard workflow discipline.
3. [doc/SRC.md](doc/SRC.md) - concise composition-engine rules.
4. [doc/HME.md](doc/HME.md) - concise HME rules and workflow.
5. [doc/src_full.md](doc/src_full.md) - detailed composition architecture.
6. [doc/hme_full.md](doc/hme_full.md) - detailed HME architecture.

Templates and long-form theory remain in [doc/templates/](doc/templates/) and
[doc/theory/](doc/theory/).

## Diagnostics

Generated artifacts live in `output/metrics/`:

- `trace-summary.json` - beat, signal, regime, coupling, and trust summary.
- `fingerprint-comparison.json` - STABLE / EVOLVED / DRIFTED verdict.
- `runtime-snapshots.json` - live controller and cross-layer state.
- `adaptive-state.json` - warm-start state for the next run.
- `feedback_graph.json` - closed-loop topology.
- `narrative-digest.md` - prose composition summary.

## Dependencies

- `@tonaljs/rhythm-pattern`
- Node.js built-ins
- FluidSynth + FFmpeg for rendering
