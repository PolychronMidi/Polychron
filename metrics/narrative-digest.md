# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T21:24:21.099Z | Trace data from: 2026-03-09T21:24:20.569Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **517 beats** spanning **71.7 seconds** of musical time.
Layer 1 experienced 189 beats; Layer 2 experienced 328 beats.

## Harmonic Journey

- **Section 1:** B major (origin)
- **Section 2:** B mixolydian (parallel-mixolydian)
- **Section 3:** D# major (relative-major)
- **Section 4:** F# minor (mediant-flip)

## The System's Inner Life

The system spent most of its time **searching for coherence** (81.6% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 422 beats (81.6%) - searching for coherence
- **`coherent`** - 82 beats (15.9%) - operating in harmony
- **`evolving`** - 9 beats (1.7%) - developing new musical ideas
- **`initializing`** - 4 beats (0.8%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 96: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **517 beat entries**, but the regime controller advanced on only **153 measure-recorder ticks**.
**364** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **133** traced entries.
On the controller cadence, resolved regime time was: `exploring` 138, `coherent` 25, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **19.0%** changing samples, and average phase-coupling coverage **43.9%**.
The longest stale phase run was **6** beats, **418** entries carried stale pair telemetry, and **290** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **908 available**, **1144 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 286 variance-gated), **tension-phase** (0 stale, 286 variance-gated), **flicker-phase** (0 stale, 286 variance-gated).
Telemetry health scored **0.494** with **6** under-seen controller pairs and reconciliation gap **0.299**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.299), **flicker-trust** (gap 0.146), **tension-entropy** (gap 0.134).

## Signal Landscape

**Density** ranged from 0.37 to 0.79 (avg 0.53). The density was balanced.
**Tension** ranged from 0.06 to 0.75 (avg 0.52). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.78 to 1.15 (avg 0.96). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.56 (weight 1.42, trusted)
- **stutterContagion**: average score 0.45 (weight 1.34, trusted)
- **phaseLock**: average score 0.42 (weight 1.31, trusted)
- **entropyRegulator**: average score 0.41 (weight 1.31, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.22 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.20 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **density-flicker** (0.911).

## Output

- **Layer 1:** 8240 notes
- **Layer 2:** 13587 notes
- **Load:** 21827 total notes, 54.84 notes per traced beat, 304.58 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **2 informational** findings.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
