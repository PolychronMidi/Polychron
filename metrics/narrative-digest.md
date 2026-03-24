# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-24T13:46:29.853Z | Trace data from: 2026-03-24T13:46:29.127Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **722 beats** spanning **86.1 seconds** of musical time.
Layer 1 experienced 344 beats; Layer 2 experienced 378 beats.

## Harmonic Journey

- **Section 1:** F lydian (origin)
- **Section 2:** Bb lydian (parallel-lydian (palette-break))
- **Section 3:** D major (relative-major (key-shift))
- **Section 4:** F minor (mediant-flip)
- **Section 5:** F lydian (return-home (late-closure))

## The System's Inner Life

The system spent most of its time **operating in harmony** (44.2% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 319 beats (44.2%) - operating in harmony
- **`exploring`** - 313 beats (43.4%) - searching for coherence
- **`evolving`** - 86 beats (11.9%) - developing new musical ideas
- **`initializing`** - 4 beats (0.6%) - warming up

### Regime Transitions

The system underwent **33 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 14: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 64: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 72: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 104: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 118: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 143: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 198: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 259: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 294: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 337: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 345: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 347: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 426: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 444: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **722 beat entries**, but the regime controller advanced on only **324 measure-recorder ticks**.
**398** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **334** traced entries.
On the controller cadence, resolved regime time was: `coherent` 187, `exploring` 175, `evolving` 29.
The controller recorded **3 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **56.2%** changing samples, and average phase-coupling coverage **99.0%**.
The longest stale phase run was **6** beats, **315** entries carried stale pair telemetry, and **7** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **2860 available**, **12 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 3 variance-gated), **tension-phase** (0 stale, 3 variance-gated), **flicker-phase** (0 stale, 3 variance-gated).
Telemetry health scored **0.466** with **7** under-seen controller pairs and reconciliation gap **0.286**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.286), **density-trust** (gap 0.275), **tension-entropy** (gap 0.270).

## Signal Landscape

**Density** ranged from 0.31 to 0.69 (avg 0.54). The density was balanced.
**Tension** ranged from 0.08 to 0.89 (avg 0.64). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.87 to 1.14 (avg 1.00). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.52 (weight 1.39, trusted)
- **phaseLock**: average score 0.41 (weight 1.31, trusted)
- **stutterContagion**: average score 0.37 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.21 (weight 1.16, neutral)
- **entropyRegulator**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.19 (weight 1.14, neutral)
- **cadenceAlignment**: average score 0.16 (weight 1.12, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **flicker-trust**: avg |r| = 0.519, peak |r| = 0.987
- **flicker-phase**: avg |r| = 0.505, peak |r| = 0.994

**Coupling health:** 6 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **flicker-phase** (0.918), **density-flicker** (0.870), **flicker-trust** (0.869).

## Output

- **Layer 1:** 17854 notes
- **Layer 2:** 25648 notes
- **Load:** 43502 total notes, 75.26 notes per traced beat, 505.18 notes per second

## Coherence Verdicts

The system issued **0 critical**, **2 warning**, and **1 informational** findings.

### Warnings

- 9 density contributors suppressing with constant drag: regimeReactiveDamping (1.12), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), intervalBalanceTracker (0.92), rhythmicComplexityGradient (0.90), climaxProximityPredictor (0.88), energyMomentumTracker (1.10), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.
- 7 tension contributors boosting with constant drag: regimeReactiveDamping (0.88), pipelineCouplingManager (1.16), narrativeTrajectory (1.12), consonanceDissonanceTracker (1.15), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), repetitionFatigueMonitor (1.09). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
