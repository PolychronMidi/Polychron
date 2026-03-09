# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T15:43:18.577Z | Trace data from: 2026-03-09T15:43:18.035Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **539 beats** spanning **81.9 seconds** of musical time.
Layer 1 experienced 246 beats; Layer 2 experienced 293 beats.

## Harmonic Journey

- **Section 1:** F# dorian (origin)
- **Section 2:** B dorian (fourth-up)
- **Section 3:** B major (parallel-major (diversity))

## The System's Inner Life

The system spent most of its time **operating in harmony** (52.5% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 283 beats (52.5%) - operating in harmony
- **`exploring`** - 247 beats (45.8%) - searching for coherence
- **`initializing`** - 6 beats (1.1%) - warming up
- **`evolving`** - 3 beats (0.6%) - developing new musical ideas

### Regime Transitions

The system underwent **8 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 9: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 49: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 278: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 383: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 401: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 477: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 479: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **539 beat entries**, but the regime controller advanced on only **187 measure-recorder ticks**.
**352** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **196** traced entries.
On the controller cadence, resolved regime time was: `coherent` 120, `exploring` 93, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **35.1%** changing samples, and average phase-coupling coverage **17.8%**.
The longest stale phase run was **6** beats, **349** entries carried stale pair telemetry, and **443** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **384 available**, **1748 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 437 variance-gated), **tension-phase** (0 stale, 437 variance-gated), **flicker-phase** (0 stale, 437 variance-gated).
Telemetry health scored **0.381** with **2** under-seen controller pairs and reconciliation gap **0.145**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.145), **density-trust** (gap 0.116).

## Signal Landscape

**Density** ranged from 0.28 to 0.67 (avg 0.45). The density was balanced.
**Tension** ranged from 0.06 to 0.71 (avg 0.45). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.87 to 1.15 (avg 0.95). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.48 (weight 1.36, trusted)
- **entropyRegulator**: average score 0.46 (weight 1.34, trusted)
- **stutterContagion**: average score 0.38 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.22 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.20 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **tension-entropy**: avg |r| = 0.576, peak |r| = 0.937

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **tension-entropy** (0.921).

## Output

- **Layer 1:** 10639 notes
- **Layer 2:** 11360 notes
- **Load:** 21999 total notes, 50.11 notes per traced beat, 268.71 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- tension-entropy strongly anti-correlated (r=-0.827) - these dimensions may be driven by a shared input or feedback loop.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
