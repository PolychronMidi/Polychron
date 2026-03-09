# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T05:50:22.594Z | Trace data from: 2026-03-09T05:50:21.831Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **atmospheric** conductor profile.

The system processed **911 beats** spanning **116.4 seconds** of musical time.
Layer 1 experienced 358 beats; Layer 2 experienced 553 beats.

## Harmonic Journey

- **Section 1:** A major (origin)
- **Section 2:** D major (fourth-up)
- **Section 3:** F minor (relative-minor)
- **Section 4:** B minor (tritone-sub)
- **Section 5:** A major (return-home)

## The System's Inner Life

The system spent most of its time **searching for coherence** (54.9% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 500 beats (54.9%) - searching for coherence
- **`coherent`** - 396 beats (43.5%) - operating in harmony
- **`evolving`** - 11 beats (1.2%) - developing new musical ideas
- **`initializing`** - 4 beats (0.4%) - warming up

### Regime Transitions

The system underwent **7 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 15: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 139: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 231: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 384: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 646: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 769: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **911 beat entries**, but the regime controller advanced on only **272 measure-recorder ticks**.
**639** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **283** traced entries.
On the controller cadence, resolved regime time was: `exploring` 186, `coherent` 114, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **19.8%** changing samples, and average phase-coupling coverage **46.9%**.
The longest stale phase run was **6** beats, **730** entries carried stale pair telemetry, and **484** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1708 available**, **1920 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 480 variance-gated), **tension-phase** (0 stale, 480 variance-gated), **flicker-phase** (0 stale, 480 variance-gated).
Telemetry health scored **0.510** with **4** under-seen controller pairs and reconciliation gap **0.406**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.406), **density-entropy** (gap 0.296), **flicker-entropy** (gap 0.251).

## Signal Landscape

**Density** ranged from 0.28 to 0.88 (avg 0.62). The density was balanced.
**Tension** ranged from 0.06 to 0.80 (avg 0.49). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.75 to 1.13 (avg 0.94). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.41, trusted)
- **phaseLock**: average score 0.43 (weight 1.32, trusted)
- **stutterContagion**: average score 0.36 (weight 1.27, trusted)
- **entropyRegulator**: average score 0.29 (weight 1.22, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.22 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-entropy** (0.922), **density-flicker** (0.893), **flicker-entropy** (0.868).

## Output

- **Layer 1:** 15634 notes
- **Layer 2:** 22507 notes
- **Load:** 38141 total notes, 57.70 notes per traced beat, 327.60 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **4 informational** findings.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
