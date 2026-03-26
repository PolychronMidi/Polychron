# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-26T00:20:41.440Z | Trace data from: 2026-03-26T00:20:40.730Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **973 beats** spanning **133.1 seconds** of musical time.
Layer 1 experienced 399 beats; Layer 2 experienced 574 beats.

## Harmonic Journey

- **Section 1:** F# lydian (origin)
- **Section 2:** G# dorian (parallel-dorian (palette-break))
- **Section 3:** C major (relative-major (repeat-escape))
- **Section 4:** G# dorian (modal-interchange (mode-shift))
- **Section 5:** B dorian (chromatic-mediant-down)
- **Section 6:** D major (mediant-flip (repeat-escape))
- **Section 7:** F# lydian (return-home)

## The System's Inner Life

The system spent most of its time **operating in harmony** (42.1% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 410 beats (42.1%) - operating in harmony
- **`evolving`** - 309 beats (31.8%) - developing new musical ideas
- **`exploring`** - 250 beats (25.7%) - searching for coherence
- **`initializing`** - 4 beats (0.4%) - warming up

### Regime Transitions

The system underwent **29 regime transitions** during the composition.
Here are the 15 most significant:

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 37: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 113: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 123: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 132: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 194: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 198: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 270: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 280: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 357: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 391: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 405: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 454: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 491: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 579: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)

### Controller Cadence

The emitted trace contains **973 beat entries**, but the regime controller advanced on only **483 measure-recorder ticks**.
**490** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **399** traced entries.
On the controller cadence, resolved regime time was: `exploring` 199, `evolving` 191, `coherent` 191.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **80.8%** changing samples, and average phase-coupling coverage **99.5%**.
The longest stale phase run was **6** beats, **187** entries carried stale pair telemetry, and **5** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **3872 available**, **4 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 1 variance-gated), **tension-phase** (0 stale, 1 variance-gated), **flicker-phase** (0 stale, 1 variance-gated).
Telemetry health scored **0.441** with **6** under-seen controller pairs and reconciliation gap **0.269**.
The worst controller/trace reconciliation gaps remained in **density-flicker** (gap 0.269), **entropy-phase** (gap 0.251), **tension-trust** (gap 0.155).

## Signal Landscape

**Density** ranged from 0.30 to 0.77 (avg 0.52). The density was balanced.
**Tension** ranged from 0.08 to 1.00 (avg 0.88). Tension levels were moderate throughout.
**Flicker** ranged from 0.80 to 1.31 (avg 1.05). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.42 (weight 1.32, trusted)
- **stutterContagion**: average score 0.42 (weight 1.31, trusted)
- **feedbackOscillator**: average score 0.27 (weight 1.20, trusted)
- **entropyRegulator**: average score 0.21 (weight 1.16, neutral)
- **restSynchronizer**: average score 0.21 (weight 1.16, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **roleSwap**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.895).

## Output

- **Layer 1:** 15679 notes
- **Layer 2:** 23848 notes
- **Load:** 39527 total notes, 54.07 notes per traced beat, 296.97 notes per second

## Coherence Verdicts

The system issued **1 critical**, **5 warning**, and **3 informational** findings.

### Critical Findings

- tension pipeline saturated - product hitting floor/ceiling.

### Warnings

- tension pipeline stressed - crush factor 31%.
- Pipelines hitting floor/ceiling frequently: tension (74%).
- density-tension strongly co-evolving (r=0.731) - these dimensions may be driven by a shared input or feedback loop.
- tension product soft-capped at 1.4157 (raw 1.4163) - soft envelope compressing high product.
- 9 density contributors suppressing with constant drag: regimeReactiveDamping (1.10), pipelineCouplingManager (1.20), structuralNarrativeAdvisor (1.14), harmonicRhythmDensityRatio (0.88), intervalExpansionContractor (1.08), rhythmicComplexityGradient (0.90), climaxProximityPredictor (0.88), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
