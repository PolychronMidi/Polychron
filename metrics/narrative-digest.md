# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-21T04:06:58.315Z | Trace data from: 2026-03-21T04:06:57.824Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **519 beats** spanning **73.6 seconds** of musical time.
Layer 1 experienced 253 beats; Layer 2 experienced 266 beats.

## Harmonic Journey

- **Section 1:** C# minor (origin)
- **Section 2:** F major (relative-major)
- **Section 3:** Bb major (fourth-up)
- **Section 4:** Db minor (relative-minor (mode-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (75.1% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 390 beats (75.1%) - searching for coherence
- **`coherent`** - 119 beats (22.9%) - operating in harmony
- **`evolving`** - 6 beats (1.2%) - developing new musical ideas
- **`initializing`** - 4 beats (0.8%) - warming up

### Regime Transitions

The system underwent **7 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 10: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 67: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 128: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 171: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 495: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 516: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **519 beat entries**, but the regime controller advanced on only **211 measure-recorder ticks**.
**308** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **173** traced entries.
On the controller cadence, resolved regime time was: `exploring` 162, `coherent` 73, `evolving` 4.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **22.4%** changing samples, and average phase-coupling coverage **34.7%**.
The longest stale phase run was **6** beats, **402** entries carried stale pair telemetry, and **339** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **720 available**, **1340 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 335 variance-gated), **tension-phase** (0 stale, 335 variance-gated), **flicker-phase** (0 stale, 335 variance-gated).
Telemetry health scored **0.392** with **2** under-seen controller pairs and reconciliation gap **0.260**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.260), **flicker-trust** (gap 0.083).

## Signal Landscape

**Density** ranged from 0.33 to 0.66 (avg 0.48). The density was balanced.
**Tension** ranged from 0.05 to 0.76 (avg 0.60). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.81 to 1.15 (avg 0.99). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.41, trusted)
- **stutterContagion**: average score 0.45 (weight 1.33, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.33 (weight 1.24, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.860), **tension-flicker** (0.858).

## Output

- **Layer 1:** 9543 notes
- **Layer 2:** 9630 notes
- **Load:** 19173 total notes, 48.66 notes per traced beat, 260.40 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **2 informational** findings.

### Warnings

- flicker pipeline strained with 50% crush - multiplicative suppression eroding signal range.
- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), pipelineCouplingManager (1.12), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.14), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.12), repetitionFatigueMonitor (1.10). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
