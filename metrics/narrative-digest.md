# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T17:03:12.090Z | Trace data from: 2026-03-09T17:03:11.628Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **434 beats** spanning **60.9 seconds** of musical time.
Layer 1 experienced 223 beats; Layer 2 experienced 211 beats.

## Harmonic Journey

- **Section 1:** C# locrian (origin)
- **Section 2:** C# phrygian (parallel-phrygian)
- **Section 3:** E major (mediant-flip)

## The System's Inner Life

The system spent most of its time **searching for coherence** (49.3% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 214 beats (49.3%) - searching for coherence
- **`coherent`** - 196 beats (45.2%) - operating in harmony
- **`evolving`** - 16 beats (3.7%) - developing new musical ideas
- **`initializing`** - 8 beats (1.8%) - warming up

### Regime Transitions

The system underwent **6 regime transitions** during the composition.

- Beat 8: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 24: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 84: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 276: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 354: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 379: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **434 beat entries**, but the regime controller advanced on only **163 measure-recorder ticks**.
**271** entries reused an existing profiler snapshot and **8** entries landed during warmup.
Beat-level escalation refreshed the profiler on **177** traced entries.
On the controller cadence, resolved regime time was: `exploring` 107, `coherent` 69, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **28.3%** changing samples, and average phase-coupling coverage **17.1%**.
The longest stale phase run was **6** beats, **310** entries carried stale pair telemetry, and **360** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **296 available**, **1408 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 352 variance-gated), **tension-phase** (0 stale, 352 variance-gated), **flicker-phase** (0 stale, 352 variance-gated).
Telemetry health scored **0.486** with **4** under-seen controller pairs and reconciliation gap **0.174**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.174), **tension-flicker** (gap 0.099), **density-tension** (gap 0.091).

## Signal Landscape

**Density** ranged from 0.34 to 0.73 (avg 0.49). The density was balanced.
**Tension** ranged from 0.07 to 0.73 (avg 0.49). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.85 to 1.19 (avg 1.01). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.40, trusted)
- **phaseLock**: average score 0.53 (weight 1.39, trusted)
- **entropyRegulator**: average score 0.44 (weight 1.33, trusted)
- **stutterContagion**: average score 0.44 (weight 1.33, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.25 (weight 1.19, neutral)
- **convergence**: average score 0.22 (weight 1.17, neutral)
- **cadenceAlignment**: average score 0.21 (weight 1.16, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-trust**: avg |r| = 0.523, peak |r| = 0.897

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.904).

## Output

- **Layer 1:** 9319 notes
- **Layer 2:** 8369 notes
- **Load:** 17688 total notes, 54.59 notes per traced beat, 290.67 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **3 informational** findings.

### Warnings

- density-entropy strongly anti-correlated (r=-0.844) - these dimensions may be driven by a shared input or feedback loop.
- tension-entropy strongly co-evolving (r=0.705) - these dimensions may be driven by a shared input or feedback loop.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
