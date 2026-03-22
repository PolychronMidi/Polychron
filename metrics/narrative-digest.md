# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-22T04:42:25.265Z | Trace data from: 2026-03-22T04:42:24.814Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **505 beats** spanning **70.0 seconds** of musical time.
Layer 1 experienced 198 beats; Layer 2 experienced 307 beats.

## Harmonic Journey

- **Section 1:** C aeolian (origin)
- **Section 2:** C phrygian (parallel-phrygian)
- **Section 3:** D phrygian (step-up)
- **Section 4:** D minor (parallel-minor (mode-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (89.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 452 beats (89.5%) - searching for coherence
- **`coherent`** - 44 beats (8.7%) - operating in harmony
- **`initializing`** - 6 beats (1.2%) - warming up
- **`evolving`** - 3 beats (0.6%) - developing new musical ideas

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 9: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 53: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **505 beat entries**, but the regime controller advanced on only **127 measure-recorder ticks**.
**378** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **125** traced entries.
On the controller cadence, resolved regime time was: `exploring` 115, `coherent` 22, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **28.9%** changing samples, and average phase-coupling coverage **39.4%**.
The longest stale phase run was **6** beats, **358** entries carried stale pair telemetry, and **306** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **796 available**, **1200 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 300 variance-gated), **tension-phase** (0 stale, 300 variance-gated), **flicker-phase** (0 stale, 300 variance-gated).
Telemetry health scored **0.328** with **1** under-seen controller pairs and reconciliation gap **0.187**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.187).

## Signal Landscape

**Density** ranged from 0.26 to 0.59 (avg 0.43). The density was balanced.
**Tension** ranged from 0.05 to 0.71 (avg 0.59). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.81 to 1.15 (avg 0.91). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.48 (weight 1.36, trusted)
- **stutterContagion**: average score 0.38 (weight 1.29, trusted)
- **entropyRegulator**: average score 0.27 (weight 1.20, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **density-flicker** (0.939).

## Output

- **Layer 1:** 7113 notes
- **Layer 2:** 10717 notes
- **Load:** 17830 total notes, 47.04 notes per traced beat, 254.89 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **3 informational** findings.

### Warnings

- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), pipelineCouplingManager (1.09), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.12), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.90), tensionResolutionTracker (1.11), repetitionFatigueMonitor (1.10). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
