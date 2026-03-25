# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-25T02:02:05.653Z | Trace data from: 2026-03-25T02:02:04.954Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **916 beats** spanning **132.9 seconds** of musical time.
Layer 1 experienced 426 beats; Layer 2 experienced 490 beats.

## Harmonic Journey

- **Section 1:** B minor (origin)
- **Section 2:** F# minor (fifth-up)
- **Section 3:** A# major (relative-major)
- **Section 4:** C major (step-up)
- **Section 5:** Eb minor (parallel-minor (palette-break))
- **Section 6:** F major (step-up)
- **Section 7:** B minor (return-home)

## The System's Inner Life

The system spent most of its time **operating in harmony** (42.1% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 386 beats (42.1%) - operating in harmony
- **`exploring`** - 350 beats (38.2%) - searching for coherence
- **`evolving`** - 176 beats (19.2%) - developing new musical ideas
- **`initializing`** - 4 beats (0.4%) - warming up

### Regime Transitions

The system underwent **38 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 31: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 80: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 89: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 151: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 154: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 173: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 177: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 213: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 216: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 219: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 254: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 293: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 302: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **916 beat entries**, but the regime controller advanced on only **486 measure-recorder ticks**.
**430** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **426** traced entries.
On the controller cadence, resolved regime time was: `coherent` 278, `exploring` 183, `evolving` 131.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **70.9%** changing samples, and average phase-coupling coverage **99.3%**.
The longest stale phase run was **6** beats, **267** entries carried stale pair telemetry, and **6** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **3640 available**, **8 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 2 variance-gated), **tension-phase** (0 stale, 2 variance-gated), **flicker-phase** (0 stale, 2 variance-gated).
Telemetry health scored **0.469** with **6** under-seen controller pairs and reconciliation gap **0.358**.
The worst controller/trace reconciliation gaps remained in **entropy-trust** (gap 0.358), **flicker-trust** (gap 0.289), **density-tension** (gap 0.215).

## Signal Landscape

**Density** ranged from 0.32 to 0.70 (avg 0.51). The density was balanced.
**Tension** ranged from 0.08 to 1.00 (avg 0.72). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.93 to 1.19 (avg 1.06). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.46 (weight 1.35, trusted)
- **stutterContagion**: average score 0.37 (weight 1.27, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, trusted)
- **entropyRegulator**: average score 0.23 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.

## Output

- **Layer 1:** 16640 notes
- **Layer 2:** 18907 notes
- **Load:** 35547 total notes, 51.22 notes per traced beat, 267.52 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- 7 density contributors suppressing with constant drag: regimeReactiveDamping (1.12), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), syncopationDensityTracker (0.88), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
