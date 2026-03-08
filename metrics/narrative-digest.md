# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T00:35:20.313Z | Trace data from: 2026-03-08T00:35:19.884Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **375 beats** spanning **44.9 seconds** of musical time.
Layer 1 experienced 175 beats; Layer 2 experienced 200 beats.

## Harmonic Journey

- **Section 1:** F# locrian (origin)
- **Section 2:** G# locrian (step-up)
- **Section 3:** G# phrygian (parallel-phrygian (diversity))
- **Section 4:** A locrian (tritone-sub)

## Section Coverage

The trace covered **4** of **4** planned sections.

- **Section 0**: 46 unique traced beats across 62 entries
- **Section 1**: 66 unique traced beats across 92 entries
- **Section 2**: 91 unique traced beats across 109 entries
- **Section 3**: 82 unique traced beats across 112 entries

Trace progress integrity closed **warning** with **90** paired beat keys, **0** duplicate layer-key collisions, and **0** L1 ordering regressions.

## The System's Inner Life

The system spent most of its time **operating in harmony** (53.9% of beats in the `coherent` regime).

Regime breakdown:

- **`coherent`** - 202 beats (53.9%) - operating in harmony
- **`exploring`** - 153 beats (40.8%) - searching for coherence
- **`evolving`** - 16 beats (4.3%) - developing new musical ideas
- **`initializing`** - 4 beats (1.1%) - warming up

### Regime Transitions

The system underwent **5 regime transitions** during the composition.

- Beat 4: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 20: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 105: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)
- Beat 223: transitioned from **exploring** to **coherent** (the system went from searching for coherence to operating in harmony)
- Beat 340: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **375 beat entries**, but the regime controller advanced on only **126 measure-recorder ticks**.
**249** entries reused an existing profiler snapshot and **4** entries landed during warmup.
Beat-level escalation refreshed the profiler on **119** traced entries.
On the controller cadence, resolved regime time was: `coherent` 76, `exploring` 65, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **0.8%** changing samples, and average phase-coupling coverage **21.6%**.
The longest stale phase run was **62** beats, **603** entries carried stale pair telemetry, and **294** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **324 available**, **232 variance-gated**, **928 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (232 stale, 58 variance-gated), **tension-phase** (232 stale, 58 variance-gated), **flicker-phase** (232 stale, 58 variance-gated).
Telemetry health scored **0.294** with **1** under-seen controller pairs and reconciliation gap **0.102**.
The worst controller/trace reconciliation gaps remained in **tension-trust** (gap 0.102).
The output-load governor intervened on **359** entries (95.7%), with average guard scale **0.752** and **351** hard clamps.

## Signal Landscape

**Density** ranged from 0.38 to 0.85 (avg 0.56). The density was balanced.
**Tension** ranged from 0.13 to 0.88 (avg 0.60). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.75 to 1.15 (avg 0.96). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.52 (weight 1.39, trusted)
- **stutterContagion**: average score 0.45 (weight 1.34, trusted)
- **phaseLock**: average score 0.41 (weight 1.31, trusted)
- **entropyRegulator**: average score 0.36 (weight 1.27, trusted)
- **feedbackOscillator**: average score 0.26 (weight 1.20, neutral)
- **restSynchronizer**: average score 0.23 (weight 1.17, neutral)
- **convergence**: average score 0.21 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.19 (weight 1.14, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

The decorrelation engine flagged elevated coupling in:

- **density-trust**: avg |r| = 0.561, peak |r| = 0.971

**Coupling health:** 10 hotspot pairs (p95 > 0.70) -- system stressed.
Severe (p95 > 0.85): **flicker-phase** (0.982), **tension-flicker** (0.969), **density-flicker** (0.939), **density-tension** (0.916), **density-entropy** (0.880), **flicker-entropy** (0.857).

## Output

- **Layer 1:** 6973 notes
- **Layer 2:** 7729 notes
- **Load:** 14702 total notes, 51.59 notes per traced beat, 327.59 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **1 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
