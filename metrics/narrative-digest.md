# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T07:16:54.515Z | Trace data from: 2026-03-09T07:16:53.966Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **511 beats** spanning **67.1 seconds** of musical time.
Layer 1 experienced 220 beats; Layer 2 experienced 291 beats.

## Harmonic Journey

- **Section 1:** A locrian (origin)
- **Section 2:** D locrian (fourth-up)
- **Section 3:** F# major (relative-major)
- **Section 4:** A major (chromatic-mediant-down)

## The System's Inner Life

The system spent most of its time **searching for coherence** (63.8% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 326 beats (63.8%) - searching for coherence
- **`coherent`** - 177 beats (34.6%) - operating in harmony
- **`initializing`** - 4 beats (0.8%) - warming up
- **`evolving`** - 4 beats (0.8%) - developing new musical ideas

### Regime Transitions

The system underwent **4 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 8: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 85: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 414: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **511 beat entries**, but the regime controller advanced on only **170 measure-recorder ticks**.
**341** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **161** traced entries.
On the controller cadence, resolved regime time was: `exploring` 157, `coherent` 36, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **30.5%** changing samples, and average phase-coupling coverage **30.9%**.
The longest stale phase run was **6** beats, **354** entries carried stale pair telemetry, and **353** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **632 available**, **1396 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 349 variance-gated), **tension-phase** (0 stale, 349 variance-gated), **flicker-phase** (0 stale, 349 variance-gated).
Telemetry health scored **0.493** with **4** under-seen controller pairs and reconciliation gap **0.257**.
The worst controller/trace reconciliation gaps remained in **density-entropy** (gap 0.257), **density-flicker** (gap 0.250), **density-trust** (gap 0.153).

## Signal Landscape

**Density** ranged from 0.34 to 0.74 (avg 0.52). The density was balanced.
**Tension** ranged from 0.06 to 0.85 (avg 0.55). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.75 to 1.10 (avg 0.95). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.41 (weight 1.31, trusted)
- **stutterContagion**: average score 0.39 (weight 1.29, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.18, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.20 (weight 1.15, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **flicker-entropy** (0.910), **density-flicker** (0.887), **entropy-trust** (0.865), **tension-trust** (0.854).

## Output

- **Layer 1:** 8914 notes
- **Layer 2:** 12457 notes
- **Load:** 21371 total notes, 53.97 notes per traced beat, 318.69 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **4 informational** findings.

### Warnings

- tension-flicker strongly anti-correlated (r=-0.781) - these dimensions may be driven by a shared input or feedback loop.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
