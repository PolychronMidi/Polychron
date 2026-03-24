# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-24T05:57:32.255Z | Trace data from: 2026-03-24T05:57:31.624Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **767 beats** spanning **90.8 seconds** of musical time.
Layer 1 experienced 369 beats; Layer 2 experienced 398 beats.

## Harmonic Journey

- **Section 1:** A# major (origin)
- **Section 2:** C# minor (relative-minor (key-shift))
- **Section 3:** D# minor (step-up)
- **Section 4:** G minor (parallel-minor (palette-break))
- **Section 5:** A# major (return-home)

## The System's Inner Life

The system spent most of its time **searching for coherence** (52.9% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 406 beats (52.9%) - searching for coherence
- **`coherent`** - 321 beats (41.9%) - operating in harmony
- **`evolving`** - 36 beats (4.7%) - developing new musical ideas
- **`initializing`** - 4 beats (0.5%) - warming up

### Regime Transitions

The system underwent **26 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 45: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 80: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 147: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 185: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 188: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 194: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 262: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 273: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 278: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 316: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 331: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 361: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 374: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **767 beat entries**, but the regime controller advanced on only **332 measure-recorder ticks**.
**435** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **291** traced entries.
On the controller cadence, resolved regime time was: `exploring` 194, `coherent` 161, `evolving` 23.
The controller recorded **4 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **62.7%** changing samples, and average phase-coupling coverage **99.5%**.
The longest stale phase run was **6** beats, **285** entries carried stale pair telemetry, and **4** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **3052 available**, **0 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
Telemetry health scored **0.453** with **9** under-seen controller pairs and reconciliation gap **0.205**.
The worst controller/trace reconciliation gaps remained in **tension-phase** (gap 0.205), **entropy-phase** (gap 0.203), **entropy-trust** (gap 0.202).

## Signal Landscape

**Density** ranged from 0.28 to 0.69 (avg 0.50). The density was balanced.
**Tension** ranged from 0.08 to 0.81 (avg 0.65). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.83 to 1.16 (avg 1.01). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.41, trusted)
- **phaseLock**: average score 0.46 (weight 1.35, trusted)
- **stutterContagion**: average score 0.46 (weight 1.34, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **entropyRegulator**: average score 0.24 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **roleSwap**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **tension-entropy** (0.855).

## Output

- **Layer 1:** 13651 notes
- **Layer 2:** 15607 notes
- **Load:** 29258 total notes, 48.76 notes per traced beat, 322.25 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **1 informational** findings.

### Warnings

- flicker pipeline strained with 50% crush - multiplicative suppression eroding signal range.
- narrativeTrajectory tension bias clipped: raw 1.1327 - clamped 1.1279. Module exceeding its registered range.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
