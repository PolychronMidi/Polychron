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

**Regime access in crossLayer modules**: use `safePreBoot.call(() => regimeClassifier.getLastRegime(), 'evolving')` — do NOT call `systemDynamicsProfiler.getSnapshot()` just to read `regime`. `systemDynamicsProfiler` is for the conductor/coupling engine only; `regimeClassifier` is the shared read-only source.

## The Signal Bridge

**Firewall boundary 1.** `conductorSignalBridge` (crossLayer module) caches conductor signals per-beat via a registered recorder. CrossLayer modules read the bridge, never the conductor directly. 43 callers — the critical architectural boundary between conductor and crossLayer subsystems.

Exposed fields (17 total):
- Core signals: `density`, `tension`, `flicker`, `compositeIntensity`, `sectionPhase`, `coherenceEntropy`
- Hypermeta state: `healthEma`, `systemPhase`, `exceedanceTrendEma`, `topologyPhase`
- Structural: `regime`, `effectiveDimensionality`, `couplingStrength`, `axisEnergyShares`
- Coupling: `adaptiveTargetSnapshot` (per-pair targets), `regimeProb` (probability distribution over all 7 regimes)

## Layer Isolation (L1/L2)

Two polyrhythmic layers alternate via `LM.activate()`. On every activation:

1. **Save outgoing layer**: `saveGlobalsToLayer()` captures mutable globals (including flipBin) into `LM.perLayerState[outgoingLayer]`
2. **Restore incoming layer**: `loadLayerToGlobals()` writes per-layer values back to globals
3. **PRNG decorrelation**: L2 activation advances PRNG 17 steps to break cross-layer sequence coupling

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

The exploring brake applies duration-proportional pressure after 60 L1-only ticks, intent-aware (softer during development/exposition: 0.6x, stronger during climax/resolution: 1.4x). R43: coefficient tripled (0.0004→0.0012), cap raised (0.08→0.10) to break 80-beat monopolies. At 80 beats into exploring during climax: pressure = 0.034.

## The Negotiation Engine

**Firewall boundary 2.** Resolves conflicts between competing cross-layer systems. Reads trust weights from `adaptiveTrustScores`. Gates convergence events (trust floor modulated by convergenceTarget and CIM coordination scale). Prevents destructive interference between cadence alignment and stutter contagion.

**Axis-attenuated hotspot pressure.** Pair-aware hotspot scoring in `adaptiveTrustScoresHelpers.getSystemPairHotspotProfile()` applies three attenuations. (1) Density: `clamp(densityProduct / 0.75, 0.5, 1.0)` — when the conductor deliberately suppresses density, density-pair pressure attenuates to prevent false cascades. (2) Flicker: `clamp(flickerProduct / 0.75, 0.5, 1.0)` — when flicker is subdued, flicker-pair pressure attenuates analogously. (3) Semantic coupling-label discount: when a pair's coupling label contains "opposed" (e.g. "phase-opposed-flicker") or is "smooth-tension", a 0.70x discount applies — these indicate creative structural anti-correlations, not trust failures. Coupling labels routed via `conductorSignalBridge.getSignals().couplingLabels` from the profiler's LABEL_MAP (covers density-tension, density-flicker, density-entropy, tension-flicker, tension-entropy, flicker-entropy, density-phase, tension-phase, flicker-phase, entropy-phase, entropy-trust). Without the semantic discount, phase-flicker anti-correlation (p95=0.888) generates chronic hotspot pressure on PHASE_LOCK, FEEDBACK_OSCILLATOR, and STUTTER_CONTAGION despite being a valid compositional pattern.

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

## Emergent Rhythm Engine

**7-way L0 hub.** `emergentRhythmEngine` (`src/crossLayer/rhythm/emergentRhythmEngine.js`) reads 6 L0 channels — `stutterContagion`, `emergentDownbeat`, `feedbackLoop`, `onset` (convergence), `cadenceAlignment`, `regimeTransition` — and fuses them into the `emergentRhythm` L0 channel.

