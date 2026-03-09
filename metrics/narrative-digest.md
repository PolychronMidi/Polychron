# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T08:02:13.513Z | Trace data from: 2026-03-09T08:02:12.912Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **582 beats** spanning **79.7 seconds** of musical time.
Layer 1 experienced 270 beats; Layer 2 experienced 312 beats.

## Harmonic Journey

- **Section 1:** E minor (origin)
- **Section 2:** G# major (relative-major)
- **Section 3:** B minor (relative-minor (mode-shift))
- **Section 4:** D major (mediant-flip)

## The System's Inner Life

The system spent most of its time **searching for coherence** (56.9% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 331 beats (56.9%) - searching for coherence
- **`coherent`** - 235 beats (40.4%) - operating in harmony
- **`evolving`** - 10 beats (1.7%) - developing new musical ideas
- **`initializing`** - 6 beats (1.0%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 16: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 69: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 365: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 548: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **582 beat entries**, but the regime controller advanced on only **233 measure-recorder ticks**.
**349** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **186** traced entries.
On the controller cadence, resolved regime time was: `exploring` 156, `coherent` 105, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **26.1%** changing samples, and average phase-coupling coverage **21.8%**.
The longest stale phase run was **6** beats, **429** entries carried stale pair telemetry, and **455** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **508 available**, **1796 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 449 variance-gated), **tension-phase** (0 stale, 449 variance-gated), **flicker-phase** (0 stale, 449 variance-gated).
Telemetry health scored **0.477** with **3** under-seen controller pairs and reconciliation gap **0.443**.
The worst controller/trace reconciliation gaps remained in **flicker-trust** (gap 0.443), **density-trust** (gap 0.412), **tension-trust** (gap 0.351).

## Signal Landscape

**Density** ranged from 0.33 to 0.80 (avg 0.56). The density was balanced.
**Tension** ranged from 0.06 to 0.97 (avg 0.70). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.83 to 1.18 (avg 1.01). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.42, trusted)
- **stutterContagion**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.45 (weight 1.34, trusted)
- **entropyRegulator**: average score 0.39 (weight 1.29, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.22 (weight 1.17, neutral)
- **cadenceAlignment**: average score 0.21 (weight 1.16, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **flicker-trust** (0.880), **density-flicker** (0.864).

## Output

- **Layer 1:** 11746 notes
- **Layer 2:** 13036 notes
- **Load:** 24782 total notes, 52.28 notes per traced beat, 311.07 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **2 informational** findings.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
