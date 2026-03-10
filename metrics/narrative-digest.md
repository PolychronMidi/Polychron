# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-10T03:18:21.716Z | Trace data from: 2026-03-10T03:18:21.321Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **default** conductor profile.

The system processed **393 beats** spanning **69.4 seconds** of musical time.
Layer 1 experienced 186 beats; Layer 2 experienced 207 beats.

## Harmonic Journey

- **Section 1:** D aeolian (origin)
- **Section 2:** F# major (relative-major)
- **Section 3:** A minor (relative-minor)
- **Section 4:** A aeolian (parallel-aeolian (mode-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (66.7% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 262 beats (66.7%) - searching for coherence
- **`coherent`** - 117 beats (29.8%) - operating in harmony
- **`evolving`** - 10 beats (2.5%) - developing new musical ideas
- **`initializing`** - 4 beats (1.0%) - warming up

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 14: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 132: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **393 beat entries**, but the regime controller advanced on only **131 measure-recorder ticks**.
**262** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **141** traced entries.
On the controller cadence, resolved regime time was: `exploring` 99, `coherent` 42, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **26.7%** changing samples, and average phase-coupling coverage **32.3%**.
The longest stale phase run was **6** beats, **287** entries carried stale pair telemetry, and **266** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **508 available**, **1048 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 262 variance-gated), **tension-phase** (0 stale, 262 variance-gated), **flicker-phase** (0 stale, 262 variance-gated).
Telemetry health scored **0.498** with **4** under-seen controller pairs and reconciliation gap **0.292**.
The worst controller/trace reconciliation gaps remained in **tension-entropy** (gap 0.292), **flicker-entropy** (gap 0.240), **density-trust** (gap 0.179).

## Signal Landscape

**Density** ranged from 0.27 to 0.66 (avg 0.49). The density was balanced.
**Tension** ranged from 0.05 to 0.71 (avg 0.58). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.83 to 1.11 (avg 0.98). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.53 (weight 1.40, trusted)
- **stutterContagion**: average score 0.42 (weight 1.31, trusted)
- **phaseLock**: average score 0.38 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **entropyRegulator**: average score 0.24 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.17 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-trust**: avg |r| = 0.508, peak |r| = 0.974

**Coupling health:** 10 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.977), **tension-entropy** (0.931), **tension-flicker** (0.851).

## Output

- **Layer 1:** 6798 notes
- **Layer 2:** 7700 notes
- **Load:** 14498 total notes, 52.91 notes per traced beat, 208.77 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **6 informational** findings.

### Warnings

- 8 tension contributors boosting with constant drag: regimeReactiveDamping (1.18), narrativeTrajectory (1.08), consonanceDissonanceTracker (1.12), harmonicDensityOscillator (1.08), harmonicVelocityMonitor (0.88), tensionResolutionTracker (1.11), tonalAnchorDistanceTracker (1.10), repetitionFatigueMonitor (1.08). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
