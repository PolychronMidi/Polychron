# SRC Full Reference

Detailed reference for [`src/`](../src/), distilled from the former per-topic docs. Keep
this as the single source of truth for composition architecture, tuning
context, subsystem responsibilities, and design primitives.

<!-- doc-infra-nav:start -->
## Navigation

- [Engine Model](#engine-model)
- [Subsystem Map](#subsystem-map)
- [Conductor Pipeline](#conductor-pipeline)
- [Layer Isolation](#layer-isolation)
- [Boundaries](#boundaries)
- [Module Registry](#module-registry)
- [Key Systems](#key-systems)
  - [Stutter](#stutter)
  - [Coordination Independence Manager](#coordination-independence-manager)
  - [Hypermeta Controllers](#hypermeta-controllers)
  - [Trust Ecology](#trust-ecology)
  - [Feedback](#feedback)
  - [Convergence](#convergence)
  - [Metaprofiles](#metaprofiles)
  - [Antagonism Bridges](#antagonism-bridges)
- [Tuning Context](#tuning-context)
- [Machine Anchors](#machine-anchors)
  - [directionBias Swap Gate Coupling](#directionbias-swap-gate-coupling)
  - [directionBias Articulation Contrast Coupling](#directionbias-articulation-contrast-coupling)
  - [directionBias Voicing Spread Coupling](#directionbias-voicing-spread-coupling)
  - [contourShape Surge and Groove Couplings](#contourshape-surge-and-groove-couplings)
- [Calibration Anchors](#calibration-anchors)
- [Diagnostics](#diagnostics)
<!-- doc-infra-nav:end -->

## Engine Model

Polychron generates MIDI through two polyrhythmic layers. Each layer is
independent enough to retain its own timing and state, but coupled enough to
create convergence, feedback, imitation, friction, and relief.

One beat has this shape:

```text
conductor tick
  -> compute density / tension / flicker / regime products
  -> processBeat(layer)
  -> playNotes()
  -> crossLayerBeatRecord()
  -> update trust, feedback, convergence, and diagnostics
```

The conductor decides global conditions. Cross-layer modules negotiate how the
two layers interact. The play loop emits notes and records what actually
happened.

## Subsystem Map

- [`src/utils/`](../src/utils/) - validators, registries, lifecycle helpers, random helpers,
  L0 event bus, trust-system names, safe preboot utilities.
- [`src/conductor/`](../src/conductor/) - signal pipeline, profiles, regime detection, dampening,
  coupling management, hypermeta controllers, diagnostics.
- [`src/rhythm/`](../src/rhythm/) - pattern generation, rhythm helpers, drum support, feedback
  listeners.
- [`src/time/`](../src/time/) - `LayerManager`, tempo feel, timing units, phrase/section time.
- [`src/composers/`](../src/composers/) - composer families, voice management, motif logic,
  harmonic material.
- [`src/fx/`](../src/fx/) - stutter variants, pan/balance, binaural/noise/color effects.
- [`src/crossLayer/`](../src/crossLayer/) - rhythm, harmony, dynamics, structure, trust, convergence,
  CIM, feedback, melodic/rhythmic emergence.
- [`src/writer/`](../src/writer/) - CSV/MIDI output and finale writing.
- [`src/play/`](../src/play/) - beat loop, emission path, layer passes, feedback graph contract.

Directory-level README files carry local rules where the directory has its own
cohesion boundary. The HME dir-intent index reads those README metadata blocks.

## Conductor Pipeline

The conductor computes three core products every beat:

- **Density product:** how many notes to emit.
- **Tension product:** harmonic and structural intensity.
- **Flicker product:** micro-oscillation and surface instability.

Recorders tick through `conductorIntelligence.runRecorders(ctx)`. They are
L1-only unless they are explicitly layer-safe. `conductorSignalBridge` is the
exception: it refreshes the read-only conductor snapshot used by cross-layer
modules.

Bias providers register density, tension, and flicker influences. Bias bounds
are locked by `src/scripts/pipeline/bias-bounds-manifest.json` and checked by the
hypermeta-jurisdiction validator.

## Layer Isolation

L1 and L2 alternate through `LM.activate()`.

On activation:

1. Save outgoing layer globals into `LM.perLayerState`.
2. Restore incoming layer globals.
3. Advance the PRNG on L2 to avoid mirrored randomness.

Use `LM.perLayerState` or `byLayer` maps for mutable state that is written in a
per-layer pass and later read by both layers. Shared state is allowed only when
the value is truly global, such as system-wide pressure or total history.

## Boundaries

- Cross-layer code reads conductor state through `conductorSignalBridge`.
- Cross-layer code does not register conductor biases directly.
- Cross-module event flow should prefer L0 channels over hidden direct calls.
- `systemDynamicsProfiler` is for conductor/coupling internals; cross-layer
  regime reads use `regimeClassifier` or the bridge.
- Timing units (`spBeat`, `spDiv`, etc.) are owned by timing setup functions.
  Do not mutate them ad hoc.

## Module Registry

[`src/utils/moduleLifecycle.js`](../src/utils/moduleLifecycle.js) is the stepping-stone dependency registry. A
manifest declares:

- `deps`
- `provides`
- `init(deps)`
- `crossLayerScopes`
- `conductorScopes`
- `recorder`
- `stateProvider`

Boot order:

1. `parseControls()`
2. `moduleLifecycle.initializeAll()`
3. bootstrap global assertion
4. lifecycle resets through conductor and cross-layer managers

Legacy IIFEs and `registerInitializer()` still coexist during incremental
migration. New work should prefer explicit manifests when it reduces guard code
or hidden ordering.

## Key Systems

### Stutter

Nineteen variants self-register through `stutterVariants.register()`. Selection
uses weighted random choice across regime, phase, articulation, harmonic
distance, coupling labels, entropy reversal, call-response history, phrase
position, hocket mode, and inverse-frequency balancing.

Emission has two gates:

- pattern gate from Euclidean/binary/hex/random/onset/rotate patterns
- probabilistic gate scaled by sustain, variant self-gate, density, tension,
  feedback, emission gap, convergence memory, and phrase ramp

Add a variant by creating `src/fx/stutter/variants/<name>.js`, registering it,
requiring it from `variants/index.js`, and adding regime weights.

### Coordination Independence Manager

`coordinationIndependenceManager` owns twelve dials from 0 independent to 1
coordinated:

- `restSync-rhythmComplement`
- `stutterContagion-stutterVariants`
- `spectralComp-velocityInterference`
- `feedbackOsc-emergentDownbeat`
- `stutterChannels-coordination`
- `harmonic-pitchCorrection`
- `rhythm-phaseLockGravity`
- `rhythm-grooveConvergence`
- `dynamics-envelopeInterference`
- `dynamics-articulationTexture`
- `structure-trustNegotiation`
- `motif-echoIdentity`

Targets blend phase, regime, topology, section intent, entropy, density, canon
mode, and effectiveness. CIM sets dials; each target module decides what its
dial means.

### Hypermeta Controllers

Hypermeta controllers tune behavior that used to be hand-adjusted. Do not
manual-tune constants a controller owns; change the controller logic.

Primary controllers:

1. coupling target adaptation
2. regime distribution equilibrium
3. pipeline product centroid correction
4. flicker range elasticity
5. trust starvation nourishment
6. coherent relaxation
7. entropy PI control
8. progressive dampening strength
9. coupling gain budget
10. meta-observation telemetry
11. controller interaction watchdog
12. coupling energy homeostasis
13. axis energy equilibrator
14. phase energy floor
15. per-pair gain ceilings
16. section-0 warmup ramps
17. `hyperMetaManager` orchestration
18. correlation shuffler

The regime classifier also self-balances coherent share through
`coherentThresholdScale`.

### Trust Ecology

Trust scores are EMA payoffs over named systems in `trustSystems`. Trust affects
negotiation, composer-family bias, starvation recovery, hotspot detection, and
module influence. Never hardcode trust names outside the canonical registry.

### Feedback

Closed-loop controllers register through `closedLoopController.create()` and
enroll in `feedbackRegistry`. Current loop families include coherence monitor,
pipeline balancers, coupling manager, regime damping, entropy regulation,
stutter variant feedback, correlation shuffling, emergent rhythm, rhythmic
contagion, and emergent melody.

`feedbackOscillator` creates cross-layer rhythmic round trips. Damping is 0.55;
energy can drive stutter probability, arc selection, and L0 feedback events.

### Convergence

Convergence systems turn L1/L2 agreement into landmarks:

- `convergenceDetector` detects aligned onsets.
- `convergenceHarmonicTrigger` may fire harmonic bursts on rare convergence.
- `convergenceVelocitySurge` boosts impact after convergence.
- `convergenceMemory` learns beat-position histograms.
- `emergentDownbeat` infers perceived downbeats from convergence, cadence,
  velocity, phase lock, and regime shifts.

### Metaprofiles

Metaprofiles bias regime distribution, coupling topology, trust shape, tension
arc, density envelope, phase energy, composer families, conductor affinity,
section arcs, layer variants, disabled controllers, and prescribed coupling
pairs. They are profile-level fields, not one-off constants.

### Antagonism Bridges

When two modules show strong negative correlation, do not average the conflict
away. Identify the shared upstream and couple both sides to it with opposing
responses. The tension becomes structure.

Bridge workflow:

1. Detect candidates from `src/output/metrics/trace.jsonl`.
2. Record candidates, confirmed bridges, and refutations in
   `tools/HME/runtime/metrics/hme-suspected-upstreams.json`.
3. Add a falsifier before wiring a hypothesis.
4. Re-check correlation after the bridge exists.

The invariant `antagonism-registry-covers-observed-pairs` depends on this
registry.

## Tuning Context

Use this section before changing feedback constants.

Critical constants and relationships:

- `coherenceMonitor.SMOOTHING = 0.55`
- `coherenceMonitor.BIAS_FLOOR = 0.60`
- `coherenceMonitor.BIAS_CEILING = 1.38`
- `entropyRegulator.SMOOTHING = 0.3`
- entropy target blends section arc and section intent
- `profileAdaptation.STREAK_TRIGGER = 6`
- negotiation `playScale` clamp is `[0.4, 1.8]`
- negotiation `stutterScale` clamp is `[0.25, 2.2]`
- trust weight clamp is `[0.4, 1.8]`
- `pipelineCouplingManager.GAIN_INIT = 0.16`
- `GAIN_MIN = 0.08`
- `GAIN_MAX = 0.60`
- `_AXIS_BUDGET = 0.24`
- `axisEnergyEquilibrator.CROSS_INHIBIT_WINDOW = 6`
- `phaseFloorController.RECOVERY_ATTRIBUTION_WINDOW = 12`
- `criticalityEngine.TARGET_RATE = 0.20`
- `feedbackOscillator.DAMPING = 0.55`

Cross-constant invariants:

1. Density ceiling chain: `1.38 * 1.8 = 2.48`; avoid note-cramming.
2. Trust-weight clamp mirrors negotiation play clamp.
3. Entropy has broad internal headroom, but negotiation clamps bound effect.
4. Streak hints activate within a section at default tempo.
5. Coherence monitor half-life stays responsive near two beats.
6. Coupling tail gates scale by regime.
7. Equilibrator tightening is throttled by homeostasis.
8. Low-effectiveness pairs get lower gain ceilings.
9. Coherent gate freezes tightening; coherent share must not monopolize a run.
10. Regime hysteresis uses majority window, not consecutive-only streaks.
11. Phase retraction never blocks genuine collapse recovery.
12. Cross-adjuster inhibit prevents direction reversal, not same-direction
    continuation.

## Machine Anchors

Some validators read this file for names that must stay visible.

Known active coupling labels:

- density-entropy
- density-flicker
- density-phase
- density-tension
- entropy-phase
- entropy-trust
- flicker-entropy
- flicker-phase
- tension-entropy
- tension-flicker
- tension-phase

Melodic coupling sections:

### directionBias Swap Gate Coupling

`directionBias` modulates `dynamicRoleSwap` swap probability. Ascending tendency
suppresses swaps to sustain build; descending tendency amplifies swaps.

### directionBias Articulation Contrast Coupling

`directionBias` modulates `articulationComplement` contrast. Ascending softens
contrast; descending sharpens it.

### directionBias Voicing Spread Coupling

`directionBias` modulates `voiceModulator` chord velocity spread through the L0
emergent melody channel.

### contourShape Surge and Groove Couplings

`contourShape` affects convergence velocity surge, groove transfer damping,
velocity interference, and stutter contagion. Rising arcs tend to build impact
and independence; falling arcs tend to release and converge.

## Calibration Anchors

- Base timing units are immutable outside timing setup.
- Coherent safety floor below 0.88 has been destructive.
- Low coherent share can still sound excellent; coherent share is not a quality
  proxy.
- Repeated density suppression requires a unified budget.
- Per-layer beat-processing state must be per-layer.
- L0 entries can persist across section resets; gate one-time reads.
- Conductor cannot write cross-layer state.
- Trust payoffs must align with regime behavior.
- If the same constant is adjusted three times, convert the issue into a
  self-regulating mechanism.

## Diagnostics

Composition runs write the useful truth to `src/output/metrics/`:

- `trace-summary.json`
- `trace.jsonl`
- `fingerprint-comparison.json`
- `runtime-snapshots.json`
- `adaptive-state.json`
- `feedback_graph.json`
- `conductor-map.md`
- `crosslayer-map.md`

Treat comments and prose as hypotheses. Treat metrics and verified listening
verdicts as evidence.
