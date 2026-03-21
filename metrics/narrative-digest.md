# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-21T13:15:21.931Z | Trace data from: 2026-03-21T13:15:21.494Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **422 beats** spanning **50.2 seconds** of musical time.
Layer 1 experienced 184 beats; Layer 2 experienced 238 beats.

## Harmonic Journey

- **Section 1:** G# lydian (origin)
- **Section 2:** G# mixolydian (parallel-mixolydian)
- **Section 3:** C major (relative-major)
- **Section 4:** Eb major (chromatic-mediant-down)

## The System's Inner Life

The system spent most of its time **searching for coherence** (64.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 272 beats (64.5%) - searching for coherence
- **`coherent`** - 138 beats (32.7%) - operating in harmony
- **`evolving`** - 8 beats (1.9%) - developing new musical ideas
- **`initializing`** - 4 beats (0.9%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 124: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 207: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 233: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **422 beat entries**, but the regime controller advanced on only **167 measure-recorder ticks**.
**255** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **142** traced entries.
On the controller cadence, resolved regime time was: `exploring` 109, `coherent` 75, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **14.7%** changing samples, and average phase-coupling coverage **34.6%**.
The longest stale phase run was **6** beats, **359** entries carried stale pair telemetry, and **276** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **584 available**, **1088 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 272 variance-gated), **tension-phase** (0 stale, 272 variance-gated), **flicker-phase** (0 stale, 272 variance-gated).
Telemetry health scored **0.498** with **4** under-seen controller pairs and reconciliation gap **0.298**.
The worst controller/trace reconciliation gaps remained in **entropy-trust** (gap 0.298), **flicker-trust** (gap 0.276), **tension-trust** (gap 0.243).

## Signal Landscape

**Density** ranged from 0.34 to 0.61 (avg 0.45). The density was balanced.
**Tension** ranged from 0.05 to 0.76 (avg 0.55). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.94 to 1.14 (avg 1.07). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.51 (weight 1.38, trusted)
- **phaseLock**: average score 0.42 (weight 1.32, trusted)
- **stutterContagion**: average score 0.33 (weight 1.25, trusted)
- **entropyRegulator**: average score 0.29 (weight 1.22, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.22 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.932), **flicker-trust** (0.928), **flicker-entropy** (0.914), **density-entropy** (0.886).

## Output

- **Layer 1:** 6581 notes
- **Layer 2:** 8328 notes
- **Load:** 14909 total notes, 46.88 notes per traced beat, 296.86 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **1 informational** findings.

### Warnings

- 7 density contributors suppressing with constant drag: pipelineCouplingManager (0.84), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (1.18), climaxProximityPredictor (1.11), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 9 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), pipelineCouplingManager (1.16), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.13), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.89), tensionResolutionTracker (1.11), dynamicArchitectPlanner (0.91), repetitionFatigueMonitor (1.11). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
