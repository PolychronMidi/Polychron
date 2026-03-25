# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-25T05:14:11.604Z | Trace data from: 2026-03-25T05:14:10.881Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **954 beats** spanning **126.4 seconds** of musical time.
Layer 1 experienced 430 beats; Layer 2 experienced 524 beats.

## Harmonic Journey

- **Section 1:** A# lydian (origin)
- **Section 2:** D major (relative-major (key-shift))
- **Section 3:** G major (fourth-up (repeat-escape))
- **Section 4:** D dorian (parallel-dorian (mode-shift))
- **Section 5:** F mixolydian (parallel-mixolydian (palette-break))
- **Section 6:** G dorian (step-down)
- **Section 7:** A# lydian (return-home (late-closure))

## The System's Inner Life

The system spent most of its time **operating in harmony** (53.8% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 513 beats (53.8%) - operating in harmony
- **`evolving`** - 290 beats (30.4%) - developing new musical ideas
- **`exploring`** - 147 beats (15.4%) - searching for coherence
- **`initializing`** - 4 beats (0.4%) - warming up

### Regime Transitions

The system underwent **40 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 29: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 62: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 71: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 73: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 79: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 106: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 160: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 163: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 172: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 222: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 224: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 239: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 242: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)

### Controller Cadence

The emitted trace contains **954 beat entries**, but the regime controller advanced on only **488 measure-recorder ticks**.
**466** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **430** traced entries.
On the controller cadence, resolved regime time was: `coherent` 303, `evolving` 161, `exploring` 144.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **67.0%** changing samples, and average phase-coupling coverage **99.6%**.
The longest stale phase run was **6** beats, **315** entries carried stale pair telemetry, and **4** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **3800 available**, **0 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
Telemetry health scored **0.450** with **5** under-seen controller pairs and reconciliation gap **0.206**.
The worst controller/trace reconciliation gaps remained in **entropy-trust** (gap 0.206), **flicker-trust** (gap 0.204), **flicker-entropy** (gap 0.182).

## Signal Landscape

**Density** ranged from 0.31 to 0.70 (avg 0.48). The density was balanced.
**Tension** ranged from 0.08 to 0.90 (avg 0.67). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.90 to 1.21 (avg 1.06). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.52 (weight 1.39, trusted)
- **phaseLock**: average score 0.46 (weight 1.34, trusted)
- **stutterContagion**: average score 0.38 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.21 (weight 1.16, neutral)
- **entropyRegulator**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.16 (weight 1.12, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 10 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **entropy-trust** (0.868), **density-flicker** (0.865).

## Output

- **Layer 1:** 17012 notes
- **Layer 2:** 21641 notes
- **Load:** 38653 total notes, 50.00 notes per traced beat, 305.73 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **3 informational** findings.

### Warnings

- 7 density contributors suppressing with constant drag: regimeReactiveDamping (1.12), pipelineCouplingManager (1.09), harmonicRhythmDensityRatio (0.88), syncopationDensityTracker (0.88), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 7 tension contributors boosting with constant drag: regimeReactiveDamping (0.88), narrativeTrajectory (1.10), consonanceDissonanceTracker (1.15), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), dynamicArchitectPlanner (1.08), repetitionFatigueMonitor (1.08). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
