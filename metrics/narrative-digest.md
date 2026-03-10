# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-10T00:16:48.380Z | Trace data from: 2026-03-10T00:16:47.958Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **395 beats** spanning **46.8 seconds** of musical time.
Layer 1 experienced 181 beats; Layer 2 experienced 214 beats.

## Harmonic Journey

- **Section 1:** F# minor (origin)
- **Section 2:** A# major (relative-major)
- **Section 3:** C# minor (relative-minor)
- **Section 4:** F minor (chromatic-mediant-up)

## The System's Inner Life

The system spent most of its time **searching for coherence** (77.7% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 307 beats (77.7%) - searching for coherence
- **`coherent`** - 79 beats (20.0%) - operating in harmony
- **`initializing`** - 6 beats (1.5%) - warming up
- **`evolving`** - 3 beats (0.8%) - developing new musical ideas

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 9: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 73: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 124: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 139: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **395 beat entries**, but the regime controller advanced on only **167 measure-recorder ticks**.
**228** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **152** traced entries.
On the controller cadence, resolved regime time was: `exploring` 151, `coherent` 38, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **27.6%** changing samples, and average phase-coupling coverage **38.0%**.
The longest stale phase run was **6** beats, **285** entries carried stale pair telemetry, and **245** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **600 available**, **956 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 239 variance-gated), **tension-phase** (0 stale, 239 variance-gated), **flicker-phase** (0 stale, 239 variance-gated).
Telemetry health scored **0.507** with **5** under-seen controller pairs and reconciliation gap **0.369**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.369), **density-flicker** (gap 0.317), **tension-trust** (gap 0.122).

## Signal Landscape

**Density** ranged from 0.34 to 0.64 (avg 0.51). The density was balanced.
**Tension** ranged from 0.05 to 0.78 (avg 0.60). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.82 to 1.14 (avg 1.01). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.41, trusted)
- **phaseLock**: average score 0.45 (weight 1.34, trusted)
- **stutterContagion**: average score 0.43 (weight 1.32, trusted)
- **entropyRegulator**: average score 0.32 (weight 1.24, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.21 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **density-flicker** (0.880), **density-tension** (0.851).

## Output

- **Layer 1:** 6696 notes
- **Layer 2:** 8025 notes
- **Load:** 14721 total notes, 50.76 notes per traced beat, 314.45 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), pipelineCouplingManager (1.16), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.13), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.10), repetitionFatigueMonitor (1.09). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
