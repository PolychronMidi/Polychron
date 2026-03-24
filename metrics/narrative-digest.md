# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-24T03:02:32.884Z | Trace data from: 2026-03-24T03:02:32.330Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **544 beats** spanning **82.5 seconds** of musical time.
Layer 1 experienced 236 beats; Layer 2 experienced 308 beats.

## Harmonic Journey

- **Section 1:** D minor (origin)
- **Section 2:** A minor (fifth-up)
- **Section 3:** C# major (relative-major (key-shift))
- **Section 4:** G minor (parallel-minor (palette-break))
- **Section 5:** C major (fourth-up)

## The System's Inner Life

The system spent most of its time **searching for coherence** (62.5% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 340 beats (62.5%) - searching for coherence
- **`coherent`** - 157 beats (28.9%) - operating in harmony
- **`evolving`** - 43 beats (7.9%) - developing new musical ideas
- **`initializing`** - 4 beats (0.7%) - warming up

### Regime Transitions

The system underwent **7 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 18: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 106: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 272: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 296: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 473: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 478: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)

### Controller Cadence

The emitted trace contains **544 beat entries**, but the regime controller advanced on only **215 measure-recorder ticks**.
**329** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **169** traced entries.
On the controller cadence, resolved regime time was: `exploring` 156, `coherent` 70, `evolving` 21.
The controller recorded **3 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **18.2%** changing samples, and average phase-coupling coverage **48.4%**.
The longest stale phase run was **6** beats, **444** entries carried stale pair telemetry, and **281** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1052 available**, **1108 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 277 variance-gated), **tension-phase** (0 stale, 277 variance-gated), **flicker-phase** (0 stale, 277 variance-gated).
Telemetry health scored **0.371** with **2** under-seen controller pairs and reconciliation gap **0.170**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.170), **density-trust** (gap 0.099).

## Signal Landscape

**Density** ranged from 0.27 to 0.75 (avg 0.51). The density was balanced.
**Tension** ranged from 0.06 to 0.99 (avg 0.65). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.80 to 1.13 (avg 0.93). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.51 (weight 1.38, trusted)
- **phaseLock**: average score 0.41 (weight 1.31, trusted)
- **stutterContagion**: average score 0.31 (weight 1.23, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **entropyRegulator**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.19 (weight 1.14, neutral)
- **cadenceAlignment**: average score 0.15 (weight 1.12, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-flicker**: avg |r| = 0.612, peak |r| = 0.999

**Coupling health:** 4 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **density-flicker** (0.905), **flicker-trust** (0.881).

## Output

- **Layer 1:** 8445 notes
- **Layer 2:** 11316 notes
- **Load:** 19761 total notes, 46.50 notes per traced beat, 239.56 notes per second

## Coherence Verdicts

The system issued **0 critical**, **4 warning**, and **4 informational** findings.

### Warnings

- flicker pipeline strained with 50% crush - multiplicative suppression eroding signal range.
- narrativeTrajectory tension bias clipped: raw 1.1211 - clamped 1.1200. Module exceeding its registered range.
- 7 density contributors suppressing with constant drag: regimeReactiveDamping (0.88), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), syncopationDensityTracker (0.88), climaxProximityPredictor (0.82), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 7 tension contributors boosting with constant drag: regimeReactiveDamping (1.22), pipelineCouplingManager (0.80), consonanceDissonanceTracker (1.14), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.89), tensionResolutionTracker (1.08), repetitionFatigueMonitor (1.08). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
