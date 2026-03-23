# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T15:30:22.576Z | Trace data from: 2026-03-23T15:30:22.088Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **574 beats** spanning **83.3 seconds** of musical time.
Layer 1 experienced 214 beats; Layer 2 experienced 360 beats.

## Harmonic Journey

- **Section 1:** D dorian (origin)
- **Section 2:** E dorian (step-up (key-shift))
- **Section 3:** A dorian (fourth-up)
- **Section 4:** C# major (relative-major (repeat-escape))
- **Section 5:** D dorian (return-home)

## The System's Inner Life

The system spent most of its time **searching for coherence** (60.6% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 348 beats (60.6%) - searching for coherence
- **`coherent`** - 213 beats (37.1%) - operating in harmony
- **`evolving`** - 9 beats (1.6%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **7 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 92: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 188: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 223: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 442: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 542: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **574 beat entries**, but the regime controller advanced on only **195 measure-recorder ticks**.
**379** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **151** traced entries.
On the controller cadence, resolved regime time was: `exploring` 112, `coherent` 95, `evolving` 8.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **22.7%** changing samples, and average phase-coupling coverage **45.3%**.
The longest stale phase run was **6** beats, **443** entries carried stale pair telemetry, and **314** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1040 available**, **1240 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 310 variance-gated), **tension-phase** (0 stale, 310 variance-gated), **flicker-phase** (0 stale, 310 variance-gated).
Telemetry health scored **0.469** with **3** under-seen controller pairs and reconciliation gap **0.462**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.462), **tension-trust** (gap 0.121), **density-flicker** (gap 0.107).

## Signal Landscape

**Density** ranged from 0.29 to 0.66 (avg 0.44). The density was balanced.
**Tension** ranged from 0.06 to 0.84 (avg 0.53). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.77 to 1.10 (avg 0.94). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.40, trusted)
- **phaseLock**: average score 0.47 (weight 1.35, trusted)
- **stutterContagion**: average score 0.37 (weight 1.28, trusted)
- **entropyRegulator**: average score 0.35 (weight 1.26, trusted)
- **restSynchronizer**: average score 0.26 (weight 1.20, neutral)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **flicker-trust**: avg |r| = 0.513, peak |r| = 0.964

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.894).

## Output

- **Layer 1:** 8282 notes
- **Layer 2:** 13690 notes
- **Load:** 21972 total notes, 52.44 notes per traced beat, 263.84 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **3 informational** findings.

### Warnings

- 8 density contributors suppressing with constant drag: regimeReactiveDamping (1.12), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), syncopationDensityTracker (0.88), climaxProximityPredictor (0.82), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
