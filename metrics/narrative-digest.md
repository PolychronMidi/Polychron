# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-07T23:43:38.877Z | Trace data from: 2026-03-07T23:43:38.474Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **376 beats** spanning **48.1 seconds** of musical time.
Layer 1 experienced 149 beats; Layer 2 experienced 227 beats.

## Harmonic Journey

- **Section 1:** G dorian (origin)
- **Section 2:** A dorian (step-down)
- **Section 3:** A major (parallel-major (mode-shift))
- **Section 4:** B major (step-down)

## Section Coverage

The trace covered **4** of **4** planned sections.

- **Section 0**: 109 unique traced beats across 153 entries
- **Section 1**: 101 unique traced beats across 115 entries
- **Section 2**: 50 unique traced beats across 54 entries
- **Section 3**: 50 unique traced beats across 54 entries

Trace progress integrity closed **warning** with **66** paired beat keys, **0** duplicate layer-key collisions, and **0** L1 ordering regressions.

## The System's Inner Life

The system spent most of its time **searching for coherence** (70.7% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 266 beats (70.7%) - searching for coherence
- **`coherent`** - 74 beats (19.7%) - operating in harmony
- **`evolving`** - 29 beats (7.7%) - developing new musical ideas
- **`initializing`** - 7 beats (1.9%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 7: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 36: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 110: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **376 beat entries**, but the regime controller advanced on only **113 measure-recorder ticks**.
**263** entries reused an existing profiler snapshot and **7** entries landed during warmup.
Beat-level escalation refreshed the profiler on **107** traced entries.
On the controller cadence, resolved regime time was: `exploring` 104, `coherent` 23, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **0.8%** changing samples, and average phase-coupling coverage **38.0%**.
The longest stale phase run was **47** beats, and **233** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **572 available**, **904 variance-gated**, and **0 missing** pair observations across the trace.
Telemetry health scored **0.273** with **1** under-seen controller pairs and reconciliation gap **0.156**.

## Signal Landscape

**Density** ranged from 0.35 to 0.70 (avg 0.48). The density was balanced.
**Tension** ranged from 0.06 to 0.81 (avg 0.46). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.89 to 1.20 (avg 1.04). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.39, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.39 (weight 1.29, trusted)
- **stutterContagion**: average score 0.36 (weight 1.27, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-entropy** (0.968), **flicker-entropy** (0.943), **density-flicker** (0.866).

## Output

- **Layer 1:** 4945 notes
- **Layer 2:** 7744 notes
- **Load:** 12689 total notes, 40.93 notes per traced beat, 263.94 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **6 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
