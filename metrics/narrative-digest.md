# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-25T00:53:49.586Z | Trace data from: 2026-03-25T00:53:48.709Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **1193 beats** spanning **163.3 seconds** of musical time.
Layer 1 experienced 524 beats; Layer 2 experienced 669 beats.

## Harmonic Journey

- **Section 1:** B mixolydian (origin)
- **Section 2:** E mixolydian (fourth-up)
- **Section 3:** G# major (relative-major)
- **Section 4:** C# major (fourth-up (repeat-escape))
- **Section 5:** D dorian (parallel-dorian (palette-break))
- **Section 6:** E mixolydian (step-up (repeat-escape))
- **Section 7:** B mixolydian (return-home)

## The System's Inner Life

The system spent most of its time **operating in harmony** (39.9% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 476 beats (39.9%) - operating in harmony
- **`exploring`** - 476 beats (39.9%) - searching for coherence
- **`evolving`** - 237 beats (19.9%) - developing new musical ideas
- **`initializing`** - 4 beats (0.3%) - warming up

### Regime Transitions

The system underwent **52 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 58: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 73: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 109: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 112: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 119: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 184: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 195: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 197: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 208: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 276: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 314: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 341: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 359: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)

### Controller Cadence

The emitted trace contains **1193 beat entries**, but the regime controller advanced on only **603 measure-recorder ticks**.
**590** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **524** traced entries.
On the controller cadence, resolved regime time was: `coherent` 358, `exploring` 267, `evolving` 84.
The controller recorded **3 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **74.5%** changing samples, and average phase-coupling coverage **99.5%**.
The longest stale phase run was **6** beats, **304** entries carried stale pair telemetry, and **6** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **4748 available**, **8 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 2 variance-gated), **tension-phase** (0 stale, 2 variance-gated), **flicker-phase** (0 stale, 2 variance-gated).
Telemetry health scored **0.476** with **5** under-seen controller pairs and reconciliation gap **0.432**.
The worst controller/trace reconciliation gaps remained in **flicker-trust** (gap 0.432), **density-trust** (gap 0.130), **density-flicker** (gap 0.107).

## Signal Landscape

**Density** ranged from 0.32 to 0.73 (avg 0.52). The density was balanced.
**Tension** ranged from 0.08 to 1.00 (avg 0.68). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.90 to 1.30 (avg 1.07). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **stutterContagion**: average score 0.37 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **entropyRegulator**: average score 0.23 (weight 1.17, neutral)
- **restSynchronizer**: average score 0.22 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 8 hotspot pairs (p95 > 0.70) -- system stressed.

## Output

- **Layer 1:** 21237 notes
- **Layer 2:** 27806 notes
- **Load:** 49043 total notes, 56.76 notes per traced beat, 300.28 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **5 informational** findings.

### Warnings

- tension-entropy strongly anti-correlated (r=-0.731) - these dimensions may be driven by a shared input or feedback loop.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
