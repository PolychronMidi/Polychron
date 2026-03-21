# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-21T06:00:26.464Z | Trace data from: 2026-03-21T06:00:26.082Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **340 beats** spanning **39.8 seconds** of musical time.
Layer 1 experienced 144 beats; Layer 2 experienced 196 beats.

## Harmonic Journey

- **Section 1:** F lydian (origin)
- **Section 2:** F ionian (parallel-ionian)
- **Section 3:** F mixolydian (parallel-mixolydian (mode-shift))

## The System's Inner Life

The system spent most of its time **operating in harmony** (63.8% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 217 beats (63.8%) - operating in harmony
- **`exploring`** - 114 beats (33.5%) - searching for coherence
- **`initializing`** - 6 beats (1.8%) - warming up
- **`evolving`** - 3 beats (0.9%) - developing new musical ideas

### Regime Transitions

The system underwent **6 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 9: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 69: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 132: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 222: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 275: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **340 beat entries**, but the regime controller advanced on only **132 measure-recorder ticks**.
**208** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **109** traced entries.
On the controller cadence, resolved regime time was: `coherent` 87, `exploring` 58, `evolving` 4.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **19.1%** changing samples, and average phase-coupling coverage **41.8%**.
The longest stale phase run was **6** beats, **274** entries carried stale pair telemetry, and **198** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **568 available**, **768 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 192 variance-gated), **tension-phase** (0 stale, 192 variance-gated), **flicker-phase** (0 stale, 192 variance-gated).
Telemetry health scored **0.477** with **3** under-seen controller pairs and reconciliation gap **0.581**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.581), **flicker-trust** (gap 0.462), **density-entropy** (gap 0.081).

## Signal Landscape

**Density** ranged from 0.27 to 0.51 (avg 0.42). The density was balanced.
**Tension** ranged from 0.05 to 0.62 (avg 0.54). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.91 to 1.14 (avg 1.01). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.51 (weight 1.38, trusted)
- **phaseLock**: average score 0.41 (weight 1.31, trusted)
- **stutterContagion**: average score 0.38 (weight 1.28, trusted)
- **entropyRegulator**: average score 0.28 (weight 1.21, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-flicker**: avg |r| = 0.562, peak |r| = 0.990
- **tension-entropy**: avg |r| = 0.502, peak |r| = 0.887

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.932).

## Output

- **Layer 1:** 4914 notes
- **Layer 2:** 6569 notes
- **Load:** 11483 total notes, 45.03 notes per traced beat, 288.28 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **3 informational** findings.

### Warnings

- flicker-entropy strongly anti-correlated (r=-0.782) - these dimensions may be driven by a shared input or feedback loop.
- 7 density contributors suppressing with constant drag: regimeReactiveDamping (1.12), pipelineCouplingManager (0.84), harmonicRhythmDensityRatio (0.88), syncopationDensityTracker (0.88), climaxProximityPredictor (1.09), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
