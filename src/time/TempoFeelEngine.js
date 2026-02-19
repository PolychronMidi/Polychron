// src/time/TempoFeelEngine.js - Applies subtle tick offsets for micro-tempo variation.
// Creates accelerando/ritardando feel aligned with phrase arcs and section phases.
// Pure query API — consumer adds getTickOffset() to note timing calculations.

TempoFeelEngine = (() => {
  const MAX_FEEL_RATIO = 0.025; // max 2.5% tempo deviation

  /**
   * Get a tick offset for the current timing context.
   * Positive = push forward (accelerando), negative = pull back (ritardando).
   * @returns {number} - tick offset to add to note-on tick
   */
  function getTickOffset() {
    // Read phrase arc position for shape-driven feel
    const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory
      && ComposerFactory.sharedPhraseArcManager
      && typeof ComposerFactory.sharedPhraseArcManager.getPhraseContext === 'function')
      ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
      : null;

    const position = (phraseCtx && Number.isFinite(phraseCtx.position)) ? phraseCtx.position : 0.5;

    // Read section phase for structural feel
    const phase = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('sectionPhase') || 'development')
      : 'development';

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

    // Convert to ticks using current tpUnit
    const ticksPerUnit = (typeof tpUnit !== 'undefined' && Number.isFinite(tpUnit) && tpUnit > 0)
      ? tpUnit
      : 100;

    return m.round(feel * ticksPerUnit);
  }

  /**
   * Get the raw feel factor (for diagnostics/logging).
   * @returns {{ feel: number, phase: string, position: number }}
   */
  function getFeelState() {
    const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory
      && ComposerFactory.sharedPhraseArcManager
      && typeof ComposerFactory.sharedPhraseArcManager.getPhraseContext === 'function')
      ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
      : null;
    const position = (phraseCtx && Number.isFinite(phraseCtx.position)) ? phraseCtx.position : 0.5;
    const phase = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('sectionPhase') || 'development')
      : 'development';

    return { feel: getTickOffset(), phase, position };
  }

  return {
    getTickOffset,
    getFeelState
  };
})();
