# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T18:47:30.988Z | Trace data from: 2026-03-23T18:47:30.473Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **590 beats** spanning **86.5 seconds** of musical time.
Layer 1 experienced 264 beats; Layer 2 experienced 326 beats.

## Harmonic Journey

- **Section 1:** D mixolydian (origin)
- **Section 2:** F# major (relative-major (key-shift))
- **Section 3:** G# major (step-up)
- **Section 4:** D major (tritone-sub)
- **Section 5:** E major (step-up (key-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (68.8% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 406 beats (68.8%) - searching for coherence
- **`coherent`** - 165 beats (28.0%) - operating in harmony
- **`evolving`** - 15 beats (2.5%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **8 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 58: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 312: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 318: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 451: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 531: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 555: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **590 beat entries**, but the regime controller advanced on only **237 measure-recorder ticks**.
**353** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **195** traced entries.
On the controller cadence, resolved regime time was: `exploring` 209, `coherent` 49, `evolving` 13.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **30.5%** changing samples, and average phase-coupling coverage **39.1%**.
The longest stale phase run was **6** beats, **409** entries carried stale pair telemetry, and **359** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **924 available**, **1420 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 355 variance-gated), **tension-phase** (0 stale, 355 variance-gated), **flicker-phase** (0 stale, 355 variance-gated).
Telemetry health scored **0.426** with **3** under-seen controller pairs and reconciliation gap **0.174**.
The worst controller/trace reconciliation gaps remained in **flicker-trust** (gap 0.174), **density-flicker** (gap 0.169), **density-trust** (gap 0.111).

## Signal Landscape

**Density** ranged from 0.30 to 0.73 (avg 0.52). The density was balanced.
**Tension** ranged from 0.06 to 1.00 (avg 0.72). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.78 to 1.09 (avg 0.87). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.56 (weight 1.42, trusted)
- **phaseLock**: average score 0.46 (weight 1.35, trusted)
- **stutterContagion**: average score 0.41 (weight 1.31, trusted)
- **entropyRegulator**: average score 0.31 (weight 1.24, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, trusted)
- **restSynchronizer**: average score 0.25 (weight 1.19, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **roleSwap**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **density-flicker** (0.887).

## Output

- **Layer 1:** 10100 notes
- **Layer 2:** 12347 notes
- **Load:** 22447 total notes, 50.10 notes per traced beat, 259.50 notes per second

## Coherence Verdicts

The system issued **1 critical**, **5 warning**, and **6 informational** findings.

### Critical Findings

- density pipeline saturated - product hitting floor/ceiling.

### Warnings

- density pipeline stressed - crush factor 57%.
- density product soft-floored at 0.4775 (raw 0.4762) - soft envelope compressing low product.
- tension product soft-capped at 1.4725 (raw 1.4900) - soft envelope compressing high product.
- 8 density contributors suppressing with constant drag: pipelineCouplingManager (0.81), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), syncopationDensityTracker (0.88), climaxProximityPredictor (0.82), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.20), pipelineCouplingManager (1.13), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.15), harmonicDensityOscillator (1.08), harmonicSurpriseIndex (1.16), harmonicVelocityMonitor (0.88), repetitionFatigueMonitor (1.12). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
