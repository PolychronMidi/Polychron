# Composition Narrative Digest

> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.
> Generated: 2026-03-08T06:34:55.808Z | Trace data from: 2026-03-08T06:34:55.296Z

## Overview

The composition was generated at **72 BPM** with a tuning reference of **432 Hz**, using the **explosive** conductor profile.

The system processed **542 beats** spanning **65.0 seconds** of musical time.
Layer 1 experienced 225 beats; Layer 2 experienced 317 beats.

## Harmonic Journey

- **Section 1:** F# aeolian (origin)
- **Section 2:** B aeolian (fourth-up)
- **Section 3:** D# major (relative-major (mode-shift))
- **Section 4:** F major (step-down)

## The System's Inner Life

The system spent most of its time **searching for coherence** (92.3% of beats in the `exploring` regime).

Regime breakdown:

- **`exploring`** - 500 beats (92.3%) - searching for coherence
- **`coherent`** - 29 beats (5.4%) - operating in harmony
- **`initializing`** - 9 beats (1.7%) - warming up
- **`evolving`** - 4 beats (0.7%) - developing new musical ideas

### Regime Transitions

The system underwent **3 regime transitions** during the composition.

- Beat 9: transitioned from **initializing** to **evolving** (the system went from warming up to developing new musical ideas)
- Beat 13: transitioned from **evolving** to **coherent** (the system went from developing new musical ideas to operating in harmony)
- Beat 42: transitioned from **coherent** to **exploring** (the system went from operating in harmony to searching for coherence)

### Controller Cadence

The emitted trace contains **542 beat entries**, but the regime controller advanced on only **137 measure-recorder ticks**.
**405** entries reused an existing profiler snapshot and **9** entries landed during warmup.
Beat-level escalation refreshed the profiler on **194** traced entries.
On the controller cadence, resolved regime time was: `exploring` 120, `coherent` 23, `evolving` 4.
The controller recorded **1 forced transition event**.
Phase telemetry closed **warning** with **100.0%** valid samples, **0.5%** changing samples, and average phase-coupling coverage **13.8%**.
The longest stale phase run was **51** beats, **987** entries carried stale pair telemetry, and **467** entries reported zero phase-coupling coverage.
Phase-surface availability resolved to **300 available**, **36 variance-gated**, **1796 stale/stale-gated**, and **0 missing** pair observations across the trace.
The most reconciliation-starved phase pairs were **density-phase** (449 stale, 9 variance-gated), **tension-phase** (449 stale, 9 variance-gated), **flicker-phase** (449 stale, 9 variance-gated).
Telemetry health scored **0.221** with **0** under-seen controller pairs and reconciliation gap **0.000**.
The output-load governor intervened on **527** entries (97.2%), with average guard scale **0.432** and **521** hard clamps.

## Signal Landscape

**Density** ranged from 0.34 to 0.79 (avg 0.56). The density was balanced.
**Tension** ranged from 0.06 to 0.82 (avg 0.50). The composition maintained a relaxed tension profile.
**Flicker** ranged from 0.89 to 1.14 (avg 1.02). Rhythmic variation was moderate.

## Trust Governance

The trust system governed cross-layer module influence through EMA-weighted scores:

- **coherenceMonitor**: average score 0.57 (weight 1.43, trusted)
- **phaseLock**: average score 0.49 (weight 1.37, trusted)
- **stutterContagion**: average score 0.49 (weight 1.37, trusted)
- **entropyRegulator**: average score 0.34 (weight 1.26, trusted)
- **feedbackOscillator**: average score 0.25 (weight 1.18, neutral)
- **restSynchronizer**: average score 0.24 (weight 1.18, neutral)
- **convergence**: average score 0.22 (weight 1.16, neutral)
- **cadenceAlignment**: average score 0.21 (weight 1.16, neutral)

The system placed the most faith in **coherenceMonitor** and was most skeptical of **cadenceAlignment**.

## Pipeline Coupling

Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.

**Coupling health:** 3 hotspot pairs (p95 > 0.70) -- system elevated.
Severe (p95 > 0.85): **entropy-trust** (0.853).

## Output

- **Layer 1:** 7599 notes
- **Layer 2:** 10732 notes
- **Load:** 18331 total notes, 50.64 notes per traced beat, 281.94 notes per second

## Coherence Verdicts

The system issued **0 critical**, **0 warning**, and **2 informational** findings.

---

*This narrative was generated automatically from composition telemetry. For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*
