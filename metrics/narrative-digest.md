# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T02:18:01.400Z | Trace data from: 2026-03-08T02:18:00.880Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **574 beats** spanning **71.1 seconds** of musical time.
Layer 1 experienced 248 beats; Layer 2 experienced 326 beats.

## Harmonic Journey

- **Section 1:** C# lydian (origin)
- **Section 2:** C# mixolydian (parallel-mixolydian)
- **Section 3:** D# mixolydian (step-down)
- **Section 4:** D# lydian (parallel-lydian (mode-shift))

## Section Coverage

The trace covered **4** of **4** planned sections.

- **Section 0**: 143 unique traced beats across 212 entries
- **Section 1**: 135 unique traced beats across 171 entries
- **Section 2**: 65 unique traced beats across 91 entries
- **Section 3**: 70 unique traced beats across 100 entries

Trace progress integrity closed **warning** with **161** paired beat keys, **0** duplicate layer-key collisions, and **0** L1 ordering regressions.

## The System's Inner Life

The system spent most of its time **searching for coherence** (68.6% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 394 beats (68.6%) - searching for coherence
- **`coherent`** - 171 beats (29.8%) - operating in harmony
- **`evolving`** - 5 beats (0.9%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 9: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 42: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 284: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 422: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **574 beat entries**, but the regime controller advanced on only **154 measure-recorder ticks**.
**420** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **188** traced entries.
On the controller cadence, resolved regime time was: `exploring` 88, `coherent` 76, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **0.5%** changing samples, and average phase-coupling coverage **28.6%**.
The longest stale phase run was **82** beats, **968** entries carried stale pair telemetry, and **410** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **656 available**, **32 variance-gated**, **1592 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (398 stale, 8 variance-gated), **tension-phase** (398 stale, 8 variance-gated), **flicker-phase** (398 stale, 8 variance-gated).
Telemetry health scored **0.352** with **2** under-seen controller pairs and reconciliation gap **0.195**.
The worst controller/trace reconciliation gaps remained in **entropy-trust** (gap 0.195), **density-trust** (gap 0.091).
The output-load governor intervened on **547** entries (95.3%), with average guard scale **0.419** and **540** hard clamps.
Guard/coupling interaction: guarded beats had higher exceedance rate (3.8%) vs unguarded (0.0%), delta **0.038**.

## Signal Landscape

**Density** ranged from 0.28 to 0.67 (avg 0.46). The density was balanced.
**Tension** ranged from 0.07 to 0.72 (avg 0.55). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.83 to 1.12 (avg 0.94). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.41, trusted)
- **phaseLock**: average score 0.45 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.39 (weight 1.29, trusted)
- **stutterContagion**: average score 0.32 (weight 1.24, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **flicker-phase** (0.881), **entropy-trust** (0.881).

## Output

- **Layer 1:** 7926 notes
- **Layer 2:** 10025 notes
- **Load:** 17951 total notes, 43.46 notes per traced beat, 252.50 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **8 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
