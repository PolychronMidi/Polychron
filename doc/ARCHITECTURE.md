# Architecture Deep-Dive

Beat lifecycle from conductor to emission, signal flow, layer isolation, and emergence boundaries.

## The Beat Lifecycle

Each beat follows this sequence (per layer pass):

```
globalConductor.update()
  -> gather context (phraseArc, density, harmonicTension, sectionPhase)
  -> compute compositeIntensity
  -> runRecorders(ctx) [L1-only; L2 only runs conductorSignalBridge]
  -> collect density/tension/flicker biases from all registered providers
  -> apply dampening (progressive strength, centroid correction, flicker elasticity)
  -> produce final density/tension/flicker products
  -> dynamismEngine resolves playProb + stutterProb

processBeat(layer, playProb, stutterProb)
  -> sectionIntentCurves.getIntent() [density, dissonance, interaction, entropy, convergence targets]
  -> entropyRegulator.setTarget() + regulate()
  -> setBalanceAndFX() [per-layer balance via LM.perLayerState]
  -> setOtherInstruments() [trust-driven timbre, regime-driven reflection pool]
  -> stutterFade/Pan/FX on flipBin channels
  -> StutterManager.prepareBeat() [variant selection, pattern gate, stereo width]
  -> playNotes() -> playNotesEmitPick() per pick
    -> convergenceVelocitySurge.check()
    -> stutter echo probability (sustain^1.5 * tension * density * ramp * convMemBoost * startSuppress)
    -> StutterManager.scheduleStutterForUnit() [variant dispatch, multi-variant beat]
  -> crossLayerBeatRecord()
    -> CIM.tick()
    -> trustEcologyCharacter.update()
    -> convergenceMemory.record()
    -> stutterContagion.post/apply
    -> feedbackOscillator.applyFeedback
    -> trust score registration for all 27 systems
```

## The Conductor Pipeline

### Signal Products

Three pipeline products computed per beat:

- **Density product** (0.1-2.0): how many notes to emit. Driven by compositeIntensity, profile density range, regulation bias, emission gap correction.
- **Tension product** (0.1-2.0): harmonic dissonance intensity. Driven by arc position, journey distance, climax proximity, regime.
- **Flicker product** (0.4-2.0): micro-oscillation amplitude. Driven by flicker range elasticity, progressive dampening, cross-modulation.

### Recorders

34 registered recorders tick via `conductorIntelligence.runRecorders(ctx)`. The registry gates L2: only `conductorSignalBridge` runs on L2 pass (needs per-layer signal refresh). All other recorders skip L2 to prevent polyrhythmic beat-count asymmetry.

Recorder context carries: `{ absTime, compositeIntensity, currentDensity, harmonicRhythm, layer }`.

### Bias Providers

Modules register density/tension/flicker biases via `conductorIntelligence.registerDensityBias(name, fn, lo, hi)`. At pipeline time, all biases are collected, dampened, and multiplied into the final products. 92 bias registrations are locked against `scripts/bias-bounds-manifest.json`.

**`conductorIntelligence`** is the most-called module in the codebase (282 callers). Never call `getSignalSnapshot()` directly — use `signalReader` (ESLint `no-direct-signal-read`). Cross-layer modules must NOT register biases here — use `crossLayerRegistry` instead (ESLint `no-conductor-registration-from-crosslayer`).

**`conductorState`** holds the mutable per-beat state (densityMultiplier, tension, flicker, regime, playProb, stutterProb, etc). Cross-layer must NOT read this directly — use `conductorSignalBridge.getSignals()` (ESLint `no-direct-conductor-state-from-crosslayer`). `traceDrain` captures snap fields from this into `trace.jsonl`.

## The Signal Bridge

**Firewall boundary 1.** `conductorSignalBridge` (crossLayer module) caches conductor signals per-beat via a registered recorder. CrossLayer modules read the bridge, never the conductor directly. 43 callers — the critical architectural boundary between conductor and crossLayer subsystems.

