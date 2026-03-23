# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T20:54:15.499Z | Trace data from: 2026-03-23T20:54:14.975Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **570 beats** spanning **80.1 seconds** of musical time.
Layer 1 experienced 226 beats; Layer 2 experienced 344 beats.

## Harmonic Journey

- **Section 1:** F# dorian (origin)
- **Section 2:** A# major (relative-major)
- **Section 3:** C# minor (relative-minor)
- **Section 4:** D# minor (step-up)
- **Section 5:** F# dorian (return-home)

## The System's Inner Life

The system spent most of its time **searching for coherence** (60.9% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 347 beats (60.9%) - searching for coherence
- **`coherent`** - 182 beats (31.9%) - operating in harmony
- **`evolving`** - 37 beats (6.5%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **10 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 41: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 108: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 146: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 191: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 325: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 350: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 437: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 457: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 548: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **570 beat entries**, but the regime controller advanced on only **206 measure-recorder ticks**.
**364** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **156** traced entries.
On the controller cadence, resolved regime time was: `exploring` 127, `coherent` 100, `evolving` 8.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **33.2%** changing samples, and average phase-coupling coverage **49.1%**.
The longest stale phase run was **6** beats, **380** entries carried stale pair telemetry, and **290** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1120 available**, **1144 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 286 variance-gated), **tension-phase** (0 stale, 286 variance-gated), **flicker-phase** (0 stale, 286 variance-gated).
Telemetry health scored **0.373** with **2** under-seen controller pairs and reconciliation gap **0.182**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.182), **tension-entropy** (gap 0.144).

## Signal Landscape

**Density** ranged from 0.31 to 0.69 (avg 0.51). The density was balanced.
**Tension** ranged from 0.06 to 0.76 (avg 0.54). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.80 to 1.13 (avg 0.96). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.45 (weight 1.33, trusted)
- **stutterContagion**: average score 0.41 (weight 1.30, trusted)
- **entropyRegulator**: average score 0.28 (weight 1.21, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, trusted)
- **restSynchronizer**: average score 0.25 (weight 1.18, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-flicker**: avg |r| = 0.526, peak |r| = 0.992

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.940).

## Output

- **Layer 1:** 8186 notes
- **Layer 2:** 13358 notes
- **Load:** 21544 total notes, 48.30 notes per traced beat, 269.05 notes per second

## Coherence Verdicts

The system issued **1 critical**, **2 warning**, and **3 informational** findings.

### Critical Findings

- tension pipeline saturated - product hitting floor/ceiling.

### Warnings

- tension pipeline stressed - crush factor 45%.
- flicker pipeline strained with 57% crush - multiplicative suppression eroding signal range.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
