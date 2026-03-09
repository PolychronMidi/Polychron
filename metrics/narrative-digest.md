# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-09T00:34:49.987Z | Trace data from: 2026-03-09T00:34:49.455Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **291 beats** spanning **50.5 seconds** of musical time.
Layer 1 experienced 88 beats; Layer 2 experienced 203 beats.

## Harmonic Journey

- **Section 1:** G# locrian (origin)
- **Section 2:** A# locrian (step-down)
- **Section 3:** A# aeolian (parallel-aeolian)
- **Section 4:** A# phrygian (parallel-phrygian (mode-shift))

## The System's Inner Life

The system spent most of its time **searching for coherence** (52.2% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 152 beats (52.2%) - searching for coherence
- **`coherent`** - 130 beats (44.7%) - operating in harmony
- **`initializing`** - 6 beats (2.1%) - warming up
- **`evolving`** - 3 beats (1.0%) - developing new musical ideas

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 9: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 140: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **291 beat entries**, but the regime controller advanced on only **72 measure-recorder ticks**.
**219** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **59** traced entries.
On the controller cadence, resolved regime time was: `exploring` 42, `coherent` 33, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **32.3%** changing samples, and average phase-coupling coverage **16.8%**.
The longest stale phase run was **6** beats, **196** entries carried stale pair telemetry, and **242** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **196 available**, **944 variance-gated**, **0 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (0 stale, 236 variance-gated), **tension-phase** (0 stale, 236 variance-gated), **flicker-phase** (0 stale, 236 variance-gated).
Telemetry health scored **0.258** with **0** under-seen controller pairs and reconciliation gap **0.000**.

## Signal Landscape

**Density** ranged from 0.33 to 0.70 (avg 0.50). The density was balanced.
**Tension** ranged from 0.06 to 0.76 (avg 0.55). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.83 to 1.15 (avg 0.96). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.52 (weight 1.39, trusted)
- **stutterContagion**: average score 0.44 (weight 1.33, trusted)
- **entropyRegulator**: average score 0.34 (weight 1.26, trusted)
- **phaseLock**: average score 0.33 (weight 1.25, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.20 (weight 1.15, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.13, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-flicker**: avg |r| = 0.552, peak |r| = 0.993

**Coupling health:** 5 hotspot pairs (p95 > 0.70) -- system elevated.

## Output

- **Layer 1:** 7985 notes
- **Layer 2:** 15116 notes
- **Load:** 23101 total notes, 101.77 notes per traced beat, 457.61 notes per second

## Coherence Verdicts

The system issued **0 critical**, **1 warning**, and **4 informational** findings.

### Warnings

- 7 density contributors suppressing with constant drag: regimeReactiveDamping (0.92), pipelineCouplingManager (1.16), onsetDensityProfiler (0.90), rhythmicComplexityGradient (1.18), climaxProximityPredictor (1.10), restDensityTracker (0.90), voiceDensityBalancer (0.90). Consider widening registration bounds or adding dynamic response.



*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
