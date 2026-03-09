# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T08:29:35.713Z | Trace data from: 2026-03-09T08:29:35.146Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **atmospheric** conductor profile.

The system processed **600 beats** spanning **80.7 seconds** of musical time.
Layer 1 experienced 291 beats; Layer 2 experienced 309 beats.

## Harmonic Journey

- **Section 1:** E mixolydian (origin)
- **Section 2:** B mixolydian (fifth-up)
- **Section 3:** D# major (relative-major (mode-shift))
- **Section 4:** F# minor (relative-minor (mode-shift))
- **Section 5:** A# major (relative-major (mode-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (92.7% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 556 beats (92.7%) - searching for coherence
- **`coherent`** - 25 beats (4.2%) - operating in harmony
- **`evolving`** - 15 beats (2.5%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 37: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 514: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 521: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)

### Controller Cadence

The emitted trace contains **600 beat entries**, but the regime controller advanced on only **222 measure-recorder ticks**.
**378** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **212** traced entries.
On the controller cadence, resolved regime time was: `exploring` 218, `coherent` 27, `evolving` 8.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **36.0%** changing samples, and average phase-coupling coverage **63.5%**.
The longest stale phase run was **6** beats, **383** entries carried stale pair telemetry, and **219** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1524 available**, **860 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 215 variance-gated), **tension-phase** (0 stale, 215 variance-gated), **flicker-phase** (0 stale, 215 variance-gated).
Telemetry health scored **0.507** with **5** under-seen controller pairs and reconciliation gap **0.437**.
The worst controller/trace reconciliation gaps remained in **tension-phase** (gap 0.437), **flicker-phase** (gap 0.411), **density-trust** (gap 0.264).

## Signal Landscape

**Density** ranged from 0.34 to 0.86 (avg 0.59). The density was balanced.
**Tension** ranged from 0.06 to 0.90 (avg 0.54). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.77 to 1.17 (avg 0.94). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.57 (weight 1.43, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.40 (weight 1.30, trusted)
- **stutterContagion**: average score 0.39 (weight 1.29, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.21 (weight 1.16, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **flicker-phase** (0.949).

## Output

- **Layer 1:** 11000 notes
- **Layer 2:** 11701 notes
- **Load:** 22701 total notes, 54.44 notes per traced beat, 281.27 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **5 informational** findings.

### Warnings

- 7 density contributors suppressing with constant drag: coherenceMonitor (1.15), regimeReactiveDamping (0.89), pipelineCouplingManager (0.85), intervalBalanceTracker (0.92), syncopationDensityTracker (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
