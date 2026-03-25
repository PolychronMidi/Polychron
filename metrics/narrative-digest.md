# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-25T07:53:51.351Z | Trace data from: 2026-03-25T07:53:50.556Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **1165 beats** spanning **193.0 seconds** of musical time.
Layer 1 experienced 469 beats; Layer 2 experienced 696 beats.

## Harmonic Journey

- **Section 1:** D mixolydian (origin)
- **Section 2:** F# major (relative-major)
- **Section 3:** G# major (step-up)
- **Section 4:** B minor (relative-minor (distance-push))
- **Section 5:** D# minor (parallel-minor (palette-break))
- **Section 6:** G# major (fourth-up)
- **Section 7:** D mixolydian (return-home)

## The System's Inner Life

The system spent most of its time **searching for coherence** (45.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 530 beats (45.5%) - searching for coherence
- **`evolving`** - 326 beats (28.0%) - developing new musical ideas
- **`coherent`** - 305 beats (26.2%) - operating in harmony
- **`initializing`** - 4 beats (0.3%) - warming up

### Regime Transitions

The system underwent **45 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 35: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 96: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 105: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 117: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 132: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 145: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 181: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 189: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 204: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 270: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 287: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 292: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 322: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **1165 beat entries**, but the regime controller advanced on only **544 measure-recorder ticks**.
**621** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **469** traced entries.
On the controller cadence, resolved regime time was: `exploring` 258, `coherent` 239, `evolving` 154.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **76.6%** changing samples, and average phase-coupling coverage **99.0%**.
The longest stale phase run was **6** beats, **273** entries carried stale pair telemetry, and **12** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **4612 available**, **32 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 8 variance-gated), **tension-phase** (0 stale, 8 variance-gated), **flicker-phase** (0 stale, 8 variance-gated).
Telemetry health scored **0.459** with **5** under-seen controller pairs and reconciliation gap **0.346**.
The worst controller/trace reconciliation gaps remained in **flicker-trust** (gap 0.346), **density-tension** (gap 0.281), **flicker-phase** (gap 0.167).

## Signal Landscape

**Density** ranged from 0.30 to 0.77 (avg 0.53). The density was balanced.
**Tension** ranged from 0.08 to 1.00 (avg 0.85). Tension levels were moderate throughout.
**Flicker** ranged from 0.90 to 1.27 (avg 1.06). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.41 (weight 1.31, trusted)
- **stutterContagion**: average score 0.39 (weight 1.29, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **entropyRegulator**: average score 0.24 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.21 (weight 1.16, neutral)
- **roleSwap**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.21 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.

## Output

- **Layer 1:** 18207 notes
- **Layer 2:** 28949 notes
- **Load:** 47156 total notes, 54.02 notes per traced beat, 244.37 notes per second

## Coherence Verdicts

The system issued **2 critical**, **4 warning**, and **5 informational** findings.

### Critical Findings

- tension pipeline critical - product 1.5184, crush factor 54%.
- tension pipeline saturated - product hitting floor/ceiling.

### Warnings

- Pipelines hitting floor/ceiling frequently: tension (84%).
- narrativeTrajectory tension bias clipped: raw 1.1537 - clamped 1.1470. Module exceeding its registered range.
- tension product soft-capped at 1.4579 (raw 1.4684) - soft envelope compressing high product.
- 7 density contributors suppressing with constant drag: structuralNarrativeAdvisor (1.14), harmonicRhythmDensityRatio (0.88), intervalExpansionContractor (1.08), rhythmicComplexityGradient (0.90), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
