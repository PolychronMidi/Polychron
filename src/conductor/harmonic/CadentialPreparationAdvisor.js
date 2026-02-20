// src/conductor/CadentialPreparationAdvisor.js - Cadential approach detector.
// Monitors proximity to phrase/section boundaries and harmonic approach patterns,
// signalling when dominant preparation or leading-tone pressure should begin.
// Pure query API — biases derivedTension near cadence points.

CadentialPreparationAdvisor = (() => {
  const PREP_WINDOW = 0.2; // prepare in the last 20% of a phrase

  /**
   * Evaluate how close we are to a cadential point and whether
   * the current harmonic state supports preparation.
   * @returns {{ tensionBias: number, preparationActive: boolean, urgency: number }}
   */
  function getCadentialSignal() {
    // Check phrase position via ComposerFactory.sharedPhraseArcManager
    const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager)
      ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
      : { position: 0.5, atEnd: false };

    const position = Number(phraseCtx.position) || 0.5;
    const atEnd = Boolean(phraseCtx.atEnd);

    // Check harmonic context for dominant approach
    const tension = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (Number(HarmonicContext.getField('tension')) || 0)
      : 0;

    // Calculate preparation urgency
    let urgency = 0;
    let preparationActive = false;

    if (position >= (1 - PREP_WINDOW) || atEnd) {
      // We're in the cadential zone
      preparationActive = true;
      // Urgency ramps from 0 at prep start to 1 at phrase end
      urgency = clamp((position - (1 - PREP_WINDOW)) / PREP_WINDOW, 0, 1);
    }

    // Tension bias: approaching cadence → increase tension to create resolution expectation
    // But only if current tension is below the target for cadential preparation
    let tensionBias = 1;
    if (preparationActive) {
      // Ramp tension during preparation — stronger as we approach the cadence
      const targetTension = 0.5 + urgency * 0.3; // target 0.5-0.8
      if (tension < targetTension) {
        // Under-tensioned for cadential approach — boost
        tensionBias = clamp(1 + urgency * 0.15, 1, 1.2);
      }
    }

    return { tensionBias, preparationActive, urgency };
  }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getCadentialSignal().tensionBias;
  }

  ConductorIntelligence.registerTensionBias('CadentialPreparationAdvisor', () => CadentialPreparationAdvisor.getTensionBias(), 1, 1.2);
  ConductorIntelligence.registerStateProvider('CadentialPreparationAdvisor', () => {
    const s = CadentialPreparationAdvisor.getCadentialSignal();
    return { cadentialPreparationActive: s ? s.preparationActive : false };
  });

  return {
    getCadentialSignal,
    getTensionBias
  };
})();
