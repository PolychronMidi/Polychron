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
        // Subtle push forward during the middle of phrases (accelerando feel)
        feel = m.sin(position * m.PI) * MAX_FEEL_RATIO;
        break;
      case 'resolution':
      case 'conclusion':
        // Pull back toward phrase end (ritardando feel)
        feel = -m.sin(position * m.PI) * MAX_FEEL_RATIO * 0.7;
        break;
      case 'exposition':
        // Very mild steady feel
        feel = m.sin(position * m.PI) * MAX_FEEL_RATIO * 0.3;
        break;
      default:
        feel = 0;
    }

    // Convert to seconds using current spUnit
    const secondsPerUnit = requireSecondsPerUnit();

    return feel * secondsPerUnit;
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