- **Quantization grid**: 16-slot subdivision per regime-adaptive rolling window (exploring: 3 beats, coherent: 1.5, evolving: 2)
- **Metrics**: grid density + syncopation complexity with self-calibrating EMA thresholds
- **Bias output**: 4th link in `getRhythm.js` weight-selection bias chain (after `journeyRhythmCoupler`)
- **Consumers**: `crossModulateRhythms`, `stutterVariants`, `convergenceDetector`, `feedbackOscillator`, `emergentDownbeat`; rhythmic coupling arc (R69+): `stutterContagion` (decay stickiness), `grooveTransfer` (transfer strength), `dynamicRoleSwap` (swap gate), `convergenceVelocitySurge` (surge amp), `rhythmicComplementEngine` (effective density for mode), `motifEcho` (echo probability), `articulationComplement` (contrast strength); R71+: `velocityInterference` (densitySurprise→interference scale), `cadenceAlignment` (biasStrength→resolve threshold), `convergenceHarmonicTrigger` (biasStrength→trigger probability), `verticalIntervalMonitor` (density→collision penalty), `phaseAwareCadenceWindow` (complexity→phase tolerance), `emergentDownbeat` (biasStrength→downbeat score); R72+: `rhythmicPhaseLock` (hotspots→lock threshold), `crossLayerDynamicEnvelope` (complexityEma→envelope amplitude), `convergenceDetector` (complexityEma→momentum decay rate); R73+: `entropyRegulator` (densitySurprise→entropy target spike), `crossLayerSilhouette` (densitySurprise→tracking sharpness), `temporalGravity` (hotspots→gravity well strength), `texturalMirror` (hotspots→texture suggestion weight); R74+: `harmonicIntervalGuard` (hotspots→deadband widening); R75+: `harmonicIntervalGuard` (registerMigrationDir→deadband narrowing/inversion); R89+: `entropyRegulator` (complexity→entropy target), `temporalGravity` (complexity→gravity scale), `feedbackOscillator` (biasStrength→injection energy), `grooveTransfer` (biasStrength→transfer scale); `sectionIntentCurves` (density→intent density floor adjustment)
- **CIM pair**: `feedbackOsc-emergentDownbeat`
- **Feedback enrollment**: `emergentRhythmPort` in `feedbackRegistry`

## Emergent Melodic Engine

**6-tracker synthesis hub.** `emergentMelodicEngine` (`src/crossLayer/melody/emergentMelodicEngine.js`) polls 6 conductor melodic tracker APIs per beat and fuses their signals into the `emergentMelody` L0 channel.

- **Inputs**: `melodicContourTracker` (shape/direction), `intervalDirectionMemory` (freshness), `tessituraPressureMonitor` (register load), `thematicRecallDetector` (recall status), `ambitusMigrationTracker` (register trend), `counterpointMotionTracker` (motion type)
- **Bias surfaces**: `nudgeNoveltyWeight()` amplifies `harmonicIntervalGuard` interval novelty steering when territory is stale; `getMelodicWeights()` adds 12th signal dimension to `stutterVariants`; `getContourAscendBias()` modulates `alienArpeggio` pitch direction by melodic arc
- **Self-calibrating EMAs**: freshnessEma + tessitureEma track running means; L0 post is phrase-gated (every 4+ beats when freshness shock or high tessiture/thematic density)
- **CIM**: `harmonic-pitchCorrection` dial scales noveltyWeight amplification authority
- **Feedback enrollment**: `emergentMelodicPort` in `feedbackRegistry`

### Melodic Coupling Pattern

CrossLayer modules couple to `emergentMelodicEngine` by calling `safePreBoot.call(() => emergentMelodicEngine.getContext(), null)` and reading from the returned context object. Context fields:

| Field | Type | Meaning |
|---|---|---|
| `contourShape` | `'rising'\|'falling'\|'static'\|'arc'` | Overall melodic shape |
| `directionBias` | `float [-1…1]` | Signed ascending (+) / descending (-) bias |
| `ascendRatio` | `float [0…1]` | Fraction of recent intervals that ascend |
| `intervalFreshness` | `float [0…1]` | How novel the current intervals are |
| `freshnessEma` | `float [0…1]` | Smoothed intervalFreshness |
| `tessituraLoad` | `float [0…1]` | Register extremity pressure |
| `tessituraRegion` | string | `'comfortable'\|'high'\|'low'\|'extreme'` |
| `thematicDensity` | `0\|0.5\|1` | Thematic recall presence |
| `counterpoint` | string | `'contrary'\|'similar'\|'oblique'\|'insufficient'` |
| `registerMigrationDir` | string | `'stable'\|'ascending'\|'descending'` |

