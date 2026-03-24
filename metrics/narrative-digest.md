# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-24T04:21:32.023Z | Trace data from: 2026-03-24T04:21:31.406Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **691 beats** spanning **80.7 seconds** of musical time.
Layer 1 experienced 333 beats; Layer 2 experienced 358 beats.

## Harmonic Journey

- **Section 1:** D aeolian (origin)
- **Section 2:** F# major (relative-major)
- **Section 3:** A minor (relative-minor)
- **Section 4:** D lydian (parallel-lydian (palette-break))
- **Section 5:** G minor (fourth-up (repeat-escape))

## The System's Inner Life

The system spent most of its time **operating in harmony** (50.4% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 348 beats (50.4%) - operating in harmony
- **`exploring`** - 331 beats (47.9%) - searching for coherence
- **`initializing`** - 6 beats (0.9%) - warming up
- **`evolving`** - 6 beats (0.9%) - developing new musical ideas

### Regime Transitions

The system underwent **26 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 66: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 77: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 130: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 164: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 167: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 179: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 202: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 239: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 252: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 309: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 342: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 361: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 364: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **691 beat entries**, but the regime controller advanced on only **302 measure-recorder ticks**.
**389** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **255** traced entries.
On the controller cadence, resolved regime time was: `exploring` 174, `coherent` 169, `evolving` 8.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **23.9%** changing samples, and average phase-coupling coverage **80.0%**.
The longest stale phase run was **6** beats, **525** entries carried stale pair telemetry, and **138** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **2212 available**, **528 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 132 variance-gated), **tension-phase** (0 stale, 132 variance-gated), **flicker-phase** (0 stale, 132 variance-gated).
Telemetry health scored **0.464** with **4** under-seen controller pairs and reconciliation gap **0.218**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.218), **density-tension** (gap 0.116), **tension-phase** (gap 0.100).

## Signal Landscape

**Density** ranged from 0.28 to 0.71 (avg 0.48). The density was balanced.
**Tension** ranged from 0.09 to 0.85 (avg 0.58). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.79 to 1.15 (avg 0.95). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **stutterContagion**: average score 0.42 (weight 1.32, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **entropyRegulator**: average score 0.24 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.18, neutral)
- **roleSwap**: average score 0.21 (weight 1.15, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.

## Output

- **Layer 1:** 12981 notes
- **Layer 2:** 13707 notes
- **Load:** 26688 total notes, 50.35 notes per traced beat, 330.86 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **4 informational** findings.

### Warnings

- density-flicker strongly anti-correlated (r=-0.716) - these dimensions may be driven by a shared input or feedback loop.
- narrativeTrajectory tension bias clipped: raw 1.1327 - clamped 1.1311. Module exceeding its registered range.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
