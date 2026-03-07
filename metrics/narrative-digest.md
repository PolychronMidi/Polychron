# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-07T22:15:39.672Z | Trace data from: 2026-03-07T22:15:39.278Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **302 beats** spanning **39.1 seconds** of musical time.
Layer 1 experienced 148 beats; Layer 2 experienced 154 beats.

## Harmonic Journey

- **Section 1:** C# minor (origin)
- **Section 2:** C# dorian (parallel-dorian)
- **Section 3:** G dorian (tritone-sub)

## Section Coverage

The trace covered **3** of **3** planned sections.

- **Section 0**: 148 unique traced beats across 192 entries
- **Section 1**: 58 unique traced beats across 78 entries
- **Section 2**: 28 unique traced beats across 32 entries

## The System's Inner Life

The system spent most of its time **operating in harmony** (49.7% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 150 beats (49.7%) - operating in harmony
- **`exploring`** - 76 beats (25.2%) - searching for coherence
- **`evolving`** - 46 beats (15.2%) - developing new musical ideas
- **`initializing`** - 30 beats (9.9%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 30: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 76: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 226: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **302 beat entries**, but the regime controller advanced on only **53 measure-recorder ticks**.
**249** entries reused an existing profiler snapshot and **30** entries landed during warmup.
On the controller cadence, resolved regime time was: `coherent` 24, `exploring` 20, `evolving` 4.
The controller recorded **1 forced transition event**.

## Signal Landscape

**Density** ranged from 0.34 to 0.81 (avg 0.46). The density was balanced.
**Tension** ranged from 0.07 to 0.71 (avg 0.48). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.86 to 1.19 (avg 0.98). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.50 (weight 1.38, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.41 (weight 1.31, trusted)
- **stutterContagion**: average score 0.33 (weight 1.25, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-flicker**: avg |r| = 0.669, peak |r| = 0.975
- **density-entropy**: avg |r| = 0.531, peak |r| = 0.772

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.975), **density-trust** (0.945), **flicker-trust** (0.921).

## Output

- **Layer 1:** 4745 notes
- **Layer 2:** 5123 notes
- **Load:** 9868 total notes, 42.17 notes per traced beat, 252.63 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **5 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
