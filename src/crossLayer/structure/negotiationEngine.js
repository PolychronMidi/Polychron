negotiationEngine = (() => {
  const V = validator.create('negotiationEngine');
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

    const trustStutter = adaptiveTrustScores.getWeight('stutterContagion');
    const trustCadence = adaptiveTrustScores.getWeight('cadenceAlignment');
    const trustPhase = adaptiveTrustScores.getWeight('phaseLock');

    const intent = context.intent || sectionIntentCurves.getLastIntent();

    const phaseConfidence = clamp(V.requireFinite(context.phaseConfidence, 'phaseConfidence'), 0, 1);
  const entropyScale = V.optionalFinite(context.entropyScale, 1);

    const playScale = clamp((0.75 + intent.densityTarget * 0.45) * (0.9 + trustPhase * 0.08), 0.4, 1.8);
    const stutterScale = clamp((0.6 + intent.interactionTarget * 0.75) * (0.85 + trustStutter * 0.1), 0.25, 2.2);

    let playProb = clamp(context.playProb * playScale * clamp(0.7 + entropyScale * 0.3, 0.5, 1.5), 0, 1);
    let stutterProb = clamp(context.stutterProb * stutterScale * clamp(0.75 + entropyScale * 0.25, 0.5, 1.5), 0, 1);

    const conflict = Math.abs(trustCadence - trustStutter);
    if (conflict > 0.8) {
      playProb = clamp(playProb * 0.92, 0, 1);
      stutterProb = clamp(stutterProb * 0.9, 0, 1);
    }

    const allowCadence = Boolean(context.cadenceSuggested) && phaseConfidence >= 0.45 && trustCadence >= 0.7;

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
    const trustConvergence = adaptiveTrustScores.getWeight('convergence');
    const trustCadence = adaptiveTrustScores.getWeight('cadenceAlignment');
    const trustStutter = adaptiveTrustScores.getWeight('stutterContagion');

    // If convergence trust is low, suppress both secondary responders
    if (trustConvergence < 0.5) {
      return { allowHarmonicTrigger: false, allowDownbeat: false };
    }

    // If cadence trust is high and convergence trust is not dominant, skip harmonic trigger
    // to avoid both cadenceAlignment and convergenceHarmonicTrigger firing
    const allowHarmonicTrigger = trustConvergence >= trustCadence * 0.8;
    // If stutter trust is very high, suppress downbeat to avoid stutter + downbeat stacking
    const allowDownbeat = trustStutter < 1.4;

    explainabilityBus.emit('convergence-gate', layer, {
      trustConvergence, trustCadence, trustStutter,
      allowHarmonicTrigger, allowDownbeat
    });

    return { allowHarmonicTrigger, allowDownbeat };
  }

  function reset() {
    // Stateless by design — no internal state to clear. Intentionally a no-op.
    // Kept explicit to satisfy lint rule against silent early returns.
  }

  return { apply, gateConvergence, reset };
})();
crossLayerRegistry.register('negotiationEngine', negotiationEngine, ['all']);
