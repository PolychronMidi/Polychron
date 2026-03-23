# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-23T02:22:21.224Z | Trace data from: 2026-03-23T02:22:20.692Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **618 beats** spanning **100.2 seconds** of musical time.
Layer 1 experienced 262 beats; Layer 2 experienced 356 beats.

## Harmonic Journey

- **Section 1:** E dorian (origin)
- **Section 2:** F# dorian (step-up)
- **Section 3:** F# minor (parallel-minor)
- **Section 4:** C minor (tritone-sub)

## The System's Inner Life

The system spent most of its time **searching for coherence** (77.8% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 481 beats (77.8%) - searching for coherence
- **`coherent`** - 113 beats (18.3%) - operating in harmony
- **`evolving`** - 20 beats (3.2%) - developing new musical ideas
- **`initializing`** - 4 beats (0.6%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 19: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 133: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 568: transitioned from **exploring** to **evolving** (the system went from searching for coherence to developing new musical ideas)
- Beat 573: transitioned from **evolving** to **exploring** (the system went from developing new musical ideas to searching for coherence)

### Controller Cadence

The emitted trace contains **618 beat entries**, but the regime controller advanced on only **227 measure-recorder ticks**.
**391** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **208** traced entries.
On the controller cadence, resolved regime time was: `exploring` 196, `coherent` 55, `evolving` 12.
The controller recorded **2 forced transition events**.
Phase telemetry closed **warning** with **100.0%** valid samples, **24.8%** changing samples, and average phase-coupling coverage **32.5%**.
The longest stale phase run was **6** beats, **464** entries carried stale pair telemetry, and **417** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **804 available**, **1652 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 413 variance-gated), **tension-phase** (0 stale, 413 variance-gated), **flicker-phase** (0 stale, 413 variance-gated).
Telemetry health scored **0.510** with **9** under-seen controller pairs and reconciliation gap **0.366**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.366), **density-trust** (gap 0.313), **flicker-trust** (gap 0.290).

## Signal Landscape

**Density** ranged from 0.29 to 0.74 (avg 0.49). The density was balanced.
**Tension** ranged from 0.06 to 1.00 (avg 0.70). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.75 to 1.15 (avg 0.95). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.55 (weight 1.41, trusted)
- **phaseLock**: average score 0.46 (weight 1.34, trusted)
- **stutterContagion**: average score 0.45 (weight 1.34, trusted)
- **restSynchronizer**: average score 0.26 (weight 1.20, neutral)
- **entropyRegulator**: average score 0.26 (weight 1.19, neutral)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 8 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **flicker-phase** (0.909), **density-flicker** (0.908).

## Output

- **Layer 1:** 9301 notes
- **Layer 2:** 12593 notes
- **Load:** 21894 total notes, 46.68 notes per traced beat, 218.57 notes per second

## Coherence Verdicts

The system issued **1 critical**, **1 warning**, and **2 informational** findings.

### Critical Findings

- flicker pipeline critical - product 0.6749, crush factor 57%.

### Warnings

- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.22), pipelineCouplingManager (0.90), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.13), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.10), repetitionFatigueMonitor (1.09). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
