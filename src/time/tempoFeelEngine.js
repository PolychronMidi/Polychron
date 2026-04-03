// src/time/tempoFeelEngine.js - Applies tempo feel by modulating spBeat.
// Instead of shifting individual note times (which causes drift), this
// returns a tempo scale factor that modifies spBeat at the beat level.
// All child unit durations (div/subdiv/subsubdiv) inherit the change
// automatically, and BPM events reflect the actual effective tempo.

tempoFeelEngine = (() => {
  const MAX_FEEL_RATIO = 0.025; // max 2.5% tempo deviation

  const V = validator.create('tempoFeelEngine');

  function requirePhraseContextPosition() {
    const phraseCtx = FactoryManager.sharedPhraseArcManager.getPhraseContext();
    V.assertObject(phraseCtx, 'phraseCtx');
    return V.requireFinite(phraseCtx.position, 'phraseCtx.position');
  }

  function requireSectionPhase() {
    const phase = conductorState.getField('sectionPhase');
    V.assertNonEmptyString(phase, 'phase');
    return phase;
  }

  /**
   * Get a tempo scale factor for the current beat context.
   * > 1.0 = slightly slower (ritardando), < 1.0 = slightly faster (accelerando).
   * Applied to spBeat in setUnitTiming to change actual tempo.
   * @returns {number} scale factor (e.g. 0.975 to 1.025)
   */
  function getTempoScale() {
    const position = requirePhraseContextPosition();
    const phase = requireSectionPhase();

    let feel = 0;
    switch (phase) {
      case 'development':
      case 'climax':
        // Accelerando through middle of phrase
        feel = -m.sin(position * m.PI) * MAX_FEEL_RATIO;
        break;
      case 'resolution':
      case 'conclusion':
        // Ritardando through middle of phrase
        feel = m.sin(position * m.PI) * MAX_FEEL_RATIO * 0.7;
        break;
      case 'exposition':
        feel = -m.sin(position * m.PI) * MAX_FEEL_RATIO * 0.3;
        break;
      default:
        feel = 0;
    }

    // Phrase-level rubato: ritardando approaching phrase end, accelerando in early phrase
    const tempoLayer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    const tempoEntry = L0.getLast('tickDuration', { layer: tempoLayer });
    const bpmScaleForRubato = tempoEntry && Number.isFinite(tempoEntry.bpmScale) ? tempoEntry.bpmScale : 1.0;
    const rubatoDepth = clamp(1.2 - bpmScaleForRubato * 0.4, 0.5, 1.5);
    const phraseProgress = clamp(timeStream.normalizedProgress('phrase'), 0, 1);
    const rubato = phraseProgress > 0.8
      ? (phraseProgress - 0.8) / 0.2 * MAX_FEEL_RATIO * 0.5 * rubatoDepth
      : phraseProgress < 0.15
        ? -(0.15 - phraseProgress) / 0.15 * MAX_FEEL_RATIO * 0.3 * rubatoDepth
        : 0;

    // R21: stutter density modulates tempo feel
    const stutterTempoMod = /** @type {number} */ (safePreBoot.call(() => stutterTempoFeel.getTempoModulation(), 0));
    // R40: regime-responsive tempo feel. Coherent = slightly more rubato (expressive),
    // exploring = tighter tempo (searching energy). Evolving = neutral.
    const tempoRegime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'evolving');
    const regimeTempoScale = tempoRegime === 'coherent' ? 1.3 : tempoRegime === 'exploring' ? 0.6 : 1.0;
    return 1.0 + (feel + rubato) * regimeTempoScale + stutterTempoMod;
  }

  // Backwards compatibility
  function getTimeOffset() {
    return 0;
  }

  function getFeelState() {
    const position = requirePhraseContextPosition();
    const phase = requireSectionPhase();
    return { feel: getTempoScale(), phase, position };
  }

  return {
    getTempoScale,
    getTimeOffset,
    getFeelState
  };
})();
