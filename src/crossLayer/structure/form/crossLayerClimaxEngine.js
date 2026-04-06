// src/crossLayer/crossLayerClimaxEngine.js - Multi-parameter climax coordination.
// Detects and orchestrates climax moments across both layers.
// When section progress, interaction heat, and conductor intensity all converge
// above thresholds, coordinates a unified climactic build:
// increases density, widens register, boosts velocity, raises entropy target.

crossLayerClimaxEngine = (() => {
  const V = validator.create('crossLayerClimaxEngine');
  const APPROACH_THRESHOLD = 0.65;
  const PEAK_THRESHOLD = 0.82;
  const SMOOTHING = 0.25;

  // Pressure detection
  const PRESSURE_ONSET = 0.9;
  const PRESSURE_RANGE = 0.6;

  // Conductor intensity blend
  const COMPOSITE_WEIGHT = 0.6;
  const DENSITY_PRESSURE_WEIGHT = 0.2;
  const TENSION_PRESSURE_WEIGHT = 0.2;

  // Composite climax signal weights
  const ARC_WEIGHT = 0.25;
  const CONDUCTOR_WEIGHT = 0.3;
  const HEAT_WEIGHT = 0.2;
  const INTENT_WEIGHT = 0.25;

  // Climax modifiers
  // R22: Play boost 0.35->0.12 -- climax intensity through velocity/register, not
  // more notes. +35% playProb compounded with already-dense Q3 causing aural overload.
  const MAX_PLAY_BOOST = 0.12;
  const MAX_VELOCITY_BOOST = 0.25;
  const MAX_REGISTER_WIDEN = 6;
  const ENTROPY_BASE = 0.5;
  // R22: Entropy boost 0.4->0.22 -- coherent climax should be focused, not frenzied.
  // Peak target: 0.5+0.22*0.85=0.69 (was 0.84).
  const ENTROPY_BOOST = 0.22;
  // R94 E3: Regime-responsive climax entropy scaling. During exploring,
  // climax approach injects more entropy variance (boosting entropy axis
  // share which collapsed 0.193->0.114 in R93). During coherent, reduce
  // entropy injection to preserve unified texture. Regime multiplier
  // scales the ENTROPY_BOOST: exploring 1.35x (0.54), coherent 0.85x (0.34).
  const CLIMAX_ENTROPY_REGIME_SCALE = { exploring: 1.35, evolving: 1.20, coherent: 0.85 };

  let smoothedClimax = 0;
  let peakReached = false;
  let climaxCount = 0;
  let climaxPlayAllowance = 1;
  // R23 E2: Density-aware playProb -- when already dense, climax adds velocity/register, not notes.
  let lastDensity = 0.5;

  // R31 lab: voice-independence-feedback. Tracks whether voices achieve their
  // independence target and compensates with register spread when they don't.
  // R39: per-layer state to prevent L1/L2 bleed
  const observedIndependenceByLayer = { L1: 0.5, L2: 0.5 };
  // R38: trust velocity anticipation state (per-layer)
  const lastMotifTrustByLayer = { L1: 1.0, L2: 1.0 };
  const lastStutterTrustByLayer = { L1: 1.0, L2: 1.0 };

  // R28 E1: Density-pressure homeostasis. Self-regulating accumulator builds
  // pressure when output density is sustained high during climax, reducing
  // play/entropy boost proportionally. Same architecture as cadenceAlignment
  // tension-accumulation (R25 E1). Prevents aural crowding at peaks without
  // static tension gates. Regime-aware: coherent gets more relief (needs less
  // chaos at peaks), exploring gets none (preserve searching energy).
  const DENSITY_SATURATION_BEATS = 40;
  const DENSITY_HIGH_THRESHOLD = 0.62;
  // exploring gets relief too -- unlike tension-accumulation where exploring's 0.80
  // threshold was correctly calibrated (R79 E2), density crowding is worst in exploring
  // at high tension because all four climax dimensions stack up simultaneously.
  const DENSITY_PRESSURE_RELIEF = { exploring: 0.15, evolving: 0.12, coherent: 0.20 };
  let densityPressureAccum = 0;

  /**
   * Tick the climax detector each beat.
   * @param {number} absoluteSeconds
   */
  function tick(absoluteSeconds) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    // Gather signals
    const sectionProgress = clamp(timeStream.compoundProgress('section'), 0, 1);
    const sectionIndex = timeStream.getPosition('section');
    const totalSections = timeStream.getBounds('section');
    const journeyProgress = totalSections > 1 ? sectionIndex / (totalSections - 1) : 1;
    const longFormPressure = clamp(totalSections - 4, 0, 1);
    const axisEnergyShares = conductorSignalBridge.getSignals().axisEnergyShares;
    const phaseShare = axisEnergyShares && typeof axisEnergyShares.phase === 'number'
      ? axisEnergyShares.phase
      : 1.0 / 6.0;
    const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const sectionArc = m.sin(m.pow(sectionProgress, 1.2) * m.PI);
    const earlySectionDamp = 1 - clamp((0.35 - sectionProgress) / 0.35, 0, 1) * 0.20;
    const preClimaxHold = 1 - longFormPressure * clamp((0.62 - journeyProgress) / 0.62, 0, 1) * 0.22 * (1 - lowPhasePressure * 0.75);
    climaxPlayAllowance = 1 - longFormPressure * clamp((0.68 - journeyProgress) / 0.68, 0, 1) * 0.30 * (1 - lowPhasePressure * 0.75);

    const sigs = conductorSignalBridge.getSignals();
    lastDensity = sigs.density;
    // R37: perceptual crowding -- blend raw density with perceptual estimate
    const crowdingEntry = L0.getLast('perceptual-crowding', { layer: 'both' });
    const perceptualDensity = crowdingEntry && Number.isFinite(crowdingEntry.perceptualDensity)
      ? crowdingEntry.perceptualDensity : lastDensity;
    const effectiveDensity = lastDensity * 0.6 + perceptualDensity * 0.4;
    // R28 E1: accumulate density pressure when sustained high during climax
    if (effectiveDensity > DENSITY_HIGH_THRESHOLD && smoothedClimax >= APPROACH_THRESHOLD) {
      densityPressureAccum = m.min(densityPressureAccum + 1, DENSITY_SATURATION_BEATS);
    } else {
      densityPressureAccum = m.max(0, densityPressureAccum - 0.5);
    }
    // R33: post climax state to L0 for cross-module awareness
    if (smoothedClimax > 0.1) {
      L0.post('climax-pressure', 'both', absoluteSeconds, {
        level: smoothedClimax, densityPressure: densityPressureAccum / DENSITY_SATURATION_BEATS
      });
    }
    // Blend compositeIntensity with elevated density/tension products for richer peak detection
    const densityPressure = clamp((sigs.density - PRESSURE_ONSET) / PRESSURE_RANGE, 0, 1);
    const tensionPressure = clamp((sigs.tension - PRESSURE_ONSET) / PRESSURE_RANGE, 0, 1);
    const conductorIntensity = clamp((sigs.compositeIntensity * COMPOSITE_WEIGHT + densityPressure * DENSITY_PRESSURE_WEIGHT + tensionPressure * TENSION_PRESSURE_WEIGHT) * earlySectionDamp, 0, 1);

    const heatLevel = clamp(interactionHeatMap.getDensity(), 0, 1);

    const intent = sectionIntentCurves.getLastIntent();
    const intentPressure = (intent.densityTarget + intent.interactionTarget) / 2;

    // Harmonic excursion boost: distant keys amplify climax
    const harmonicEntry = L0.getLast('harmonic', { layer: 'both' });
    const excursionBoost = harmonicEntry && Number.isFinite(harmonicEntry.excursion) ? clamp(harmonicEntry.excursion * 0.02, 0, 0.1) : 0;
    // R40: fractal arc multi-scale intensity -- dormant module now wired
    const fractalIntensity = fractalArcGenerator.composite() * 0.08;
    // R76: entropy antagonism bridge -- high current entropy damps climax accumulation.
    // Chaotic texture (high entropy) opposes coherent climax build (r=-0.604 pair).
    const entropyEntryClx = L0.getLast('entropy', { layer: 'both' });
    const entropyDampClx = entropyEntryClx && Number.isFinite(entropyEntryClx.smoothed)
      ? clamp((entropyEntryClx.smoothed - 0.55) * 0.22, 0, 0.10) : 0;

    // Composite climax signal (R40: fractal arc, R76: entropy antagonism)
    const raw = (sectionArc * ARC_WEIGHT + conductorIntensity * CONDUCTOR_WEIGHT + heatLevel * HEAT_WEIGHT + intentPressure * INTENT_WEIGHT + excursionBoost + fractalIntensity - entropyDampClx) * preClimaxHold;
    smoothedClimax = smoothedClimax * (1 - SMOOTHING) + raw * SMOOTHING;

    // Detect peak crossing
    if (smoothedClimax >= PEAK_THRESHOLD && !peakReached) {
      peakReached = true;
      climaxCount++;
    } else if (smoothedClimax < APPROACH_THRESHOLD) {
      peakReached = false;
    }
  }

  /**
   * Get climax modifiers for a specific layer.
   * @returns {{ playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }}
   */
  function getModifiers(/* layer */) {
    if (smoothedClimax < APPROACH_THRESHOLD) {
      return { playProbScale: 1.0, velocityScale: 1.0, registerBias: 0, entropyTarget: -1 };
    }

    // Approaching or at climax: scale parameters
    const activeLayer = safePreBoot.call(() => LM.activeLayer, 'L1');
    const intensity = clamp((smoothedClimax - APPROACH_THRESHOLD) / (1 - APPROACH_THRESHOLD), 0, 1);

    // R94 E3: Scale entropy boost by regime
    const bridgeSignals = conductorSignalBridge.getSignals();
    const climaxRegime = bridgeSignals.regime || 'evolving';
    const entropyRegimeScale = V.optionalFinite(CLIMAX_ENTROPY_REGIME_SCALE[climaxRegime], 1.0);

    // R32: Unified density suppression with total-impact budget.
    // Three independent mechanisms (R23 density-aware, R28 homeostasis, R30a vel-inverse)
    // were stacking without coordination, compound-suppressing climax intensity below the
    // coupling pressure threshold needed for coherent formation. Now they share a budget:
    // total suppression capped at MAX_DENSITY_SUPPRESSION to preserve climax energy.
    const MAX_DENSITY_SUPPRESSION = 0.45;
    const densityScale = clamp((lastDensity - 0.55) / 0.35, 0, 1);
    // Xenolinguistic L1: modal color awareness. Vanilla harmony = widen register to seek color tones.
    const modalProfile = safePreBoot.call(() => modalColorTracker.getModalProfile(), null);
    const colorRegisterBias = modalProfile && modalProfile.vanilla ? 2 : modalProfile && modalProfile.colorful ? -1 : 0;
    const dpRelief = V.optionalFinite(DENSITY_PRESSURE_RELIEF[climaxRegime], 0.12);
    const dpPressure = clamp(densityPressureAccum / DENSITY_SATURATION_BEATS, 0, 1);
    const rawCrowding = dpPressure * dpRelief;
    if (rawCrowding > 0.01) densityPressureAccum = m.max(0, densityPressureAccum - 0.25);
    const densityExcess = clamp((lastDensity - 0.65) / 0.25, 0, 1);
    const rawVelSuppression = densityExcess > 0.1 ? densityExcess * 0.25 : 0;
    // Budget: total suppression from all 3 mechanisms capped
    const totalSuppression = clamp(densityScale * 0.5 + rawCrowding + rawVelSuppression, 0, MAX_DENSITY_SUPPRESSION);
    const playSuppression = clamp(densityScale + rawCrowding, 0, MAX_DENSITY_SUPPRESSION);
    const velSoftening = 1.0 - clamp(rawVelSuppression, 0, MAX_DENSITY_SUPPRESSION - playSuppression);
    // R30 lab: spectral-chord-voicing
    const phraseCtx = safePreBoot.call(() => FactoryManager.sharedPhraseArcManager.getPhraseContext(), null);
    const spectral = phraseCtx && Number.isFinite(phraseCtx.spectralDensity) ? phraseCtx.spectralDensity : 0.5;
    const spectralSpread = (spectral - 0.5) * 8;
    // R31 lab: trust-responsive articulation
    const artTrust = V.optionalFinite(safePreBoot.call(() => adaptiveTrustScores.getWeight(trustSystems.names.ARTICULATION_COMPLEMENT), 1.0), 1.0);
    const grooveTrust = V.optionalFinite(safePreBoot.call(() => adaptiveTrustScores.getWeight(trustSystems.names.GROOVE_TRANSFER), 1.0), 1.0);
    const trustVelSpread = clamp((artTrust - 1.2) * 0.6, -0.15, 0.2) - clamp((grooveTrust - 1.2) * 0.5, -0.1, 0.15);
    const trustVelMod = 1.0 + trustVelSpread * rf(-0.15, 0.15);
    // R31 lab: voice-independence-feedback
    const indTarget = phraseCtx && Number.isFinite(phraseCtx.voiceIndependence) ? phraseCtx.voiceIndependence : 0.5;
    const velVariance = clamp(m.abs((lastDensity - 0.5) * 2), 0, 1);
    const indLayer = activeLayer === 'L1' || activeLayer === 'L2' ? activeLayer : 'L1';
    observedIndependenceByLayer[indLayer] += (velVariance - observedIndependenceByLayer[indLayer]) * 0.02;
    const indGap = indTarget - observedIndependenceByLayer[indLayer];
    const indCompensation = indGap > 0.15 ? indGap * 6 : 0;
    // R37: cross-layer voice sensing -- contrary motion when registers overlap
    const voiceSenseLayer = crossLayerHelpers.getOtherLayer(activeLayer || 'L1');
    const otherNotes = L0.query('note', { layer: voiceSenseLayer, windowSeconds: 0.3 });
    let contraryBias = 0;
    if (otherNotes && otherNotes.length > 0) {
      let otherAvg = 0;
      for (let vsi = 0; vsi < otherNotes.length; vsi++) otherAvg += V.optionalFinite(otherNotes[vsi].midi || otherNotes[vsi].note, 60);
      otherAvg /= otherNotes.length;
      const selfAvg = 60 + spectralSpread;
      if (m.abs(selfAvg - otherAvg) < 5) contraryBias = selfAvg > otherAvg ? 3 : -3;
    }
    // R31 lab: convergence-driven density via L0 channel (R32: replaces direct call)
    const convEntry = L0.getLast('convergence-density', { layer: 'both' });
    const convDensityBoost = convEntry && Number.isFinite(convEntry.boost) ? convEntry.boost : 0;
    // R38: dimensionality response -- adapt palette to dimensional complexity
    const effDim = V.optionalFinite(bridgeSignals.effectiveDimensionality, 3);
    const dimRegisterBias = effDim < 2.5 ? clamp((2.5 - effDim) / 1.5, 0, 1) * 4 : effDim > 4.0 ? clamp((effDim - 4.0) / 2.0, 0, 1) * -2 : 0;
    const dimVelScale = effDim < 2.5 ? 1.0 + clamp((2.5 - effDim) / 1.5, 0, 1) * 0.15 : 1.0;
    // Melodic coupling: directionBias steers register spread at climax.
    // Ascending direction -> widen register (building energy needs space);
    // descending -> compress (falling motion consolidates range).
    const melodicCtxCCE = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const dirBias = melodicCtxCCE ? V.optionalFinite(melodicCtxCCE.directionBias, 0) : 0;
    const melodicRegBias = dirBias * 2.5; // [-2.5 descending ... +2.5 ascending]
    // R38: trust velocity anticipation -- lean into rising trust, back off falling
    const motifTrustW = V.optionalFinite(safePreBoot.call(() => adaptiveTrustScores.getWeight(trustSystems.names.MOTIF_ECHO), 1.0), 1.0);
    const stutterTrustW = V.optionalFinite(safePreBoot.call(() => adaptiveTrustScores.getWeight(trustSystems.names.STUTTER_CONTAGION), 1.0), 1.0);
    const trustLayer = activeLayer === 'L1' || activeLayer === 'L2' ? activeLayer : 'L1';
    const trustMotifDelta = motifTrustW - V.optionalFinite(lastMotifTrustByLayer[trustLayer], motifTrustW);
    const trustStutterDelta = stutterTrustW - V.optionalFinite(lastStutterTrustByLayer[trustLayer], stutterTrustW);
    lastMotifTrustByLayer[trustLayer] = motifTrustW;
    lastStutterTrustByLayer[trustLayer] = stutterTrustW;
    const trustRegBias = trustMotifDelta > 0.01 ? trustMotifDelta * 20 : 0;
    const trustStutterMod = trustStutterDelta < -0.01 ? 0.7 : 1.0;
    return {
      playProbScale: (1.0 + intensity * MAX_PLAY_BOOST * climaxPlayAllowance * (1 - playSuppression) + convDensityBoost) * trustStutterMod,
      velocityScale: (1.0 + intensity * MAX_VELOCITY_BOOST) * velSoftening * trustVelMod * dimVelScale,
      registerBias: intensity * MAX_REGISTER_WIDEN + spectralSpread + indCompensation + contraryBias + dimRegisterBias + trustRegBias + colorRegisterBias + melodicRegBias,
      entropyTarget: ENTROPY_BASE + intensity * ENTROPY_BOOST * entropyRegimeScale * (1 - totalSuppression * 0.3)
    };
  }

  /**
   * Whether the system is currently approaching or at a climax.
   * @returns {boolean}
   */
  function isApproaching() {
    return smoothedClimax >= APPROACH_THRESHOLD;
  }

  /** @returns {boolean} */
  function isPeak() { return peakReached; }

  /** @returns {number} */
  function getClimaxLevel() { return smoothedClimax; }

  /** @returns {number} */
  function getClimaxCount() { return climaxCount; }

  function reset() {
    smoothedClimax = 0;
    peakReached = false;
    climaxCount = 0;
    climaxPlayAllowance = 1;
    lastDensity = 0.5;
    densityPressureAccum = 0;
    observedIndependenceByLayer.L1 = 0.5; observedIndependenceByLayer.L2 = 0.5;
    lastMotifTrustByLayer.L1 = 1.0; lastMotifTrustByLayer.L2 = 1.0;
    lastStutterTrustByLayer.L1 = 1.0; lastStutterTrustByLayer.L2 = 1.0;
  }

  return { tick, getModifiers, isApproaching, isPeak, getClimaxLevel, getClimaxCount, reset };
})();
crossLayerRegistry.register('crossLayerClimaxEngine', crossLayerClimaxEngine, ['all', 'section']);
