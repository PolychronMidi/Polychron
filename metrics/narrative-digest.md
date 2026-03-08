# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T18:28:21.893Z | Trace data from: 2026-03-08T18:28:21.456Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **382 beats** spanning **48.5 seconds** of musical time.
Layer 1 experienced 144 beats; Layer 2 experienced 238 beats.

## Harmonic Journey

- **Section 1:** G ionian (origin)
- **Section 2:** D ionian (fifth-up)
- **Section 3:** D mixolydian (parallel-mixolydian)
- **Section 4:** D lydian (parallel-lydian (mode-shift))

## The System's Inner Life

The system spent most of its time **operating in harmony** (54.2% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 207 beats (54.2%) - operating in harmony
- **`exploring`** - 167 beats (43.7%) - searching for coherence
- **`initializing`** - 4 beats (1.0%) - warming up
- **`evolving`** - 4 beats (1.0%) - developing new musical ideas

### Regime Transitions

The system underwent **7 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 8: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 68: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 139: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 208: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 267: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 345: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **382 beat entries**, but the regime controller advanced on only **116 measure-recorder ticks**.
**266** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **106** traced entries.
On the controller cadence, resolved regime time was: `coherent` 69, `exploring` 61, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **32.2%** changing samples, and average phase-coupling coverage **50.3%**.
The longest stale phase run was **6** beats, **258** entries carried stale pair telemetry, and **190** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **768 available**, **744 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 186 variance-gated), **tension-phase** (0 stale, 186 variance-gated), **flicker-phase** (0 stale, 186 variance-gated).
Telemetry health scored **0.243** with **0** under-seen controller pairs and reconciliation gap **0.000**.

## Signal Landscape

**Density** ranged from 0.31 to 0.66 (avg 0.47). The density was balanced.
**Tension** ranged from 0.06 to 0.65 (avg 0.45). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.87 to 1.17 (avg 1.00). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.51 (weight 1.38, trusted)
- **stutterContagion**: average score 0.47 (weight 1.35, trusted)
- **phaseLock**: average score 0.41 (weight 1.31, trusted)
- **entropyRegulator**: average score 0.38 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.22 (weight 1.17, neutral)
- **convergence**: average score 0.21 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 12 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **entropy-phase** (0.900), **flicker-phase** (0.900), **density-flicker** (0.855).

## Output

- **Layer 1:** 5630 notes
- **Layer 2:** 8769 notes
- **Load:** 14399 total notes, 46.75 notes per traced beat, 297.11 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **1 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
