# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-10T14:27:27.110Z | Trace data from: 2026-03-10T14:27:26.496Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **686 beats** spanning **101.1 seconds** of musical time.
Layer 1 experienced 288 beats; Layer 2 experienced 398 beats.

## Harmonic Journey

- **Section 1:** G aeolian (origin)
- **Section 2:** B major (relative-major)
- **Section 3:** B lydian (parallel-lydian)
- **Section 4:** B mixolydian (parallel-mixolydian (mode-shift))
- **Section 5:** G aeolian (return-home)

## The System's Inner Life

The system spent most of its time **searching for coherence** (63.0% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 432 beats (63.0%) - searching for coherence
- **`coherent`** - 244 beats (35.6%) - operating in harmony
- **`initializing`** - 6 beats (0.9%) - warming up
- **`evolving`** - 4 beats (0.6%) - developing new musical ideas

### Regime Transitions

The system underwent **7 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 10: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 140: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 157: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 224: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 508: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 557: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **686 beat entries**, but the regime controller advanced on only **251 measure-recorder ticks**.
**435** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **214** traced entries.
On the controller cadence, resolved regime time was: `exploring` 166, `coherent` 121, `evolving` 4.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **28.3%** changing samples, and average phase-coupling coverage **37.8%**.
The longest stale phase run was **6** beats, **491** entries carried stale pair telemetry, and **427** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1036 available**, **1684 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 421 variance-gated), **tension-phase** (0 stale, 421 variance-gated), **flicker-phase** (0 stale, 421 variance-gated).
Telemetry health scored **0.504** with **8** under-seen controller pairs and reconciliation gap **0.343**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.343), **tension-flicker** (gap 0.332), **density-tension** (gap 0.184).

## Signal Landscape

**Density** ranged from 0.26 to 0.66 (avg 0.47). The density was balanced.
**Tension** ranged from 0.05 to 0.74 (avg 0.59). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.77 to 1.17 (avg 0.93). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.52 (weight 1.39, trusted)
- **stutterContagion**: average score 0.46 (weight 1.34, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.34 (weight 1.25, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **entropy-trust** (0.877), **flicker-trust** (0.858).

## Output

- **Layer 1:** 10918 notes
- **Layer 2:** 15864 notes
- **Load:** 26782 total notes, 49.97 notes per traced beat, 264.94 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **5 informational** findings.

### Warnings

- 7 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), pipelineCouplingManager (0.84), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.14), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), repetitionFatigueMonitor (1.08). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
