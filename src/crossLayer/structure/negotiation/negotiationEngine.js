negotiationEngine = (() => {
  const V = validator.create('negotiationEngine');

  // Play probability scaling
  const PLAY_DENSITY_BASE = 0.75;
  const PLAY_DENSITY_SCALE = 0.45;
  const PLAY_TRUST_BASE = 0.9;
  const PLAY_TRUST_SCALE = 0.08;
  const PLAY_SCALE_MIN = 0.4;
  const PLAY_SCALE_MAX = 1.8;

  // Stutter probability scaling
  const STUTTER_INTERACT_BASE = 0.6;
  let cimScale = 0.5;
  const STUTTER_INTERACT_SCALE = 0.75;
  const STUTTER_TRUST_BASE = 0.85;
  const STUTTER_TRUST_SCALE = 0.1;
  const STUTTER_SCALE_MIN = 0.25;
  const STUTTER_SCALE_MAX = 2.2;

  // Entropy modulation
  const PLAY_ENTROPY_BASE = 0.7;
  const PLAY_ENTROPY_SCALE = 0.3;
  const PLAY_ENTROPY_MIN = 0.5;
  const PLAY_ENTROPY_MAX = 1.5;
  const STUTTER_ENTROPY_BASE = 0.75;
  const STUTTER_ENTROPY_SCALE = 0.25;
  const STUTTER_ENTROPY_MIN = 0.5;
  const STUTTER_ENTROPY_MAX = 1.5;

  // Conflict resolution
  const CONFLICT_THRESHOLD = 0.8;
  const CONFLICT_PLAY_DAMPEN = 0.92;
  const CONFLICT_STUTTER_DAMPEN = 0.9;

  // Cadence gating
  const CADENCE_PHASE_MIN = 0.45;
  const CADENCE_TRUST_MIN = 0.7;

  // Convergence gating
  const CONVERGENCE_TRUST_FLOOR = 0.5;
  const CONVERGENCE_DOMINANCE = 0.8;
  const STUTTER_DOWNBEAT_CAP = 1.4;
  /**
   * @param {string} layer
   * @param {{
   *  playProb: number,
   *  stutterProb: number,
   *  cadenceSuggested: boolean,
   *  phaseConfidence: number,
   *  intent?: { densityTarget: number, dissonanceTarget: number, interactionTarget: number, entropyTarget: number },
   *  entropyScale?: number
   * }} context
   */
  function apply(layer, context) {
    V.assertObject(context, 'context');
    V.requireFinite(context.playProb, 'context.playProb');
    V.requireFinite(context.stutterProb, 'context.stutterProb');

    const trustWeights = adaptiveTrustScores.getWeightBatch([
      trustSystems.names.STUTTER_CONTAGION,
      trustSystems.names.CADENCE_ALIGNMENT,
      trustSystems.names.PHASE_LOCK
    ]);
    const trustStutter = trustWeights[trustSystems.names.STUTTER_CONTAGION];
    const trustCadence = trustWeights[trustSystems.names.CADENCE_ALIGNMENT];
    const trustPhase = trustWeights[trustSystems.names.PHASE_LOCK];

    const intent = context.intent || sectionIntentCurves.getLastIntent();

    const phaseConfidence = clamp(V.requireFinite(context.phaseConfidence, 'phaseConfidence'), 0, 1);
  const entropyScale = V.optionalFinite(context.entropyScale, 1);

    // Lab R4: when input playProb is intentionally low (< 0.15), cap playScale
    // to 1.0 so sparse configs don't get amplified back to normal density
    const rawPlayScale = (PLAY_DENSITY_BASE + intent.densityTarget * PLAY_DENSITY_SCALE) * (PLAY_TRUST_BASE + trustPhase * PLAY_TRUST_SCALE);
    const playScaleCap = context.playProb < 0.15 ? m.min(rawPlayScale, 1.0) : rawPlayScale;
    const playScale = clamp(playScaleCap, PLAY_SCALE_MIN, PLAY_SCALE_MAX);
    const stutterScale = clamp((STUTTER_INTERACT_BASE + intent.interactionTarget * STUTTER_INTERACT_SCALE) * (STUTTER_TRUST_BASE + trustStutter * STUTTER_TRUST_SCALE), STUTTER_SCALE_MIN, STUTTER_SCALE_MAX);

    let playProb = clamp(context.playProb * playScale * clamp(PLAY_ENTROPY_BASE + entropyScale * PLAY_ENTROPY_SCALE, PLAY_ENTROPY_MIN, PLAY_ENTROPY_MAX), 0, 1);
    let stutterProb = clamp(context.stutterProb * stutterScale * clamp(STUTTER_ENTROPY_BASE + entropyScale * STUTTER_ENTROPY_SCALE, STUTTER_ENTROPY_MIN, STUTTER_ENTROPY_MAX), 0, 1);

    // R43 E4: removed in R45 E3. Regime-responsive play scaling was
    // contributing to note count decline (54596->34940 over 4 rounds).
    // Coherent play reduction (0.97x) compounded with stutter-regime
    // modulation in processBeat. Removing to recover note output.

    const conflict = m.abs(trustCadence - trustStutter);
    if (conflict > CONFLICT_THRESHOLD) {
      playProb = clamp(playProb * CONFLICT_PLAY_DAMPEN, 0, 1);
      stutterProb = clamp(stutterProb * CONFLICT_STUTTER_DAMPEN, 0, 1);
    }

    const allowCadence = Boolean(context.cadenceSuggested) && phaseConfidence >= CADENCE_PHASE_MIN && trustCadence >= CADENCE_TRUST_MIN;

    explainabilityBus.emit('negotiation', layer, {
      playProbIn: context.playProb,
      stutterProbIn: context.stutterProb,
      playProbOut: playProb,
      stutterProbOut: stutterProb,
      phaseConfidence,
      trustStutter,
      trustCadence,
      trustPhase,
      allowCadence,
      conflict
    });

    return { playProb, stutterProb, allowCadence, conflict, phaseConfidence };
  }

  /**
   * Gate convergence reactions: only fire if convergence trust is high enough
   * and not in conflict with other high-trust systems. Prevents triple-stacking
   * of convergenceDetector + convergenceHarmonicTrigger + emergentDownbeat.
   * @param {string} layer
   * @returns {{ allowHarmonicTrigger: boolean, allowDownbeat: boolean }}
   */
  function gateConvergence(layer) {
    const trustWeights = adaptiveTrustScores.getWeightBatch([
      trustSystems.names.CONVERGENCE,
      trustSystems.names.CADENCE_ALIGNMENT,
      trustSystems.names.STUTTER_CONTAGION
    ]);
    const trustConvergence = trustWeights[trustSystems.names.CONVERGENCE];
    const trustCadence = trustWeights[trustSystems.names.CADENCE_ALIGNMENT];
    const trustStutter = trustWeights[trustSystems.names.STUTTER_CONTAGION];

    // Modulate trust floor by convergenceTarget from intent curves
    const intent = sectionIntentCurves.getLastIntent();
    const ct = V.requireFinite(intent.convergenceTarget, 'intent.convergenceTarget');
    // CIM: coordinated = lower floor (allow convergence more easily), independent = higher
    const effectiveFloor = CONVERGENCE_TRUST_FLOOR * (1.3 - ct * 0.6) * (1.3 - cimScale * 0.6);

    if (trustConvergence < effectiveFloor) {
      return { allowHarmonicTrigger: false, allowDownbeat: false };
    }

    // If cadence trust is high and convergence trust is not dominant, skip harmonic trigger
    // to avoid both cadenceAlignment and convergenceHarmonicTrigger firing
    const allowHarmonicTrigger = trustConvergence >= trustCadence * CONVERGENCE_DOMINANCE;
    // If stutter trust is very high, suppress downbeat to avoid stutter + downbeat stacking
    const allowDownbeat = trustStutter < STUTTER_DOWNBEAT_CAP;

    explainabilityBus.emit('convergence-gate', layer, {
      trustConvergence, trustCadence, trustStutter,
      allowHarmonicTrigger, allowDownbeat
    });

    return { allowHarmonicTrigger, allowDownbeat };
  }

  function reset() {
    // Stateless by design - no internal state to clear. Intentionally a no-op.
    // Kept explicit to satisfy lint rule against silent early returns.
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  return { apply, gateConvergence, setCoordinationScale, reset };
})();
crossLayerRegistry.register('negotiationEngine', negotiationEngine, ['all']);
