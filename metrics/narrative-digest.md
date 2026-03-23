# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T00:09:43.956Z | Trace data from: 2026-03-23T00:09:43.625Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **261 beats** spanning **31.2 seconds** of musical time.
Layer 1 experienced 100 beats; Layer 2 experienced 161 beats.

## Harmonic Journey

- **Section 1:** D# minor (origin)
- **Section 2:** A# minor (fifth-up)
- **Section 3:** A# aeolian (parallel-aeolian)

## The System's Inner Life

The system spent most of its time **searching for coherence** (87.4% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 228 beats (87.4%) - searching for coherence
- **`coherent`** - 20 beats (7.7%) - operating in harmony
- **`evolving`** - 9 beats (3.4%) - developing new musical ideas
- **`initializing`** - 4 beats (1.5%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 33: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **261 beat entries**, but the regime controller advanced on only **101 measure-recorder ticks**.
**160** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **80** traced entries.
On the controller cadence, resolved regime time was: `exploring` 87, `coherent` 24, `evolving` 8.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **35.6%** changing samples, and average phase-coupling coverage **36.0%**.
The longest stale phase run was **6** beats, **167** entries carried stale pair telemetry, and **167** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **376 available**, **652 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 163 variance-gated), **tension-phase** (0 stale, 163 variance-gated), **flicker-phase** (0 stale, 163 variance-gated).
Telemetry health scored **0.376** with **2** under-seen controller pairs and reconciliation gap **0.163**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.163), **flicker-trust** (gap 0.081).

## Signal Landscape

**Density** ranged from 0.27 to 0.53 (avg 0.39). The composition leaned toward sparseness.
**Tension** ranged from 0.05 to 0.72 (avg 0.53). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.78 to 1.15 (avg 0.95). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.51 (weight 1.38, trusted)
- **phaseLock**: average score 0.36 (weight 1.27, trusted)
- **stutterContagion**: average score 0.33 (weight 1.25, trusted)
- **entropyRegulator**: average score 0.31 (weight 1.24, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.22 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.16 (weight 1.12, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **density-flicker** (0.903).

## Output

- **Layer 1:** 3937 notes
- **Layer 2:** 6062 notes
- **Load:** 9999 total notes, 44.84 notes per traced beat, 320.63 notes per second

## Coherence Verdicts

The system issued **0 critical**, **3 warning**, and **1 informational** findings.

### Warnings

- flicker pipeline strained with 50% crush - multiplicative suppression eroding signal range.
- flicker-entropy strongly co-evolving (r=0.799) - these dimensions may be driven by a shared input or feedback loop.
- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.22), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.14), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.10), climaxProximityPredictor (1.10), repetitionFatigueMonitor (1.10). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
