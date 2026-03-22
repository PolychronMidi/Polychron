# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-22T04:06:23.903Z | Trace data from: 2026-03-22T04:06:23.497Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **343 beats** spanning **49.4 seconds** of musical time.
Layer 1 experienced 147 beats; Layer 2 experienced 196 beats.

## Harmonic Journey

- **Section 1:** A locrian (origin)
- **Section 2:** B locrian (step-up)
- **Section 3:** B phrygian (parallel-phrygian (mode-shift))
- **Section 4:** B aeolian (parallel-aeolian)

## The System's Inner Life

The system spent most of its time **operating in harmony** (53.6% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 184 beats (53.6%) - operating in harmony
- **`exploring`** - 150 beats (43.7%) - searching for coherence
- **`initializing`** - 6 beats (1.7%) - warming up
- **`evolving`** - 3 beats (0.9%) - developing new musical ideas

### Regime Transitions

The system underwent **4 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 9: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 54: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 205: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **343 beat entries**, but the regime controller advanced on only **132 measure-recorder ticks**.
**211** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **97** traced entries.
On the controller cadence, resolved regime time was: `coherent` 79, `exploring` 65, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **18.4%** changing samples, and average phase-coupling coverage **50.4%**.
The longest stale phase run was **6** beats, **279** entries carried stale pair telemetry, and **170** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **692 available**, **656 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 164 variance-gated), **tension-phase** (0 stale, 164 variance-gated), **flicker-phase** (0 stale, 164 variance-gated).
Telemetry health scored **0.356** with **2** under-seen controller pairs and reconciliation gap **0.087**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.087), **tension-flicker** (gap 0.086).

## Signal Landscape

**Density** ranged from 0.29 to 0.55 (avg 0.45). The density was balanced.
**Tension** ranged from 0.05 to 0.66 (avg 0.51). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.84 to 1.14 (avg 0.95). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **stutterContagion**: average score 0.44 (weight 1.33, trusted)
- **phaseLock**: average score 0.43 (weight 1.33, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **entropyRegulator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-tension** (0.911).

## Output

- **Layer 1:** 5317 notes
- **Layer 2:** 6928 notes
- **Load:** 12245 total notes, 45.52 notes per traced beat, 248.03 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **6 informational** findings.

### Warnings

- 7 tension contributors boosting with constant drag: pipelineCouplingManager (0.84), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.11), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.90), tensionResolutionTracker (1.10), dynamicArchitectPlanner (0.92). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
