# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-20T23:42:07.279Z | Trace data from: 2026-03-20T23:42:06.882Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **381 beats** spanning **59.3 seconds** of musical time.
Layer 1 experienced 172 beats; Layer 2 experienced 209 beats.

## Harmonic Journey

- **Section 1:** D# aeolian (origin)
- **Section 2:** G major (relative-major)
- **Section 3:** Bb minor (mediant-flip)

## The System's Inner Life

The system spent most of its time **searching for coherence** (67.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 257 beats (67.5%) - searching for coherence
- **`coherent`** - 116 beats (30.4%) - operating in harmony
- **`initializing`** - 4 beats (1.0%) - warming up
- **`evolving`** - 4 beats (1.0%) - developing new musical ideas

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 8: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 104: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 182: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 202: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **381 beat entries**, but the regime controller advanced on only **132 measure-recorder ticks**.
**249** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **122** traced entries.
On the controller cadence, resolved regime time was: `exploring` 88, `coherent` 49, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **26.0%** changing samples, and average phase-coupling coverage **30.4%**.
The longest stale phase run was **6** beats, **281** entries carried stale pair telemetry, and **265** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **464 available**, **1044 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 261 variance-gated), **tension-phase** (0 stale, 261 variance-gated), **flicker-phase** (0 stale, 261 variance-gated).
Telemetry health scored **0.388** with **2** under-seen controller pairs and reconciliation gap **0.223**.
The worst controller/trace reconciliation gaps remained in **tension-entropy** (gap 0.223), **density-trust** (gap 0.201).

## Signal Landscape

**Density** ranged from 0.34 to 0.65 (avg 0.47). The density was balanced.
**Tension** ranged from 0.05 to 0.66 (avg 0.48). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.86 to 1.11 (avg 1.03). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **phaseLock**: average score 0.40 (weight 1.30, trusted)
- **stutterContagion**: average score 0.37 (weight 1.28, trusted)
- **entropyRegulator**: average score 0.30 (weight 1.23, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.22 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.946).

## Output

- **Layer 1:** 6474 notes
- **Layer 2:** 7598 notes
- **Load:** 14072 total notes, 52.70 notes per traced beat, 237.25 notes per second

## Coherence Verdicts

The system issued **0 critical**, **3 warning**, and **4 informational** findings.

### Warnings

- flicker pipeline strained with 57% crush - multiplicative suppression eroding signal range.
- 7 density contributors suppressing with constant drag: regimeReactiveDamping (0.91), pipelineCouplingManager (0.90), harmonicRhythmDensityRatio (0.88), syncopationDensityTracker (0.88), climaxProximityPredictor (0.90), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), pipelineCouplingManager (1.13), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.10), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.10), climaxProximityPredictor (0.80). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
