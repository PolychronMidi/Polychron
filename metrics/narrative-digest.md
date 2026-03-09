# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T22:08:09.345Z | Trace data from: 2026-03-09T22:08:08.921Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **324 beats** spanning **39.4 seconds** of musical time.
Layer 1 experienced 144 beats; Layer 2 experienced 180 beats.

## Harmonic Journey

- **Section 1:** G major (origin)
- **Section 2:** G mixolydian (parallel-mixolydian)
- **Section 3:** B major (relative-major (mode-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (73.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 238 beats (73.5%) - searching for coherence
- **`coherent`** - 75 beats (23.1%) - operating in harmony
- **`evolving`** - 6 beats (1.9%) - developing new musical ideas
- **`initializing`** - 5 beats (1.5%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 5: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 11: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 87: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **324 beat entries**, but the regime controller advanced on only **108 measure-recorder ticks**.
**216** entries reused an existing profiler snapshot and **5** entries landed during warmup.
Beat-level escalation refreshed the profiler on **102** traced entries.
On the controller cadence, resolved regime time was: `exploring` 86, `coherent` 30, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **17.6%** changing samples, and average phase-coupling coverage **43.8%**.
The longest stale phase run was **6** beats, **266** entries carried stale pair telemetry, and **182** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **568 available**, **708 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 177 variance-gated), **tension-phase** (0 stale, 177 variance-gated), **flicker-phase** (0 stale, 177 variance-gated).
Telemetry health scored **0.422** with **3** under-seen controller pairs and reconciliation gap **0.164**.
The worst controller/trace reconciliation gaps remained in **flicker-trust** (gap 0.164), **density-trust** (gap 0.160), **tension-trust** (gap 0.125).

## Signal Landscape

**Density** ranged from 0.33 to 0.78 (avg 0.51). The density was balanced.
**Tension** ranged from 0.06 to 0.71 (avg 0.40). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.76 to 1.15 (avg 0.98). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.46 (weight 1.34, trusted)
- **stutterContagion**: average score 0.45 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.38 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.22 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.20 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **tension-entropy**: avg |r| = 0.526, peak |r| = 0.992

**Coupling health:** 8 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **tension-entropy** (0.980), **density-flicker** (0.939), **density-entropy** (0.906), **flicker-entropy** (0.857).

## Output

- **Layer 1:** 5950 notes
- **Layer 2:** 7243 notes
- **Load:** 13193 total notes, 54.29 notes per traced beat, 334.85 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **4 informational** findings.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