Exposed fields (17 total):
- Core signals: `density`, `tension`, `flicker`, `compositeIntensity`, `sectionPhase`, `coherenceEntropy`
- Hypermeta state: `healthEma`, `systemPhase`, `exceedanceTrendEma`, `topologyPhase`
- Structural: `regime`, `effectiveDimensionality`, `couplingStrength`, `axisEnergyShares`
- Coupling: `adaptiveTargetSnapshot` (per-pair targets), `regimeProb` (probability distribution over all 7 regimes)

## Layer Isolation (L1/L2)

Two polyrhythmic layers alternate via `LM.activate()`. On every activation:

1. **Save outgoing layer**: `saveGlobalsToLayer()` captures mutable globals into `LM.perLayerState[outgoingLayer]`
2. **Restore incoming layer**: `loadLayerToGlobals()` writes per-layer values back to globals
3. **Restore flipBin**: `flipBin = LM.flipBinByLayer[incomingLayer]`
4. **PRNG decorrelation**: L2 activation advances PRNG 17 steps to break cross-layer sequence coupling

### Per-Layer Globals (LM.perLayerState)

Saved/restored on every `activate()`:
- `crossModulation`, `lastCrossMod` -- polyrhythmic interference intensity
- `balOffset`, `sideBias` -- stereo pan positioning
- `lBal`, `rBal`, `cBal`, `cBal2`, `cBal3` -- derived channel balance values
- `refVar`, `bassVar` -- FX variance

### Closure-Based Per-Layer State

Modules with internal state use `byLayer` maps keyed by `LM.activeLayer`:
- `stutterTempoFeel.emaByLayer` -- stutter density EMA per layer
- `crossLayerDynamicEnvelope.arcTypeByLayer` -- phrase arc type per layer
- `journeyRhythmCoupler.boldnessByLayer` -- harmonic journey energy per layer
- `emissionFeedbackListener.ratioByLayer` -- note emission ratio per layer

### Conductor Recorder L1-Only Gating

`conductorRecorderRegistry.runRecorders()` skips all recorders on L2 pass (except `conductorSignalBridge`). This prevents:
- Beat counters advancing at 2x rate
- Ring buffers filling at wrong timescale
- Orchestration intervals firing twice per measure
- Regime classification operating at double speed

## Adaptive System Infrastructure

### Cross-Run Warm-Start

`metrics/adaptive-state.json` persists terminal EMA values across runs. Loaded at bootstrap by `hyperMetaManagerState` via `loadWarmStartState()`. Fields persisted:

- `healthEma`, `exceedanceTrendEma` — system health and exceedance trend (clamped to [0.4, 0.9] and [0.0, 0.5] on load)
- `systemPhase`, `coherentThresholdScale` — regime self-balancer state
- `cimDials` — CIM coordination dial positions per pair (restores pair-level learning)
- `cimEffectiveness` — per-pair effectiveness EMA (restores controller responsiveness)
- `trustScores` — per-system trust EMAs (restores trust ecology character)

On load, all values are clamped to safe ranges to prevent stressed-state boot loops. If the file is missing or corrupt, all values initialize to nominal defaults. The file is rewritten at the end of each successful run.

### Reconvergence Accelerator

`reconvergenceAccelerator.js` detects structural input discontinuities (e.g., a large section-boundary healthEma jump) and temporarily spikes EMA alphas for fast reconvergence:

- Trigger condition: |healthEma delta| > threshold in a single beat
- Effect: alphas in hyperMetaManager spike to 3-5x normal for 50 beats, decaying back
- Interaction: `regimeTransitionAlphaBoost` independently spikes 3x on regime transitions (decays at 0.88/tick)

Together these prevent the ~30-beat lag where warm-started EMA values pull toward the previous run's terminal state before converging to the new run's actual conditions.

## Regime Classification

7 regime states with hysteresis:

