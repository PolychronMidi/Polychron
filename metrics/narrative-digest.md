# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-24T00:53:41.203Z | Trace data from: 2026-03-24T00:53:40.525Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **799 beats** spanning **119.2 seconds** of musical time.
Layer 1 experienced 335 beats; Layer 2 experienced 464 beats.

## Harmonic Journey

- **Section 1:** F ionian (origin)
- **Section 2:** Ab minor (relative-minor)
- **Section 3:** Eb minor (fifth-up (repeat-escape))
- **Section 4:** B phrygian (chromatic-mediant-down)
- **Section 5:** F ionian (return-home)

## The System's Inner Life

The system spent most of its time **searching for coherence** (63.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 507 beats (63.5%) - searching for coherence
- **`coherent`** - 253 beats (31.7%) - operating in harmony
- **`evolving`** - 33 beats (4.1%) - developing new musical ideas
- **`initializing`** - 6 beats (0.8%) - warming up

### Regime Transitions

The system underwent **10 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 25: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 61: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 157: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 233: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 465: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 479: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 611: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 688: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 738: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **799 beat entries**, but the regime controller advanced on only **295 measure-recorder ticks**.
**504** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **264** traced entries.
On the controller cadence, resolved regime time was: `exploring` 207, `coherent` 117, `evolving` 13.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **19.7%** changing samples, and average phase-coupling coverage **33.0%**.
The longest stale phase run was **6** beats, **641** entries carried stale pair telemetry, and **535** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1056 available**, **2116 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 529 variance-gated), **tension-phase** (0 stale, 529 variance-gated), **flicker-phase** (0 stale, 529 variance-gated).
Telemetry health scored **0.482** with **4** under-seen controller pairs and reconciliation gap **0.193**.
The worst controller/trace reconciliation gaps remained in **tension-entropy** (gap 0.193), **density-trust** (gap 0.154), **density-flicker** (gap 0.099).

## Signal Landscape

**Density** ranged from 0.29 to 0.65 (avg 0.46). The density was balanced.
**Tension** ranged from 0.06 to 0.87 (avg 0.62). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.79 to 1.16 (avg 0.93). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **stutterContagion**: average score 0.38 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.25 (weight 1.18, neutral)
- **entropyRegulator**: average score 0.21 (weight 1.15, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.19 (weight 1.14, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.

## Output

- **Layer 1:** 12448 notes
- **Layer 2:** 17180 notes
- **Load:** 29628 total notes, 48.81 notes per traced beat, 248.63 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- 7 tension contributors boosting with constant drag: narrativeTrajectory (1.08), consonanceDissonanceTracker (1.13), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.09), tonalAnchorDistanceTracker (1.10), repetitionFatigueMonitor (1.08). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