**Coupling template** (use `V.optionalFinite` for all reads, always fallback to neutral 0.5 or default):
```js
const melodicCtxXxx = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
const intervalFreshness = melodicCtxXxx ? V.optionalFinite(melodicCtxXxx.intervalFreshness, 0.5) : 0.5;
// scale: 0=stale → 1.3x; 0.5=neutral → 1.0x; 1.0=fresh → 0.7x
const freshnessScale = 1.3 - intervalFreshness * 0.6;
```

Coupled modules (38 as of R47): motifEcho, articulationComplement, texturalMirror, restSynchronizer, rhythmicComplementEngine, stutterContagion, rhythmicPhaseLock, feedbackOscillator, convergenceDetector, temporalGravity, verticalIntervalMonitor, phaseAwareCadenceWindow, cadenceAlignment, polyrhythmicPhasePredictor, emergentDownbeat, crossLayerSilhouette, grooveTransfer, velocityInterference, entropyRegulator, dynamicRoleSwap, convergenceHarmonicTrigger, spectralComplementarity, registerCollisionAvoider, convergenceVelocitySurge, motifIdentityMemory, stutterTempoFeel, pitchMemoryRecall, convergenceMemory, crossLayerDynamicEnvelope, negotiationEngine, harmonicIntervalGuard, trustEcologyCharacter, contextualTrust, interactionHeatMap, crossLayerClimaxEngine, coordinationIndependenceManager, emergentRhythmEngine, sectionIntentCurves.

## L0 Channel Evolution

### Dead-End Channel Harvests

Channels that are posted but never consumed are prime evolution targets — they carry information the system already computes but doesn't use. Harvesting them creates new signal pathways without additional computation:

- **R76 E1 `harmonicFunction` → `convergenceHarmonicTrigger`**: `harmonicFunctionGraph` posts `{fn, chordRoot, keyRoot}` per beat (T/S/D/A function). `convergenceHarmonicTrigger` now reads this: when convergence fires with no explicit cadence alignment and melodic direction is indeterminate, harmonic function primes the change type — `D` (dominant) → `tonic-reaffirm`; `T` (tonic) → `dominant-push`. Activates the channel for the first time.
- **R77 E2 `harmonic-journey-eval` → `motifEcho`**: `harmonicJourney` posts `{fromKey, toKey, distance, excursion, quality, effective}` on key transitions (was never consumed). `motifEcho.recordNote()` now suppresses new motif capture within 2s of a high-distance journey (`distance > 2`): echo probability multiplied by `(1 - clamp(distance * 0.08, 0, 0.45))`. Old-key motifs don't echo into a new tonal region.
- **R77 E3 `chord` → `convergenceDetector`**: `cadenceAdvisor` posts `{chords, key, mode}` per beat (was never consumed). `convergenceDetector.detect()` now reads mode: minor tonality adds `+0.06` to `effectiveTolerance` — harmonic tension in minor mode invites rhythmic convergence as resolution.
- **R77 E4 `channel-coherence` → `feedbackOscillator`**: `crossLayerBeatRecord` posts `{coherence, mean}` every beat (was never consumed). `feedbackOscillator.record()` now reads this: when cross-layer channel coherence exceeds 0.70, feedback impulse energy is damped by up to 0.09 — already-synchronized layers don't need more feedback energy pushing them together.
- **R77 E5 `emergentRhythm.hotspots` → `polyrhythmicPhasePredictor`**: `emergentRhythmEngine` posts hotspot arrays per beat. `polyrhythmicPhasePredictor.process()` now reads hotspot count: up to 20% boost to phase-convergence playProb when rhythmically dense moments coincide with predicted convergence points.
- **R77 E8 `emergentRhythm.hotspots` → `registerCollisionAvoider`**: `registerCollisionAvoider.avoid()` now reads hotspot count: up to +2 semitones added to `effectiveCollisionSemitones` at max hotspot density — rhythmic burst moments allow denser vertical clusters (intentional dissonance at peaks).
- **R77 E9 `complexityEma` antagonism bridge — `entropyRegulator ↔ crossLayerSilhouette` (r=-0.660):**
  - `entropyRegulator.setTarget()` reads `rhythmEntry.complexityEma`: above 0.5 baseline, adds up to +0.07 to entropy target — complex rhythmic memory accelerates chaotic texture.
  - `crossLayerSilhouette.tick()` reads `rhythmEntry.complexityEma`: above 0.5 baseline, reduces `effectiveSmoothing` by up to 10% — complex rhythmic inertia stabilizes the form arc (slow-form / fast-chaos coupling).
