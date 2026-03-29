// src/time/tempoFeelEngine.js - Applies subtle time offsets for micro-tempo variation.
// Creates accelerando/ritardando feel aligned with phrase arcs and section phases.
// Pure query API - consumer adds getTimeOffset() to note timing calculations.

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

  function requireSecondsPerUnit() {
    const secs = V.requireFinite(spUnit, 'spUnit');
    if (secs <= 0) {
      throw new Error('tempoFeelEngine: spUnit must be > 0');
    }
    return secs;
  }

  /**
   * Get a time offset (seconds) for the current timing context.
   * Positive = push forward (accelerando), negative = pull back (ritardando).
   * @returns {number} - seconds offset to add to note-on time
   */
  function getTimeOffset() {
    const position = requirePhraseContextPosition();
    const phase = requireSectionPhase();

    // Compute feel factor based on phase and phrase arc position
    let feel = 0;
    switch (phase) {
      case 'development':
      case 'climax':
        feel = m.sin(position * m.PI) * MAX_FEEL_RATIO;
        break;
      case 'resolution':
      case 'conclusion':
        feel = -m.sin(position * m.PI) * MAX_FEEL_RATIO * 0.7;
        break;
      case 'exposition':
        feel = m.sin(position * m.PI) * MAX_FEEL_RATIO * 0.3;
        break;
      default:
        feel = 0;
    }

    // Phrase-level rubato: slight ritardando approaching phrase end, accelerando in early phrase
    // Tempo-responsive: slower tempo = more rubato, faster = tighter
    const tempoEntry = L0.getLast('tickDuration', {});
    const bpmScaleForRubato = tempoEntry && Number.isFinite(tempoEntry.bpmScale) ? tempoEntry.bpmScale : 1.0;
    const rubatoDepth = clamp(1.2 - bpmScaleForRubato * 0.4, 0.5, 1.5);
    const phraseProgress = clamp(timeStream.normalizedProgress('phrase'), 0, 1);
    const rubato = phraseProgress > 0.8
      ? -(phraseProgress - 0.8) / 0.2 * MAX_FEEL_RATIO * 0.5 * rubatoDepth
      : phraseProgress < 0.15
        ? (0.15 - phraseProgress) / 0.15 * MAX_FEEL_RATIO * 0.3 * rubatoDepth
        : 0;

    const secondsPerUnit = requireSecondsPerUnit();

    return (feel + rubato) * secondsPerUnit;
  }

  /**
   * Get the raw feel factor (for diagnostics/logging).
   * @returns {{ feel: number, phase: string, position: number }}
   */
  function getFeelState() {
    const position = requirePhraseContextPosition();
    const phase = requireSectionPhase();

    return { feel: getTimeOffset(), phase, position };
  }

  return {
    getTimeOffset,
    getFeelState
  };
})();
