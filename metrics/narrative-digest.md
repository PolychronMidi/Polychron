# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T22:56:11.243Z | Trace data from: 2026-03-23T22:56:10.569Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **856 beats** spanning **129.7 seconds** of musical time.
Layer 1 experienced 376 beats; Layer 2 experienced 480 beats.

## Harmonic Journey

- **Section 1:** F aeolian (origin)
- **Section 2:** G aeolian (step-up)
- **Section 3:** C aeolian (fourth-up)
- **Section 4:** Eb major (mediant-flip)
- **Section 5:** F aeolian (return-home (late-closure))

## The System's Inner Life

The system spent most of its time **searching for coherence** (60.6% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 519 beats (60.6%) - searching for coherence
- **`coherent`** - 325 beats (38.0%) - operating in harmony
- **`evolving`** - 8 beats (0.9%) - developing new musical ideas
- **`initializing`** - 4 beats (0.5%) - warming up

### Regime Transitions

The system underwent **7 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 179: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 568: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 671: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 693: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 748: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **856 beat entries**, but the regime controller advanced on only **300 measure-recorder ticks**.
**556** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **271** traced entries.
On the controller cadence, resolved regime time was: `exploring` 192, `coherent` 128, `evolving` 8.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **19.6%** changing samples, and average phase-coupling coverage **27.6%**.
The longest stale phase run was **6** beats, **687** entries carried stale pair telemetry, and **620** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **944 available**, **2464 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 616 variance-gated), **tension-phase** (0 stale, 616 variance-gated), **flicker-phase** (0 stale, 616 variance-gated).
Telemetry health scored **0.504** with **5** under-seen controller pairs and reconciliation gap **0.312**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.312), **flicker-entropy** (gap 0.261), **density-entropy** (gap 0.223).

## Signal Landscape

**Density** ranged from 0.28 to 0.64 (avg 0.45). The density was balanced.
**Tension** ranged from 0.06 to 0.97 (avg 0.67). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.81 to 1.08 (avg 0.96). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.40, trusted)
- **phaseLock**: average score 0.45 (weight 1.34, trusted)
- **stutterContagion**: average score 0.43 (weight 1.32, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.26 (weight 1.19, neutral)
- **entropyRegulator**: average score 0.23 (weight 1.17, neutral)
- **roleSwap**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.21 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 8 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.901).

## Output

- **Layer 1:** 14080 notes
- **Layer 2:** 17173 notes
- **Load:** 31253 total notes, 52.44 notes per traced beat, 240.93 notes per second

## Coherence Verdicts

The system issued **1 critical**, **2 warning**, and **4 informational** findings.

### Critical Findings

- tension pipeline saturated - product hitting floor/ceiling.

### Warnings

- tension pipeline stressed - crush factor 50%.
- 7 tension contributors boosting with constant drag: regimeReactiveDamping (1.15), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.14), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), climaxProximityPredictor (1.09), repetitionFatigueMonitor (1.08). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