- **R77 E10 `emergentRhythm.hotspots` → `restSynchronizer`**: `restSynchronizer.evaluateSharedRest()` now subtracts up to 0.08 from rest probability base at max hotspot density — rhythmic burst moments actively defer coordinated breathing.
- **R77 E7 `emergentRhythm.hotspots` → `spectralComplementarity`**: `spectralComplementarity.nudgeToFillGap()` now reads hotspot count from `emergentRhythm`: up to 18% boost to `effectiveNudge` at maximum hotspot density — rhythmic burst moments coincide with stronger spectral register gap-filling.
- **R77 E6 `underusedPitchClasses` → `harmonicIntervalGuard`**: `modalColorTracker` posts `{pitchClasses: underused[]}` per beat when any pitch class falls below 30% of expected modal usage (was never consumed). `harmonicIntervalGuard.nudgePitch()` now reads this array: candidate notes that land on underused pitch classes score -0.10 bonus in the interval selection loop, biasing voice leading toward modally starved pitch classes for complete modal coverage.

### Antagonism Bridges

**Pattern (R73/R75/R76/R77):** When two modules are negatively correlated (r < -0.5), they form a *structural anti-correlation* — their peaks naturally oppose each other. Rather than suppressing this, couple both sides bidirectionally to create *constructive opposition*.

- **R73:** `entropyRegulator ↔ crossLayerSilhouette` (r=-0.696) bridged via `emergentRhythm.densitySurprise` — both sides respond to surprising rhythmic bursts with opposing effects.
- **R75:** `dynamicRoleSwap ↔ harmonicIntervalGuard` bridged via `registerMigrationDir` — ascending register migration amplifies role-swap probability while narrowing HIG interval guard.
- **R76:** `entropyRegulator ↔ climaxEngine` (r=-0.604) bridged bidirectionally:
  - `climaxEngine.tick()` reads `entropy` channel: high smoothed entropy (> 0.55) damps climax accumulation — chaotic texture can't sustain coherent climax peaks.
  - `entropyRegulator.setTarget()` reads `climax-pressure` channel: approaching climax pulls entropy target down — peaks need definition, not chaos.
- **R77:** `stutterContagion ↔ restSynchronizer` (r=-0.382) bridged via `ascendRatio` (fraction of ascending melodic intervals, 0–1):
  - `stutterContagion.checkContagion()`: `ascendRatio > 0.55` boosts `melodicContagionScale` up to +0.135 — ascending melodic energy intensifies cross-layer stutter spread (climbing phrases become rhythmically infectious).
  - `restSynchronizer.evaluateSharedRest()`: `ascendRatio > 0.55` subtracts up to 0.10 from rest probability base — ascending energy suppresses synchronized breathing (upward motion resists pause).

### Phase Intelligence Coupling (R78)

**New signal: `rhythmicPhaseLock.getMode()`** — ternary state ('lock'/'drift'/'repel') representing the inter-layer timing relationship. First use as a universal coupling signal across multiple systems. Access via `safePreBoot.call(() => rhythmicPhaseLock.getMode(), 'drift')`.

