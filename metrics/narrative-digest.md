# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T05:55:42.415Z | Trace data from: 2026-03-08T05:55:42.064Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **50 beats** spanning **12.2 seconds** of musical time.
Layer 1 experienced 32 beats; Layer 2 experienced 18 beats.

## Harmonic Journey

- **Section 1:** F locrian (origin)
- **Section 2:** G locrian (step-up)
- **Section 3:** Bb major (mediant-flip)

## The System's Inner Life

The system spent most of its time **operating in harmony** (50.0% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 25 beats (50.0%) - operating in harmony
- **`evolving`** - 19 beats (38.0%) - developing new musical ideas
- **`initializing`** - 6 beats (12.0%) - warming up

### Regime Transitions

The system underwent **2 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 25: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)

### Controller Cadence

The emitted trace contains **50 beat entries**, but the regime controller advanced on only **29 measure-recorder+beat-escalation ticks**.
**21** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **24** traced entries.
On the controller cadence, resolved regime time was: `coherent` 28, `evolving` 4.
No forced regime transition fired on the controller cadence.
The cadence monopoly diagnostic stayed active at **0.632**: raw non-coherent opportunity reached **0.0%**, but resolved non-coherent share closed at **12.9%** (gap **0.0%**).
Dominant monopoly mode: **coherent-share-monopoly**.
Phase telemetry closed **critical** with **100.0%** valid samples, **0.0%** changing samples, and average phase-coupling coverage **0.0%**.
The longest stale phase run was **35** beats, **69** entries carried stale pair telemetry, and **50** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **0 available**, **96 variance-gated**, **80 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (20 stale, 24 variance-gated), **tension-phase** (20 stale, 24 variance-gated), **flicker-phase** (20 stale, 24 variance-gated).
Telemetry health scored **0.373** with **0** under-seen controller pairs and reconciliation gap **0.000**.
The output-load governor intervened on **44** entries (88.0%), with average guard scale **0.546** and **44** hard clamps.
Guard/coupling interaction: guarded beats had higher exceedance rate (54.5%) vs unguarded (50.0%), delta **0.045**.

## Signal Landscape

**Density** ranged from 0.36 to 0.48 (avg 0.41). The density was balanced.
**Tension** ranged from 0.07 to 0.49 (avg 0.30). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.87 to 1.17 (avg 1.06). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **entropyRegulator**: average score 0.50 (weight 1.38, trusted)
- **coherenceMonitor**: average score 0.44 (weight 1.33, trusted)
- **phaseLock**: average score 0.38 (weight 1.28, trusted)
- **restSynchronizer**: average score 0.23 (weight 1.18, neutral)
- **feedbackOscillator**: average score 0.21 (weight 1.16, neutral)
- **stutterContagion**: average score 0.20 (weight 1.15, neutral)
- **convergence**: average score 0.19 (weight 1.14, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.13, neutral)

The system placed the most faith in **entropyRegulator** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-flicker**: avg |r| = 0.893, peak |r| = 0.992
- **flicker-trust**: avg |r| = 0.713, peak |r| = 0.997
- **density-trust**: avg |r| = 0.698, peak |r| = 0.982
- **flicker-entropy**: avg |r| = 0.651, peak |r| = 0.922
- **density-entropy**: avg |r| = 0.577, peak |r| = 0.889

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **flicker-trust** (0.997), **density-flicker** (0.992), **density-trust** (0.982), **tension-trust** (0.960), **tension-flicker** (0.924), **density-tension** (0.873).

## Output

- **Layer 1:** 7400 notes
- **Layer 2:** 5998 notes
- **Load:** 13398 total notes, 304.50 notes per traced beat, 1096.20 notes per second

## Coherence Verdicts

The system issued **0 critical**, **4 warning**, and **6 informational** findings.

### Warnings

- flicker pipeline strained with 50% crush - multiplicative suppression eroding signal range.
- tension-flicker strongly anti-correlated (r=-0.802) - these dimensions may be driven by a shared input or feedback loop.
- density-flicker strongly co-evolving (r=0.786) - these dimensions may be driven by a shared input or feedback loop.
- density-tension strongly anti-correlated (r=-0.762) - these dimensions may be driven by a shared input or feedback loop.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
