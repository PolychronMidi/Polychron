# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-21T18:40:43.427Z | Trace data from: 2026-03-21T18:40:42.726Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **922 beats** spanning **116.5 seconds** of musical time.
Layer 1 experienced 445 beats; Layer 2 experienced 477 beats.

## Harmonic Journey

- **Section 1:** A ionian (origin)
- **Section 2:** B ionian (step-up)
- **Section 3:** B lydian (parallel-lydian)
- **Section 4:** D minor (mediant-flip)
- **Section 5:** F# major (relative-major)

## The System's Inner Life

The system spent most of its time **searching for coherence** (50.9% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 469 beats (50.9%) - searching for coherence
- **`coherent`** - 442 beats (47.9%) - operating in harmony
- **`evolving`** - 7 beats (0.8%) - developing new musical ideas
- **`initializing`** - 4 beats (0.4%) - warming up

### Regime Transitions

The system underwent **12 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 11: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 65: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 102: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 154: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 329: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 497: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 499: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 548: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 687: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 741: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 861: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **922 beat entries**, but the regime controller advanced on only **395 measure-recorder ticks**.
**527** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **341** traced entries.
On the controller cadence, resolved regime time was: `exploring` 274, `coherent` 176, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **27.3%** changing samples, and average phase-coupling coverage **16.2%**.
The longest stale phase run was **6** beats, **669** entries carried stale pair telemetry, and **773** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **596 available**, **3076 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 769 variance-gated), **tension-phase** (0 stale, 769 variance-gated), **flicker-phase** (0 stale, 769 variance-gated).
Telemetry health scored **0.502** with **5** under-seen controller pairs and reconciliation gap **0.271**.
The worst controller/trace reconciliation gaps remained in **density-tension** (gap 0.271), **density-trust** (gap 0.220), **flicker-trust** (gap 0.220).

## Signal Landscape

**Density** ranged from 0.34 to 0.62 (avg 0.46). The density was balanced.
**Tension** ranged from 0.05 to 0.72 (avg 0.58). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.86 to 1.17 (avg 1.02). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.48 (weight 1.36, trusted)
- **stutterContagion**: average score 0.41 (weight 1.31, trusted)
- **entropyRegulator**: average score 0.33 (weight 1.24, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **flicker-trust** (0.868), **density-flicker** (0.852).

## Output

- **Layer 1:** 17172 notes
- **Layer 2:** 18356 notes
- **Load:** 35528 total notes, 51.34 notes per traced beat, 304.87 notes per second

## Coherence Verdicts

The system issued **0 critical**, **3 warning**, and **3 informational** findings.

### Warnings

- tension product soft-capped at 1.4156 (raw 1.4162) - soft envelope compressing high product.
- 7 density contributors suppressing with constant drag: regimeReactiveDamping (0.89), pipelineCouplingManager (0.85), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 7 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), pipelineCouplingManager (1.09), narrativeTrajectory (1.08), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.11), repetitionFatigueMonitor (1.11). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
