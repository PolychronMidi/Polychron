# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T00:56:20.688Z | Trace data from: 2026-03-09T00:56:20.227Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **50 beats** spanning **8.2 seconds** of musical time.
Layer 1 experienced 48 beats; Layer 2 experienced 2 beats.

## Harmonic Journey

- **Section 1:** F aeolian (origin)
- **Section 2:** Bb aeolian (fourth-up)
- **Section 3:** Bb dorian (parallel-dorian)
- **Section 4:** D major (relative-major (mode-shift))

## The System's Inner Life

The system spent most of its time **operating in harmony** (48.0% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 24 beats (48.0%) - operating in harmony
- **`exploring`** - 14 beats (28.0%) - searching for coherence
- **`evolving`** - 8 beats (16.0%) - developing new musical ideas
- **`initializing`** - 4 beats (8.0%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 14: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 38: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **50 beat entries**, but the regime controller advanced on only **33 measure-recorder ticks**.
**17** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **41** traced entries.
On the controller cadence, resolved regime time was: `coherent` 26, `exploring` 5, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **critical** with **100.0%** valid samples, **14.0%** changing samples, and average phase-coupling coverage **0.0%**.
The longest stale phase run was **6** beats, **42** entries carried stale pair telemetry, and **50** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **0 available**, **184 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 46 variance-gated), **tension-phase** (0 stale, 46 variance-gated), **flicker-phase** (0 stale, 46 variance-gated).
Telemetry health scored **0.390** with **0** under-seen controller pairs and reconciliation gap **0.000**.

## Signal Landscape

**Density** ranged from 0.36 to 0.47 (avg 0.41). The density was balanced.
**Tension** ranged from 0.10 to 0.39 (avg 0.28). The composition maintained a relaxed tension profile.
**Flicker** ranged from 1.04 to 1.15 (avg 1.11). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **entropyRegulator**: average score 0.51 (weight 1.38, trusted)
- **coherenceMonitor**: average score 0.44 (weight 1.33, trusted)
- **stutterContagion**: average score 0.29 (weight 1.21, trusted)
- **phaseLock**: average score 0.21 (weight 1.16, neutral)
- **feedbackOscillator**: average score 0.20 (weight 1.15, neutral)
- **restSynchronizer**: average score 0.19 (weight 1.15, neutral)
- **convergence**: average score 0.18 (weight 1.13, neutral)
- **cadenceAlignment**: average score 0.16 (weight 1.12, neutral)

The system placed the most faith in **entropyRegulator** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-trust**: avg |r| = 0.804, peak |r| = 0.963
- **flicker-trust**: avg |r| = 0.723, peak |r| = 0.982
- **density-flicker**: avg |r| = 0.710, peak |r| = 0.995

**Coupling health:** 10 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.991), **flicker-trust** (0.972), **density-trust** (0.937), **tension-trust** (0.932), **tension-flicker** (0.888), **entropy-trust** (0.879), **tension-entropy** (0.876).

## Output

- **Layer 1:** 9215 notes
- **Layer 2:** 13667 notes
- **Load:** 22882 total notes, 476.71 notes per traced beat, 2775.05 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **3 informational** findings.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
