# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T04:41:09.105Z | Trace data from: 2026-03-08T04:41:08.713Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **312 beats** spanning **39.8 seconds** of musical time.
Layer 1 experienced 130 beats; Layer 2 experienced 182 beats.

## Harmonic Journey

- **Section 1:** A aeolian (origin)
- **Section 2:** A dorian (parallel-dorian)
- **Section 3:** C dorian (chromatic-mediant-down)

## The System's Inner Life

The system spent most of its time **operating in harmony** (45.8% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 143 beats (45.8%) - operating in harmony
- **`exploring`** - 143 beats (45.8%) - searching for coherence
- **`evolving`** - 20 beats (6.4%) - developing new musical ideas
- **`initializing`** - 6 beats (1.9%) - warming up

### Regime Transitions

The system underwent **6 regime transitions** during the composition.

- Beat 6: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 26: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 59: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 98: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 138: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 242: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)

### Controller Cadence

The emitted trace contains **312 beat entries**, but the regime controller advanced on only **122 measure-recorder ticks**.
**190** entries reused an existing profiler snapshot and **6** entries landed during warmup.
Beat-level escalation refreshed the profiler on **98** traced entries.
On the controller cadence, resolved regime time was: `coherent` 70, `exploring` 64, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **1.0%** changing samples, and average phase-coupling coverage **17.0%**.
The longest stale phase run was **66** beats, **537** entries carried stale pair telemetry, and **259** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **212 available**, **96 variance-gated**, **916 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (229 stale, 24 variance-gated), **tension-phase** (229 stale, 24 variance-gated), **flicker-phase** (229 stale, 24 variance-gated).
Telemetry health scored **0.312** with **1** under-seen controller pairs and reconciliation gap **0.238**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.238).
The output-load governor intervened on **297** entries (95.2%), with average guard scale **0.470** and **294** hard clamps.
Guard/coupling interaction: guarded beats had lower exceedance rate (7.7%) vs unguarded (13.3%), delta **0.056**.

## Signal Landscape

**Density** ranged from 0.33 to 0.71 (avg 0.48). The density was balanced.
**Tension** ranged from 0.06 to 0.65 (avg 0.47). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.87 to 1.17 (avg 0.99). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.48 (weight 1.36, trusted)
- **stutterContagion**: average score 0.44 (weight 1.33, trusted)
- **phaseLock**: average score 0.40 (weight 1.30, trusted)
- **entropyRegulator**: average score 0.38 (weight 1.28, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.19, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.18 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **tension-flicker**: avg |r| = 0.508, peak |r| = 0.886

**Coupling health:** 7 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **density-flicker** (0.957), **tension-trust** (0.945), **entropy-trust** (0.880), **flicker-phase** (0.875), **tension-flicker** (0.852).

## Output

- **Layer 1:** 4989 notes
- **Layer 2:** 6680 notes
- **Load:** 11669 total notes, 45.94 notes per traced beat, 293.25 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **5 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