| Mode | Meaning | Expected response |
|---|---|---|
| `lock` | Layers synchronized (< 20% of beat apart) | Reinforce, amplify, consonance, stability |
| `drift` | Layers independent | Neutral, balanced, no coupling pressure |
| `repel` | Layers in opposition (> 60% of beat apart) | Contrast, counterpoint, entropy, sharpness |

- **R78 E1 `rhythmicPhaseLock.getMode()` → `motifEcho`**: Repel mode opens space for imitation (offset layers create natural echo opportunity) — echoProbability ×1.15. Lock mode suppresses echo (synchronized layers reinforce directly, imitation is redundant) — ×0.88.
- **R78 E2 `rhythmicPhaseLock.getMode()` → `stutterContagion`**: Lock mode boosts contagion (synchronized bursts = rhythmic unison, layers stutter together) — ×1.12 scale on gated intensity. Repel mode suppresses (diverging layers should not cascade stutter across each other) — ×0.88.
- **R78 E4 `rhythmicPhaseLock.getMode()` → `crossLayerSilhouette`**: Repel mode sharpens structural tracking (effectiveSmoothing ×0.88 — opposition demands faster correction). Lock mode stabilizes holistic arc (effectiveSmoothing ×1.10 — synchronized layers need less structural correction).
- **R78 E5 `rhythmicPhaseLock.getMode()` → `entropyRegulator`**: Repel mode raises entropy target +0.04 (counter-motion inherently increases pitch/timing diversity). Lock mode lowers target -0.03 (synchronized layers create coherent order).
- **R78 E3 `freshnessEma` → `crossLayerClimaxEngine`**: Novel melodic territory (freshnessEma > 0.60) damps climax accumulation by up to -0.08. Musical logic: fresh intervals already generate their own harmonic tension; piling climax pressure on top creates aural overload.

### Fresher Melodic Territory Coupling (R79)

R79 completes the `freshnessEma` antagonism bridge with `entropyRegulator` (other side already wired in R78) and adds `ascendRatio` + `densitySurprise` as new bridge signals.

- **R79 E1 `freshnessEma` → `entropyRegulator`**: Novel intervals raise entropy target by up to +0.04 (range: 0 at familiar, +0.04 at maximum novelty). **Completes the bridge**: climaxEngine suppresses climax ↓ on fresh melody (R78 E3), entropyRegulator raises entropy ↑ — constructive opposition on the same signal.
- **R79 E2 `ascendRatio` → `entropyRegulator`**: Fraction of ascending melodic intervals (0–1) modulates entropy target ±0.03. Ascending phrases (>0.5) signal exploratory territory → more entropy. Descending phrases signal settling → less. More granular than the ternary `registerMigrationDir` already present.
- **R79 E3 `freshnessEma` → `velocityInterference`**: Novel melodic intervals amplify interference strength (both boost and reduction ceilings ×up to 1.15). Musical logic: fresh territory deserves stronger dynamic contrast to mark the unfamiliar.
- **R79 E4 `densitySurprise` → `stutterContagion`**: Surprising rhythmic density events amplify contagion spread (gated intensity ×up to 1.10). Chaos invites more chaos — unexpected bursts propagate stutter across layers.
- **R79 E5 `densitySurprise` → `restSynchronizer`**: Same surprise signal suppresses synchronized rests by up to -0.06. **Antagonism bridge with E4**: surprise → contagion ↑ + rest ↓. Together: rhythmic chaos keeps both layers active and spreading stutter, never breathing simultaneously.

### Complexity Triple-Bridge (R80)

`complexity` (per-beat rhythmic complexity, 0–1) as the shared currency driving three-way constructive opposition across harmony, arc, and phase.

- **R80 E1 `complexity` → `harmonicIntervalGuard`**: High complexity narrows the consonance deadband by up to -0.04 (tighter harmonic control during complex rhythmic moments). Musical logic: when rhythm is complex, harmony stabilizes to prevent perceptual overload.
- **R80 E2 `complexity` → `crossLayerClimaxEngine`**: High complexity boosts climax accumulation by up to +0.06. Musical logic: complex texture signals compositional density — the structural arc intensifies as rhythmic complexity peaks. **Antagonism bridge with E1**: same signal → harmony tightens while climax accelerates.
- **R80 E3 `rhythmicPhaseLock.getMode()` → `harmonicIntervalGuard`**: Lock mode narrows deadband -0.03 (synchronized layers prefer consonance — harmonic agreement). Repel mode widens +0.04 (opposing layers tolerate more dissonance — harmonic tension from opposition). First phase coupling for HIG.

