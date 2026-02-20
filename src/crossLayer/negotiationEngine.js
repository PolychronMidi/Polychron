NegotiationEngine = (() => {
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
    if (!context || typeof context !== 'object') throw new Error('NegotiationEngine.apply: context is required');
    if (!Number.isFinite(context.playProb)) throw new Error('NegotiationEngine.apply: playProb must be finite');
    if (!Number.isFinite(context.stutterProb)) throw new Error('NegotiationEngine.apply: stutterProb must be finite');

    const trustStutter = (typeof AdaptiveTrustScores !== 'undefined' && AdaptiveTrustScores && typeof AdaptiveTrustScores.getWeight === 'function')
      ? AdaptiveTrustScores.getWeight('stutterContagion')
      : 1;
    const trustCadence = (typeof AdaptiveTrustScores !== 'undefined' && AdaptiveTrustScores && typeof AdaptiveTrustScores.getWeight === 'function')
      ? AdaptiveTrustScores.getWeight('cadenceAlignment')
      : 1;
    const trustPhase = (typeof AdaptiveTrustScores !== 'undefined' && AdaptiveTrustScores && typeof AdaptiveTrustScores.getWeight === 'function')
      ? AdaptiveTrustScores.getWeight('phaseLock')
      : 1;

    const intent = context.intent || (typeof SectionIntentCurves !== 'undefined' && SectionIntentCurves && typeof SectionIntentCurves.getLastIntent === 'function'
      ? SectionIntentCurves.getLastIntent()
      : { densityTarget: 0.5, dissonanceTarget: 0.5, interactionTarget: 0.5, entropyTarget: 0.5 });

    const phaseConfidence = clamp(Number(context.phaseConfidence) || 0, 0, 1);
    const entropyScale = Number.isFinite(context.entropyScale) ? Number(context.entropyScale) : 1;

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

    if (typeof ExplainabilityBus !== 'undefined' && ExplainabilityBus && typeof ExplainabilityBus.emit === 'function') {
      ExplainabilityBus.emit('negotiation', layer, {
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
    }

    return { playProb, stutterProb, allowCadence, conflict, phaseConfidence };
  }

  function reset() {
    // Stateless by design — no internal state to clear. Intentionally a no-op.
    // Kept explicit to satisfy lint rule against silent early returns.
  }

  return { apply, reset };
})();
