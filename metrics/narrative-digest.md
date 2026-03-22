# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-22T17:20:30.668Z | Trace data from: 2026-03-22T17:20:30.150Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **562 beats** spanning **73.1 seconds** of musical time.
Layer 1 experienced 252 beats; Layer 2 experienced 310 beats.

## Harmonic Journey

- **Section 1:** E aeolian (origin)
- **Section 2:** E minor (parallel-minor)
- **Section 3:** G# major (relative-major (mode-shift))
- **Section 4:** B minor (relative-minor (mode-shift))
- **Section 5:** B aeolian (parallel-aeolian (mode-shift))

## The System's Inner Life

The system spent most of its time **operating in harmony** (52.3% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 294 beats (52.3%) - operating in harmony
- **`exploring`** - 258 beats (45.9%) - searching for coherence
- **`evolving`** - 6 beats (1.1%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **9 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 10: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 73: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 169: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 223: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 242: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 338: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 401: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 486: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **562 beat entries**, but the regime controller advanced on only **227 measure-recorder ticks**.
**335** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **190** traced entries.
On the controller cadence, resolved regime time was: `exploring` 143, `coherent` 120, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **32.9%** changing samples, and average phase-coupling coverage **34.9%**.
The longest stale phase run was **6** beats, **376** entries carried stale pair telemetry, and **366** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **784 available**, **1448 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 362 variance-gated), **tension-phase** (0 stale, 362 variance-gated), **flicker-phase** (0 stale, 362 variance-gated).
Telemetry health scored **0.409** with **2** under-seen controller pairs and reconciliation gap **0.366**.
The worst controller/trace reconciliation gaps remained in **flicker-trust** (gap 0.366), **flicker-entropy** (gap 0.098).

## Signal Landscape

**Density** ranged from 0.26 to 0.66 (avg 0.45). The density was balanced.
**Tension** ranged from 0.05 to 0.63 (avg 0.51). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.90 to 1.14 (avg 1.01). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.48 (weight 1.36, trusted)
- **stutterContagion**: average score 0.40 (weight 1.30, trusted)
- **entropyRegulator**: average score 0.38 (weight 1.29, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.20 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.891), **flicker-trust** (0.885).

## Output

- **Layer 1:** 9820 notes
- **Layer 2:** 11721 notes
- **Load:** 21541 total notes, 48.74 notes per traced beat, 294.49 notes per second

## Coherence Verdicts

The system issued **0 critical**, **3 warning**, and **3 informational** findings.

### Warnings

- tension-entropy strongly co-evolving (r=0.724) - these dimensions may be driven by a shared input or feedback loop.
- density-tension strongly anti-correlated (r=-0.723) - these dimensions may be driven by a shared input or feedback loop.
- 8 density contributors suppressing with constant drag: regimeReactiveDamping (1.12), pipelineCouplingManager (1.16), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), syncopationDensityTracker (0.88), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