### complexityEma Antagonism Bridge (R81)

`complexityEma` (long-term rhythmic complexity EMA) as shared currency for slow-memory structural opposition.

- **R81 E1 `complexityEma` → `dynamicRoleSwap`**: Sustained high complexity lowers swap gate by up to +0.08 — dynamics reorganize into new roles as long-term complexity accumulates.
- **R81 E2 `complexityEma` → `crossLayerClimaxEngine`**: Sustained high complexity suppresses climax approach by up to -0.07 — climax backs off rather than pile more energy into an already-complex texture. **Antagonism with E1**: same slow signal → dynamic roles reshuffle while structural arc defers.

### Virgin Antagonist Bridges (R82–R84)

Bridges across virgin or near-virgin negatively-correlated pairs with zero prior coupling.

- **R82 E1 `registerMigrationDir` → `crossLayerSilhouette ↔ phaseAwareCadenceWindow`** (r=-0.539): ascending register migration tightens silhouette form smoothing (×0.92) while simultaneously compressing the cadence window (-0.05). Form firms up while resolution is resisted — harmonic destabilization paired with structural firmness.
- **R82 E2 `tessituraLoad` → `harmonicIntervalGuard ↔ stutterContagion`**: extreme register extremity narrows harmonic deadband (tighter harmonic control, up to -0.04) while amplifying stutter contagion (×up to 1.12). Chaos diversifies at extremes while harmony simultaneously stabilizes.
- **R83 E1 `ascendRatio` → `velocityInterference ↔ harmonicIntervalGuard`** (r=-0.388): ascending melodic momentum amplifies velocity interference strength (×up to 1.12) while narrowing harmonic deadband (up to -0.04). Dynamic contrast intensifies as harmony tightens during upward energy.
- **R84 E1 `complexity` → `verticalIntervalMonitor ↔ dynamicRoleSwap`** (r=-0.512): per-beat rhythmic complexity raises collision penalty (×up to 1.10) while lowering the role-swap gate (up to +0.06). Vertical tightening + dynamic reshuffling at complex beats — dual response from harmony and dynamics.

### intervalFreshness + densitySurprise Antagonism Bridges (R85)

Recovers the `intervalFreshness` dimension (absent since R63) across two new virgin pairs, plus `densitySurprise` completing the harmonicIntervalGuard↔climaxEngine bridge.

- **R85 E1 `intervalFreshness` → `entropyRegulator ↔ crossLayerSilhouette`** (r=-0.685, strongest pair): novel intervals raise entropy target (up to +0.04) while sharpening silhouette structural tracking (up to -9% smoothing). Chaos expands into uncharted melodic territory while form holds tighter — the strongest constructive opposition in the system.
- **R85 E2 `intervalFreshness` → `dynamicRoleSwap ↔ temporalGravity`** (r=-0.343): novel intervals lower the role-swap gate (up to +0.05) while strengthening temporal gravity wells (×up to 1.12). Dynamic roles reshuffle as time pulls tighter — alien temporal displacement paired with role chaos.
- **R85 E3 `densitySurprise` → `harmonicIntervalGuard ↔ crossLayerClimaxEngine`** (r=-0.354): surprise rhythmic events narrow the harmonic deadband (up to -0.05) while backing off climax approach (up to -0.06). Form stabilizes under surprise while the structural arc defers — harmony holds while the climax waits.

### biasStrength + complexityEma + thematicDensity Triple-Dimension Bridge (R86)

Three new signals bridging three pairs, recovering `thematicDensity` (absent 6 rounds) and introducing `biasStrength` (first use in antagonism bridges).