| Regime | Character | Typical Share |
|--------|-----------|--------------|
| `coherent` | Stable, interlocking layers | 30-40% |
| `exploring` | Searching, variety-seeking | 25-40% |
| `evolving` | Transitional, developing | 20-30% |
| `oscillating` | Tension/release cycling | Variable |
| `drifting` | Low-energy wandering | Rare |
| `fragmented` | Disconnected, chaotic | Rare |
| `stagnant` | Locked, no movement | Rare |

**Classifier hysteresis** uses a majority-window: `_REGIME_WINDOW=5` beats, `_REGIME_MAJORITY=3`. A regime is resolved only when ≥3 of the last 5 raw classifications agree. Replaced the prior consecutive-streak approach (R37 E1) because P(3 consecutive coherent | p≈0.1) was near zero — the classifier was effectively blind to low-probability regimes.

**Coherent entry gates:** tensor-product of 3 conditions:
1. `regimeProb.coherent` ≥ `coherentThresholdScale` (self-calibrating, starts 0.65)
2. `effectiveDimensionality` ≥ 3.5 (R37 E2 tightened from 4.0)
3. `couplingStrength` ≤ 0.50 (R37 E3 widened from 0.40)

`coherentThresholdScale` self-balances to maintain target coherent share: nudges up (+0.006/beat) when coherent is over-represented, down (-0.006/beat) when under-represented. Floor 0.55, ceiling 0.85.

Regime affects: variant selection weights, CIM dial targets, stutter CC coherence scaling (coherent=1.3x, exploring=0.6x), preset selection (coherent->subtle, exploring->stereoWide), exploring brake strength.

The exploring brake applies duration-proportional pressure after 60 L1-only ticks, intent-aware (softer during development, stronger during climax/resolution).

## The Negotiation Engine

**Firewall boundary 2.** Resolves conflicts between competing cross-layer systems. Reads trust weights from `adaptiveTrustScores`. Gates convergence events (trust floor modulated by convergenceTarget and CIM coordination scale). Prevents destructive interference between cadence alignment and stutter contagion.

**Axis-attenuated hotspot pressure.** Pair-aware hotspot scoring in `adaptiveTrustScoresHelpers.getSystemPairHotspotProfile()` applies two axis attenuations. (1) Density: `clamp(densityProduct / 0.75, 0.5, 1.0)` — when the conductor deliberately suppresses density (atmospheric/explosive profiles), density-pair pressure attenuates to prevent false cascades. (2) Flicker: `clamp(flickerProduct / 0.75, 0.5, 1.0)` — when flicker is subdued (smooth-tension coupling label), flicker-pair pressure attenuates analogously, preventing simultaneous false hotspot across stutterContagion, feedbackOscillator, rhythmicComplement and other flicker-axis systems. Both attenuations read from `conductorSignalBridge.getSignals()` and apply multiplicatively to any pair name containing the respective axis keyword.

## Emission

`playNotesEmitPick()` emits note events per pick across source/reflection/bass channel families. Per-pick: spectral nudge, harmonic interval guard, register collision avoidance, convergence velocity surge, stutter echo gate.

All cross-layer buffer writes route through `crossLayerEmissionGateway.emit(sourceModule, buffer, event)`.

## Closing the Loop

`crossLayerBeatRecord()` runs after note emission:
1. CIM tick (coordination dial adjustment)
2. Trust ecology character update (dominant system -> composer bias)
3. Convergence memory recording (histogram)
4. Stutter contagion post/apply
5. Temporal gravity density measurement
6. FeedbackOscillator energy exchange
7. Trust score registration for all 27 systems
8. Heat map recording

## Emergence Boundaries

Three architectural membranes:

1. **Conductor -> CrossLayer**: read-only via `conductorSignalBridge`. No conductor module may mutate cross-layer state. ESLint enforced.
2. **CrossLayer -> Conductor**: no direct writes. Only `playProb`/`stutterProb` local modifications and `explainabilityBus` diagnostics.
3. **Inter-module communication**: via `absoluteTimeGrid` (L0) channels, not direct calls. L0 queries should include layer filter when per-layer data is needed.
