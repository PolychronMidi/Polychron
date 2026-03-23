# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T02:58:08.622Z | Trace data from: 2026-03-23T02:58:07.999Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **801 beats** spanning **103.1 seconds** of musical time.
Layer 1 experienced 401 beats; Layer 2 experienced 400 beats.

## Harmonic Journey

- **Section 1:** E lydian (origin)
- **Section 2:** A lydian (fourth-up)
- **Section 3:** A ionian (parallel-ionian (diversity))
- **Section 4:** C# lydian (step-down (key-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (65.8% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 527 beats (65.8%) - searching for coherence
- **`coherent`** - 262 beats (32.7%) - operating in harmony
- **`initializing`** - 6 beats (0.7%) - warming up
- **`evolving`** - 6 beats (0.7%) - developing new musical ideas

### Regime Transitions

The system underwent **10 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 99: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 161: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 188: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 261: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 283: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 447: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 461: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 691: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **801 beat entries**, but the regime controller advanced on only **323 measure-recorder ticks**.
**478** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **320** traced entries.
On the controller cadence, resolved regime time was: `exploring` 217, `coherent` 134, `evolving` 8.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **26.7%** changing samples, and average phase-coupling coverage **19.2%**.
The longest stale phase run was **6** beats, **586** entries carried stale pair telemetry, and **647** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **616 available**, **2564 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 641 variance-gated), **tension-phase** (0 stale, 641 variance-gated), **flicker-phase** (0 stale, 641 variance-gated).
Telemetry health scored **0.390** with **2** under-seen controller pairs and reconciliation gap **0.201**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.201), **tension-entropy** (gap 0.122).

## Signal Landscape

**Density** ranged from 0.32 to 0.59 (avg 0.44). The density was balanced.
**Tension** ranged from 0.06 to 0.97 (avg 0.72). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.79 to 1.16 (avg 0.93). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.43 (weight 1.32, trusted)
- **stutterContagion**: average score 0.40 (weight 1.30, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **entropyRegulator**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **flicker-trust** (0.950).

## Output

- **Layer 1:** 14122 notes
- **Layer 2:** 13164 notes
- **Load:** 27286 total notes, 48.04 notes per traced beat, 264.77 notes per second

## Coherence Verdicts

The system issued **1 critical**, **5 warning**, and **2 informational** findings.

### Critical Findings

- tension pipeline saturated - product hitting floor/ceiling.

### Warnings

- tension pipeline stressed - crush factor 45%.
- Pipelines hitting floor/ceiling frequently: tension (22%).
- tension product soft-capped at 1.4572 (raw 1.4674) - soft envelope compressing high product.
- 7 density contributors suppressing with constant drag: regimeReactiveDamping (0.91), pipelineCouplingManager (1.20), harmonicRhythmDensityRatio (0.88), syncopationDensityTracker (0.88), climaxProximityPredictor (1.23), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 9 tension contributors boosting with constant drag: regimeReactiveDamping (1.22), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.09), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.11), tonalAnchorDistanceTracker (1.10), climaxProximityPredictor (1.18), repetitionFatigueMonitor (1.10). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
