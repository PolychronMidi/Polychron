# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T22:50:40.788Z | Trace data from: 2026-03-08T22:50:40.218Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **atmospheric** conductor profile.

The system processed **50 beats** spanning **9.1 seconds** of musical time.
Layer 1 experienced 50 beats; Layer 2 experienced 0 beats.

## Harmonic Journey

- **Section 1:** E lydian (origin)
- **Section 2:** F# lydian (step-up)
- **Section 3:** B lydian (fourth-up)
- **Section 4:** B mixolydian (parallel-mixolydian (mode-shift))
- **Section 5:** E lydian (return-home)

## The System's Inner Life

The system spent most of its time **operating in harmony** (76.0% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 38 beats (76.0%) - operating in harmony
- **`evolving`** - 8 beats (16.0%) - developing new musical ideas
- **`initializing`** - 4 beats (8.0%) - warming up

### Regime Transitions

The system underwent **2 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)

### Controller Cadence

The emitted trace contains **50 beat entries**, but the regime controller advanced on only **21 measure-recorder+beat-escalation ticks**.
**29** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **39** traced entries.
On the controller cadence, resolved regime time was: `coherent` 19, `evolving` 4.
No forced regime transition fired on the controller cadence.
The cadence monopoly diagnostic stayed active at **0.580**: raw non-coherent opportunity reached **0.0%**, but resolved non-coherent share closed at **18.2%** (gap **0.0%**).
Dominant monopoly mode: **coherent-share-monopoly**.
Phase telemetry closed **critical** with **100.0%** valid samples, **16.0%** changing samples, and average phase-coupling coverage **0.0%**.
The longest stale phase run was **6** beats, **41** entries carried stale pair telemetry, and **50** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **0 available**, **184 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 46 variance-gated), **tension-phase** (0 stale, 46 variance-gated), **flicker-phase** (0 stale, 46 variance-gated).
Telemetry health scored **0.390** with **0** under-seen controller pairs and reconciliation gap **0.000**.

## Signal Landscape

**Density** ranged from 0.37 to 0.48 (avg 0.42). The density was balanced.
**Tension** ranged from 0.18 to 0.41 (avg 0.32). The composition maintained a relaxed tension profile.
**Flicker** ranged from 1.04 to 1.14 (avg 1.11). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **entropyRegulator**: average score 0.51 (weight 1.39, trusted)
- **coherenceMonitor**: average score 0.44 (weight 1.33, trusted)
- **stutterContagion**: average score 0.26 (weight 1.19, neutral)
- **phaseLock**: average score 0.21 (weight 1.16, neutral)
- **feedbackOscillator**: average score 0.20 (weight 1.15, neutral)
- **restSynchronizer**: average score 0.20 (weight 1.15, neutral)
- **convergence**: average score 0.18 (weight 1.13, neutral)
- **cadenceAlignment**: average score 0.16 (weight 1.12, neutral)

The system placed the most faith in **entropyRegulator** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-trust**: avg |r| = 0.910, peak |r| = 0.964
- **density-flicker**: avg |r| = 0.907, peak |r| = 0.993
- **flicker-trust**: avg |r| = 0.805, peak |r| = 0.979
- **density-entropy**: avg |r| = 0.591, peak |r| = 0.911
- **tension-flicker**: avg |r| = 0.587, peak |r| = 0.996
- **flicker-entropy**: avg |r| = 0.560, peak |r| = 0.939
- **entropy-trust**: avg |r| = 0.554, peak |r| = 0.764
- **tension-trust**: avg |r| = 0.511, peak |r| = 0.991

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **tension-trust** (0.991), **tension-flicker** (0.988), **density-flicker** (0.980), **flicker-trust** (0.968), **density-tension** (0.952), **flicker-entropy** (0.939), **density-trust** (0.922), **density-entropy** (0.911).

## Output

- **Layer 1:** 12887 notes
- **Layer 2:** 22581 notes
- **Load:** 35468 total notes, 709.36 notes per traced beat, 3908.72 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **2 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
