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

## The Signal Bridge

**Firewall boundary 1.** `conductorSignalBridge` (crossLayer module) caches conductor signals per-beat via a registered recorder. Exposes: density, tension, flicker, compositeIntensity, sectionPhase, coherenceEntropy, plus hypermeta state (healthEma, systemPhase, exceedanceTrendEma, topologyPhase). CrossLayer modules read the bridge, never the conductor directly.

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

Regime affects: variant selection weights, CIM dial targets, stutter CC coherence scaling (coherent=1.3x, exploring=0.6x), preset selection (coherent->subtle, exploring->stereoWide), exploring brake strength.

The exploring brake applies duration-proportional pressure after 60 L1-only ticks, intent-aware (softer during development, stronger during climax/resolution).

## The Negotiation Engine

**Firewall boundary 2.** Resolves conflicts between competing cross-layer systems. Reads trust weights from `adaptiveTrustScores`. Gates convergence events (trust floor modulated by convergenceTarget and CIM coordination scale). Prevents destructive interference between cadence alignment and stutter contagion.

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
