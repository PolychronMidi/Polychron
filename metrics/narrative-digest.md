# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-24T04:36:58.451Z | Trace data from: 2026-03-24T04:36:57.902Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **625 beats** spanning **83.7 seconds** of musical time.
Layer 1 experienced 272 beats; Layer 2 experienced 353 beats.

## Harmonic Journey

- **Section 1:** D# ionian (origin)
- **Section 2:** F minor (parallel-minor (palette-break))
- **Section 3:** Ab minor (relative-minor (mode-shift))
- **Section 4:** Bb minor (step-down)
- **Section 5:** D# ionian (return-home (late-closure))

## The System's Inner Life

The system spent most of its time **operating in harmony** (48.2% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 301 beats (48.2%) - operating in harmony
- **`exploring`** - 296 beats (47.4%) - searching for coherence
- **`evolving`** - 24 beats (3.8%) - developing new musical ideas
- **`initializing`** - 4 beats (0.6%) - warming up

### Regime Transitions

The system underwent **19 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 28: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 136: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 166: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 184: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 186: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 212: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 215: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 234: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 274: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 291: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 321: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 326: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 383: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 448: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **625 beat entries**, but the regime controller advanced on only **249 measure-recorder ticks**.
**376** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **201** traced entries.
On the controller cadence, resolved regime time was: `exploring` 146, `coherent` 137, `evolving` 8.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **20.5%** changing samples, and average phase-coupling coverage **73.4%**.
The longest stale phase run was **6** beats, **496** entries carried stale pair telemetry, and **166** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **1836 available**, **648 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 162 variance-gated), **tension-phase** (0 stale, 162 variance-gated), **flicker-phase** (0 stale, 162 variance-gated).
Telemetry health scored **0.507** with **9** under-seen controller pairs and reconciliation gap **0.470**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.470), **density-entropy** (gap 0.468), **tension-entropy** (gap 0.321).

## Signal Landscape

**Density** ranged from 0.26 to 0.63 (avg 0.46). The density was balanced.
**Tension** ranged from 0.09 to 0.78 (avg 0.52). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.85 to 1.12 (avg 1.00). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.52 (weight 1.39, trusted)
- **phaseLock**: average score 0.45 (weight 1.34, trusted)
- **stutterContagion**: average score 0.41 (weight 1.30, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, neutral)
- **entropyRegulator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **flicker-trust**: avg |r| = 0.501, peak |r| = 0.975

**Coupling health:** 10 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **tension-entropy** (0.947), **density-flicker** (0.934), **density-entropy** (0.890), **density-tension** (0.881).

## Output

- **Layer 1:** 10486 notes
- **Layer 2:** 13800 notes
- **Load:** 24286 total notes, 49.16 notes per traced beat, 290.13 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **4 informational** findings.

### Warnings

- 7 density contributors suppressing with constant drag: pipelineCouplingManager (1.09), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