- **R86 E1 `biasStrength` → `temporalGravity ↔ verticalIntervalMonitor`** (r=-0.477): confident rhythmic pulse strengthens gravity wells (×up to 1.15) while reducing collision penalty (×down to 0.90). Temporal cohesion + harmonic freedom at rhythmically confident moments.
- **R86 E2 `complexityEma` → `velocityInterference ↔ harmonicIntervalGuard`** (r=-0.408): sustained rhythmic complexity amplifies velocity interference (×up to 1.10) while narrowing harmonic deadband (up to -0.03). Dynamics intensify while harmony stabilizes — slow-memory complexity creates dual-response.
- **R86 E3 `thematicDensity` → `harmonicIntervalGuard ↔ crossLayerClimaxEngine`** (r=-0.354): rich thematic development narrows harmonic deadband (up to -0.04) while accelerating climax approach (up to +0.05). Harmony stabilizes while the structural arc intensifies during peak thematic richness.

### registerMigrationDir Five-Point Bridge (R87)

One categorical signal — ascending vs. descending register migration — wired across five modules as two antagonism pairs plus a solo amplifier.

- **R87 E1 `registerMigrationDir` → `grooveTransfer ↔ crossLayerClimaxEngine`** (r=-0.499, virgin pair): ascending register migration tightens groove transfer (×0.88 damping, rhythmic independence) while accelerating climax approach (+0.05). Rhythm stabilizes while structure climbs — layers individuate as the arc builds.
- **R87 E2 `registerMigrationDir` → `feedbackOscillator ↔ convergenceDetector`**: ascending amplifies feedback resonance energy (×1.10 injection scale) while narrowing convergence tolerance (up to -0.05 melodicBoost). Ascending register builds cross-layer dialogue while making exact rhythmic unison harder — rich resonance, sparse coincidence.
- **R87 E3 `registerMigrationDir` → `polyrhythmicPhasePredictor`**: ascending amplifies predicted phase convergence boost (×1.18). Layers meeting at the top of a register climb produce the most structurally significant unison moments.

### density + complexityEma + ascendRatio Three-Antagonism Bridge (R88)

Three independent antagonism pairs across rhythm, structure, and harmony.

- **R88 E1 `density` → `entropyRegulator ↔ temporalGravity`** (r=-0.537): high note density raises entropy target (up to +0.04) while strengthening temporal gravity wells (×up to 1.10). Dense textures generate more pitch variety while temporal structure anchors the metric grid.
- **R88 E2 `complexityEma` → `stutterContagion ↔ grooveTransfer`** (r=-0.463): sustained rhythmic complexity amplifies stutter contagion spread (×up to 1.10) while dampening groove transfer (×down to 0.92). Complex texture propagates chaos through stutter while groove self-organizes independently.
- **R88 E3 `ascendRatio` → `convergenceHarmonicTrigger ↔ verticalIntervalMonitor`** (r=-0.450): ascending melodic momentum boosts harmonic trigger probability at convergence points (×up to 1.12) while tightening interval collision penalty (×up to 1.10). Ascending motion demands both harmonic assertiveness and harmonic discipline.

### freshnessEma + complexity + biasStrength Three-Antagonism Bridge (R89)

Three new antagonism pairs using sustained melodic novelty, per-beat rhythmic complexity, and rhythmic bias confidence.

- **R89 E1 `freshnessEma` → `dynamicRoleSwap ↔ verticalIntervalMonitor`** (r=-0.527): sustained melodic novelty amplifies role-swap frequency (gate up to +0.07) while reducing collision penalty (×down to 0.80). Novel melodic territory endorses both dynamic reorganization and harmonic exploration — roles reshuffle as collisions are forgiven.
- **R89 E2 `complexity` → `entropyRegulator ↔ temporalGravity`** (r=-0.410): per-beat rhythmic complexity raises entropy target (up to +0.03) while tightening temporal gravity wells (×up to 1.10). Complex rhythmic events open up pitch variety while the temporal anchor firms — pitch chaos expands as time structure grips.
- **R89 E3 `biasStrength` → `feedbackOscillator ↔ grooveTransfer`** (r=-0.399): confident rhythm pulse calms feedback injection energy (×down to 0.91) while amplifying groove transfer rate (×up to 1.09). Established groove quiets cross-layer oscillation dialogue while simultaneously strengthening timing synchrony — resonance calms as shared pulse deepens.

