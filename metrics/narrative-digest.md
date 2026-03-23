# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T23:51:36.831Z | Trace data from: 2026-03-23T23:51:36.291Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **609 beats** spanning **80.3 seconds** of musical time.
Layer 1 experienced 235 beats; Layer 2 experienced 374 beats.

## Harmonic Journey

- **Section 1:** C# lydian (origin)
- **Section 2:** F# lydian (fourth-up (key-shift))
- **Section 3:** B lydian (fourth-up)
- **Section 4:** C# lydian (step-up (repeat-escape))
- **Section 5:** G# lydian (fifth-up (repeat-escape))

## The System's Inner Life

The system spent most of its time **searching for coherence** (78.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 478 beats (78.5%) - searching for coherence
- **`coherent`** - 98 beats (16.1%) - operating in harmony
- **`evolving`** - 29 beats (4.8%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 28: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 128: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 380: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 385: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)

### Controller Cadence

The emitted trace contains **609 beat entries**, but the regime controller advanced on only **205 measure-recorder ticks**.
**404** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **163** traced entries.
On the controller cadence, resolved regime time was: `exploring` 186, `coherent` 36, `evolving` 13.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **17.7%** changing samples, and average phase-coupling coverage **38.9%**.
The longest stale phase run was **6** beats, **500** entries carried stale pair telemetry, and **372** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **948 available**, **1472 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 368 variance-gated), **tension-phase** (0 stale, 368 variance-gated), **flicker-phase** (0 stale, 368 variance-gated).
Telemetry health scored **0.497** with **6** under-seen controller pairs and reconciliation gap **0.302**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.302), **density-flicker** (gap 0.288), **flicker-trust** (gap 0.261).

## Signal Landscape

**Density** ranged from 0.26 to 0.59 (avg 0.44). The density was balanced.
**Tension** ranged from 0.06 to 0.77 (avg 0.56). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.80 to 1.17 (avg 0.96). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.41 (weight 1.31, trusted)
- **stutterContagion**: average score 0.35 (weight 1.26, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **entropyRegulator**: average score 0.22 (weight 1.16, neutral)
- **roleSwap**: average score 0.21 (weight 1.15, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.16 (weight 1.12, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.

## Output

- **Layer 1:** 8730 notes
- **Layer 2:** 13632 notes
- **Load:** 22362 total notes, 46.68 notes per traced beat, 278.51 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- 7 tension contributors boosting with constant drag: regimeReactiveDamping (1.22), pipelineCouplingManager (0.84), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.14), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), repetitionFatigueMonitor (1.09). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
