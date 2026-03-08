# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T16:42:50.309Z | Trace data from: 2026-03-08T16:42:49.967Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **246 beats** spanning **47.0 seconds** of musical time.
Layer 1 experienced 116 beats; Layer 2 experienced 130 beats.

## Harmonic Journey

- **Section 1:** B mixolydian (origin)
- **Section 2:** C# mixolydian (step-up)
- **Section 3:** C# lydian (parallel-lydian (diversity))

## The System's Inner Life

The system spent most of its time **searching for coherence** (52.8% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 130 beats (52.8%) - searching for coherence
- **`coherent`** - 104 beats (42.3%) - operating in harmony
- **`evolving`** - 8 beats (3.3%) - developing new musical ideas
- **`initializing`** - 4 beats (1.6%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 116: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **246 beat entries**, but the regime controller advanced on only **72 measure-recorder ticks**.
**174** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **72** traced entries.
On the controller cadence, resolved regime time was: `exploring` 46, `coherent` 25, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **0.8%** changing samples, and average phase-coupling coverage **16.3%**.
The longest stale phase run was **27** beats, **431** entries carried stale pair telemetry, and **206** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **160 available**, **56 variance-gated**, **752 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (188 stale, 14 variance-gated), **tension-phase** (188 stale, 14 variance-gated), **flicker-phase** (188 stale, 14 variance-gated).
Telemetry health scored **0.223** with **0** under-seen controller pairs and reconciliation gap **0.000**.

## Signal Landscape

**Density** ranged from 0.31 to 0.69 (avg 0.44). The density was balanced.
**Tension** ranged from 0.10 to 0.71 (avg 0.41). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.93 to 1.13 (avg 1.02). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.52 (weight 1.39, trusted)
- **phaseLock**: average score 0.45 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.42 (weight 1.32, trusted)
- **stutterContagion**: average score 0.41 (weight 1.30, trusted)
- **restSynchronizer**: average score 0.26 (weight 1.19, neutral)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **convergence**: average score 0.22 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.20 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **density-flicker** (0.894), **density-trust** (0.853).

## Output

- **Layer 1:** 4296 notes
- **Layer 2:** 5061 notes
- **Load:** 9357 total notes, 50.04 notes per traced beat, 199.17 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **1 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
