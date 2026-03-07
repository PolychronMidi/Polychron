# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-07T21:02:45.814Z | Trace data from: 2026-03-07T21:02:45.428Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **244 beats** spanning **37.8 seconds** of musical time.
Layer 1 experienced 108 beats; Layer 2 experienced 136 beats.

## Harmonic Journey

- **Section 1:** G# lydian (origin)
- **Section 2:** A# lydian (step-down)
- **Section 3:** D major (relative-major (diversity))

## The System's Inner Life

The system spent most of its time **operating in harmony** (69.7% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 170 beats (69.7%) - operating in harmony
- **`evolving`** - 54 beats (22.1%) - developing new musical ideas
- **`initializing`** - 20 beats (8.2%) - warming up

### Regime Transitions

The system underwent **2 regime transitions** during the composition.

- Beat 20: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 74: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)

### Controller Cadence

The emitted trace contains **244 beat entries**, but the regime controller advanced on only **37 measure-recorder ticks**.
**207** entries reused an existing profiler snapshot and **20** entries landed during warmup.
On the controller cadence, resolved regime time was: `coherent` 28, `evolving` 4.
No forced regime transition fired on the controller cadence.

## Signal Landscape

**Density** ranged from 0.34 to 0.76 (avg 0.52). The density was balanced.
**Tension** ranged from 0.06 to 0.78 (avg 0.42). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.96 to 1.22 (avg 1.09). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.42, trusted)
- **stutterContagion**: average score 0.46 (weight 1.35, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.41 (weight 1.30, trusted)
- **restSynchronizer**: average score 0.25 (weight 1.19, neutral)
- **feedbackOscillator**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.22 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.21 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **flicker-phase**: avg |r| = 0.611, peak |r| = 0.969
- **density-trust**: avg |r| = 0.605, peak |r| = 0.949
- **density-flicker**: avg |r| = 0.571, peak |r| = 0.992
- **flicker-trust**: avg |r| = 0.556, peak |r| = 0.945
- **tension-entropy**: avg |r| = 0.514, peak |r| = 0.888

**Coupling health:** 11 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.973), **flicker-phase** (0.959), **density-trust** (0.949), **tension-trust** (0.883).

## Output

- **Layer 1:** 4248 notes
- **Layer 2:** 5238 notes

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **2 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