### contourShape + tessituraLoad + freshnessEma Three-Bridge Round (R90)

Resurrects `contourShape` (dormant 6 rounds) on a VIRGIN antagonist pair, plus two new bridges using underused melodic dimensions.

- **R90 E1 `contourShape` → `entropyRegulator ↔ motifEcho`** (r=-0.503, VIRGIN pair): rising melodic contour raises entropy target (up to +0.03) while suppressing echo probability (×down to 0.88). Falling contour lowers entropy (−0.02) while amplifying echo (×up to 1.12). Ascending arc drives pitch exploration while refusing to look back — chaos expands as memory fades. Descending arc settles into familiar territory — order returns as imitative memory deepens.
- **R90 E2 `tessituraLoad` → `grooveTransfer ↔ crossLayerClimaxEngine`** (r=-0.487, 3→4 bridges): extreme register pressure reduces groove transfer (×down to 0.92) while accelerating climax approach (up to +0.05). At extreme register, layers pursue independent rhythmic territory while the structural arc crests — rhythmic individuation at the structural peak.
- **R90 E3 `freshnessEma` → `harmonicIntervalGuard ↔ phaseAwareCadenceWindow`** (r=-0.426, 2→3 bridges): sustained melodic novelty narrows harmonic deadband (up to −0.03) while compressing the cadence window (up to −0.04 threshold). Novel melodic territory tightens harmonic discipline while deferring resolution — interval hunting intensifies as cadence is resisted.

### ascendRatio Antagonism Bridge (R47)

`ascendRatio` as shared signal driving constructive opposition between structural arc and form tracking.

- **R47 E2+E3 `ascendRatio` → `crossLayerClimaxEngine ↔ crossLayerSilhouette`** (r=-0.323, 3→4 bridges): ascending melodic intervals accelerate climax approach (up to +0.05) while tightening silhouette structural tracking (up to −8% smoothing). Melody climbing toward a structural peak fuels the arc while form braces for landing — chaos rides the climb, structure prepares the resolution.

### tessituraLoad Register-Pressure Bridge + thematicDensity Virgin Coupling (R92)

Two new couplings targeting the `verticalIntervalMonitor ↔ crossLayerSilhouette` unsaturated antagonist pair (r=-0.443), plus first use of `thematicDensity` in `crossLayerSilhouette`.

- **R92 E1 `tessituraLoad` → `verticalIntervalMonitor ↔ crossLayerSilhouette`** (r=-0.443, 2→3 bridges): crowded register makes unison collisions muddier — VIM tightens collision penalty (×up to 1.09). Opposing: crossLayerSilhouette WIDENS effectiveSmoothing (up to +10% relaxation), giving structural form room to breathe under register pressure. Harmonic discipline intensifies while structural tracking loosens — the form opens up as the harmonic space compresses.
- **R92 E2 `thematicDensity` → `crossLayerSilhouette`** (virgin coupling): recognizable motivic patterns tighten form tracking (up to −7% smoothing). When recurring themes are dense, the silhouette firms up around them — structural coherence follows motivic density.
- **R92 E3 `hotspots` → `feedbackOscillator ↔ entropyRegulator`** (r=-0.488, 2→3 bridges): dense active rhythmic grid slots amplify feedbackOscillator inject energy (×up to 1.09), while simultaneously suppressing entropyRegulator target (up to −0.04). Rhythmic concentration deepens cross-layer resonance while drawing order from the density — oscillatory richness expands as entropy contracts.

## Emergence Boundaries

Three architectural membranes:

1. **Conductor -> CrossLayer**: read-only via `conductorSignalBridge`. No conductor module may mutate cross-layer state. ESLint enforced.
2. **CrossLayer -> Conductor**: no direct writes. Only `playProb`/`stutterProb` local modifications and `explainabilityBus` diagnostics.
3. **Inter-module communication**: via `absoluteTimeGrid` (L0) channels, not direct calls. L0 queries should include layer filter when per-layer data is needed.
