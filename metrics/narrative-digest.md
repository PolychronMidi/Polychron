# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-24T01:49:09.613Z | Trace data from: 2026-03-24T01:49:08.967Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **765 beats** spanning **99.8 seconds** of musical time.
Layer 1 experienced 360 beats; Layer 2 experienced 405 beats.

## Harmonic Journey

- **Section 1:** A# minor (origin)
- **Section 2:** D major (relative-major)
- **Section 3:** F minor (relative-minor (repeat-escape))
- **Section 4:** G# lydian (tritone-sub (key-shift))
- **Section 5:** C major (relative-major (mode-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (72.9% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 558 beats (72.9%) - searching for coherence
- **`coherent`** - 157 beats (20.5%) - operating in harmony
- **`evolving`** - 46 beats (6.0%) - developing new musical ideas
- **`initializing`** - 4 beats (0.5%) - warming up

### Regime Transitions

The system underwent **9 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 16: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 73: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 178: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 203: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 381: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 390: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 560: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 661: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **765 beat entries**, but the regime controller advanced on only **328 measure-recorder ticks**.
**437** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **285** traced entries.
On the controller cadence, resolved regime time was: `exploring` 285, `coherent` 72, `evolving` 18.
The controller recorded **3 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **26.4%** changing samples, and average phase-coupling coverage **17.5%**.
The longest stale phase run was **6** beats, **562** entries carried stale pair telemetry, and **631** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **536 available**, **2508 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 627 variance-gated), **tension-phase** (0 stale, 627 variance-gated), **flicker-phase** (0 stale, 627 variance-gated).
Telemetry health scored **0.407** with **2** under-seen controller pairs and reconciliation gap **0.306**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.306), **tension-flicker** (gap 0.242).

## Signal Landscape

**Density** ranged from 0.28 to 0.74 (avg 0.53). The density was balanced.
**Tension** ranged from 0.06 to 0.99 (avg 0.74). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.78 to 1.13 (avg 0.88). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.50 (weight 1.38, trusted)
- **stutterContagion**: average score 0.43 (weight 1.32, trusted)
- **phaseLock**: average score 0.43 (weight 1.32, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **entropyRegulator**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.19 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **flicker-trust** (0.857).

## Output

- **Layer 1:** 14497 notes
- **Layer 2:** 15509 notes
- **Load:** 30006 total notes, 52.09 notes per traced beat, 300.80 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- 7 density contributors suppressing with constant drag: regimeReactiveDamping (0.89), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), syncopationDensityTracker (0.88), climaxProximityPredictor (0.82), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
