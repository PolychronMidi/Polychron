# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T12:02:55.121Z | Trace data from: 2026-03-23T12:02:54.589Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **631 beats** spanning **99.2 seconds** of musical time.
Layer 1 experienced 287 beats; Layer 2 experienced 344 beats.

## Harmonic Journey

- **Section 1:** G phrygian (origin)
- **Section 2:** A phrygian (step-up)
- **Section 3:** D phrygian (fourth-up)
- **Section 4:** F major (mediant-flip (key-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (55.8% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 352 beats (55.8%) - searching for coherence
- **`coherent`** - 266 beats (42.2%) - operating in harmony
- **`evolving`** - 9 beats (1.4%) - developing new musical ideas
- **`initializing`** - 4 beats (0.6%) - warming up

### Regime Transitions

The system underwent **8 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 56: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 111: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 151: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 202: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 236: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 485: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **631 beat entries**, but the regime controller advanced on only **228 measure-recorder ticks**.
**403** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **222** traced entries.
On the controller cadence, resolved regime time was: `exploring` 157, `coherent` 99, `evolving` 8.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **32.5%** changing samples, and average phase-coupling coverage **29.0%**.
The longest stale phase run was **6** beats, **425** entries carried stale pair telemetry, and **448** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **732 available**, **1776 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 444 variance-gated), **tension-phase** (0 stale, 444 variance-gated), **flicker-phase** (0 stale, 444 variance-gated).
Telemetry health scored **0.513** with **4** under-seen controller pairs and reconciliation gap **0.373**.
The worst controller/trace reconciliation gaps remained in **entropy-trust** (gap 0.373), **density-trust** (gap 0.314), **flicker-trust** (gap 0.232).

## Signal Landscape

**Density** ranged from 0.30 to 0.57 (avg 0.47). The density was balanced.
**Tension** ranged from 0.06 to 0.88 (avg 0.66). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.78 to 1.13 (avg 0.95). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.39, trusted)
- **phaseLock**: average score 0.43 (weight 1.32, trusted)
- **stutterContagion**: average score 0.37 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **entropyRegulator**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.18 (weight 1.14, neutral)
- **cadenceAlignment**: average score 0.16 (weight 1.12, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.919), **flicker-trust** (0.891).

## Output

- **Layer 1:** 9912 notes
- **Layer 2:** 11566 notes
- **Load:** 21478 total notes, 42.36 notes per traced beat, 216.53 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- flicker pipeline strained with 50% crush - multiplicative suppression eroding signal range.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
