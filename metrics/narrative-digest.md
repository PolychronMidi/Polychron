# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-26T07:05:51.739Z | Trace data from: 2026-03-26T07:05:50.950Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **1115 beats** spanning **159.2 seconds** of musical time.
Layer 1 experienced 473 beats; Layer 2 experienced 642 beats.

## Harmonic Journey

- **Section 1:** C mixolydian (origin)
- **Section 2:** F dorian (parallel-dorian (palette-break))
- **Section 3:** C mixolydian (fifth-up (key-shift))
- **Section 4:** E major (relative-major (repeat-escape))
- **Section 5:** Eb minor (mediant-flip)
- **Section 6:** G major (relative-major)
- **Section 7:** Bb minor (relative-minor)

## The System's Inner Life

The system spent most of its time **operating in harmony** (40.4% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 450 beats (40.4%) - operating in harmony
- **`exploring`** - 388 beats (34.8%) - searching for coherence
- **`evolving`** - 273 beats (24.5%) - developing new musical ideas
- **`initializing`** - 4 beats (0.4%) - warming up

### Regime Transitions

The system underwent **49 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 12: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 28: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 30: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 68: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 72: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 80: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 122: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 125: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 132: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 135: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 140: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 181: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 183: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)
- Beat 186: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)

### Controller Cadence

The emitted trace contains **1115 beat entries**, but the regime controller advanced on only **545 measure-recorder ticks**.
**570** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **473** traced entries.
On the controller cadence, resolved regime time was: `exploring` 256, `coherent` 241, `evolving` 182.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **80.3%** changing samples, and average phase-coupling coverage **99.6%**.
The longest stale phase run was **6** beats, **220** entries carried stale pair telemetry, and **4** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **4444 available**, **0 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
Telemetry health scored **0.427** with **4** under-seen controller pairs and reconciliation gap **0.178**.
The worst controller/trace reconciliation gaps remained in **flicker-phase** (gap 0.178), **tension-trust** (gap 0.161), **density-tension** (gap 0.142).

## Signal Landscape

**Density** ranged from 0.33 to 0.77 (avg 0.53). The density was balanced.
**Tension** ranged from 0.08 to 1.00 (avg 0.90). Tension levels were moderate throughout.
**Flicker** ranged from 0.81 to 1.28 (avg 1.00). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.54 (weight 1.40, trusted)
- **stutterContagion**: average score 0.40 (weight 1.30, trusted)
- **phaseLock**: average score 0.40 (weight 1.30, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, trusted)
- **entropyRegulator**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **restSynchronizer**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 9 hotspot pairs (p95 > 0.70) -- system stressed.

## Output

- **Layer 1:** 18727 notes
- **Layer 2:** 25583 notes
- **Load:** 44310 total notes, 49.51 notes per traced beat, 278.31 notes per second

## Coherence Verdicts

The system issued **1 critical**, **5 warning**, and **4 informational** findings.

### Critical Findings

- tension pipeline saturated - product hitting floor/ceiling.

### Warnings

- tension pipeline stressed - crush factor 40%.
- Pipelines hitting floor/ceiling frequently: tension (81%).
- flicker-entropy strongly co-evolving (r=0.741) - these dimensions may be driven by a shared input or feedback loop.
- tension product soft-capped at 1.5431 (raw 1.6513) - soft envelope compressing high product.
- 8 density contributors suppressing with constant drag: pipelineCouplingManager (0.81), structuralNarrativeAdvisor (1.14), chromaticSaturationMonitor (1.08), harmonicRhythmDensityRatio (0.88), rhythmicComplexityGradient (0.90), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
