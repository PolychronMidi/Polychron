# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-25T03:20:41.533Z | Trace data from: 2026-03-25T03:20:40.799Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **880 beats** spanning **106.6 seconds** of musical time.
Layer 1 experienced 380 beats; Layer 2 experienced 500 beats.

## Harmonic Journey

- **Section 1:** A ionian (origin)
- **Section 2:** E ionian (fifth-up)
- **Section 3:** G minor (relative-minor)
- **Section 4:** C mixolydian (parallel-mixolydian (palette-break))
- **Section 5:** B major (relative-major (mode-shift))
- **Section 6:** D minor (relative-minor)

## The System's Inner Life

The system spent most of its time **operating in harmony** (45.7% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 402 beats (45.7%) - operating in harmony
- **`exploring`** - 295 beats (33.5%) - searching for coherence
- **`evolving`** - 179 beats (20.3%) - developing new musical ideas
- **`initializing`** - 4 beats (0.5%) - warming up

### Regime Transitions

The system underwent **50 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 29: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 65: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 82: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 109: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 116: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 126: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 222: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 225: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 269: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 271: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 278: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 288: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 328: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **880 beat entries**, but the regime controller advanced on only **422 measure-recorder ticks**.
**458** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **380** traced entries.
On the controller cadence, resolved regime time was: `coherent` 216, `exploring` 173, `evolving` 114.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **75.0%** changing samples, and average phase-coupling coverage **99.4%**.
The longest stale phase run was **6** beats, **220** entries carried stale pair telemetry, and **5** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **3500 available**, **4 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 1 variance-gated), **tension-phase** (0 stale, 1 variance-gated), **flicker-phase** (0 stale, 1 variance-gated).
Telemetry health scored **0.338** with **2** under-seen controller pairs and reconciliation gap **0.203**.
The worst controller/trace reconciliation gaps remained in **tension-flicker** (gap 0.203), **density-tension** (gap 0.149).

## Signal Landscape

**Density** ranged from 0.30 to 0.65 (avg 0.48). The density was balanced.
**Tension** ranged from 0.08 to 0.82 (avg 0.61). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.92 to 1.18 (avg 1.06). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.43 (weight 1.32, trusted)
- **stutterContagion**: average score 0.39 (weight 1.30, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **entropyRegulator**: average score 0.24 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.

## Output

- **Layer 1:** 14865 notes
- **Layer 2:** 20337 notes
- **Load:** 35202 total notes, 50.29 notes per traced beat, 330.38 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **2 informational** findings.

### Warnings

- 10 density contributors suppressing with constant drag: regimeReactiveDamping (1.12), pipelineCouplingManager (1.16), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), syncopationDensityTracker (0.88), climaxProximityPredictor (0.88), energyMomentumTracker (1.10), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
