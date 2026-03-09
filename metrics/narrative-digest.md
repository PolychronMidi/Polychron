# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T06:39:37.896Z | Trace data from: 2026-03-09T06:39:37.288Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **596 beats** spanning **83.3 seconds** of musical time.
Layer 1 experienced 254 beats; Layer 2 experienced 342 beats.

## Harmonic Journey

- **Section 1:** C# ionian (origin)
- **Section 2:** E minor (relative-minor)
- **Section 3:** A minor (fourth-up)
- **Section 4:** D# minor (tritone-sub)

## The System's Inner Life

The system spent most of its time **searching for coherence** (69.6% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 415 beats (69.6%) - searching for coherence
- **`coherent`** - 171 beats (28.7%) - operating in harmony
- **`evolving`** - 6 beats (1.0%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 10: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 62: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 419: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 540: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **596 beat entries**, but the regime controller advanced on only **206 measure-recorder ticks**.
**390** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **184** traced entries.
On the controller cadence, resolved regime time was: `exploring` 157, `coherent` 73, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **26.9%** changing samples, and average phase-coupling coverage **32.0%**.
The longest stale phase run was **6** beats, **435** entries carried stale pair telemetry, and **405** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **764 available**, **1604 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 401 variance-gated), **tension-phase** (0 stale, 401 variance-gated), **flicker-phase** (0 stale, 401 variance-gated).
Telemetry health scored **0.522** with **6** under-seen controller pairs and reconciliation gap **0.440**.
The worst controller/trace reconciliation gaps remained in **density-trust** (gap 0.440), **flicker-trust** (gap 0.339), **tension-trust** (gap 0.142).

## Signal Landscape

**Density** ranged from 0.35 to 0.82 (avg 0.56). The density was balanced.
**Tension** ranged from 0.07 to 0.83 (avg 0.50). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.85 to 1.16 (avg 0.92). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.56 (weight 1.42, trusted)
- **phaseLock**: average score 0.47 (weight 1.35, trusted)
- **stutterContagion**: average score 0.45 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.34 (weight 1.26, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.20 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 10 hotspot pairs (p95 > 0.70) -- system stressed.

## Output

- **Layer 1:** 10683 notes
- **Layer 2:** 14525 notes
- **Load:** 25208 total notes, 55.28 notes per traced beat, 302.70 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **6 informational** findings.

### Warnings

- tension-entropy strongly co-evolving (r=0.731) - these dimensions may be driven by a shared input or feedback loop.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
