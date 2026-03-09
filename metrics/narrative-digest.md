# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T23:58:38.441Z | Trace data from: 2026-03-08T23:58:37.716Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **atmospheric** conductor profile.

The system processed **870 beats** spanning **111.4 seconds** of musical time.
Layer 1 experienced 352 beats; Layer 2 experienced 518 beats.

## Harmonic Journey

- **Section 1:** F mixolydian (origin)
- **Section 2:** G mixolydian (step-up)
- **Section 3:** G major (parallel-major)
- **Section 4:** G mixolydian (parallel-mixolydian)
- **Section 5:** G dorian (parallel-dorian)

## The System's Inner Life

The system spent most of its time **searching for coherence** (75.2% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 654 beats (75.2%) - searching for coherence
- **`coherent`** - 209 beats (24.0%) - operating in harmony
- **`initializing`** - 4 beats (0.5%) - warming up
- **`evolving`** - 3 beats (0.3%) - developing new musical ideas

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 7: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 36: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 401: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 582: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **870 beat entries**, but the regime controller advanced on only **249 measure-recorder ticks**.
**621** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **259** traced entries.
On the controller cadence, resolved regime time was: `exploring` 210, `coherent` 62, `evolving` 4.
No forced regime transition fired on the controller cadence.
Phase telemetry closed **warning** with **100.0%** valid samples, **25.8%** changing samples, and average phase-coupling coverage **31.9%**.
The longest stale phase run was **6** beats, **645** entries carried stale pair telemetry, and **592** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1112 available**, **2352 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 588 variance-gated), **tension-phase** (0 stale, 588 variance-gated), **flicker-phase** (0 stale, 588 variance-gated).
Telemetry health scored **0.394** with **2** under-seen controller pairs and reconciliation gap **0.262**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.262), **density-entropy** (gap 0.082).

## Signal Landscape

**Density** ranged from 0.29 to 0.75 (avg 0.54). The density was balanced.
**Tension** ranged from 0.07 to 0.83 (avg 0.55). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.81 to 1.18 (avg 0.96). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.57 (weight 1.43, trusted)
- **stutterContagion**: average score 0.46 (weight 1.35, trusted)
- **phaseLock**: average score 0.46 (weight 1.35, trusted)
- **entropyRegulator**: average score 0.31 (weight 1.23, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **cadenceAlignment**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **convergence**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 2 hotspot pairs (p95 > 0.70) -- system manageable.

## Output

- **Layer 1:** 13235 notes
- **Layer 2:** 19993 notes
- **Load:** 33228 total notes, 52.74 notes per traced beat, 298.36 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **3 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
