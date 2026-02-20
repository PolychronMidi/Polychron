// src/time/TempoFeelEngine.js - Applies subtle tick offsets for micro-tempo variation.
// Creates accelerando/ritardando feel aligned with phrase arcs and section phases.
// Pure query API — consumer adds getTickOffset() to note timing calculations.

TempoFeelEngine = (() => {
  const MAX_FEEL_RATIO = 0.025; // max 2.5% tempo deviation

  if (!Validator || typeof Validator.create !== 'function') {
    throw new Error('TempoFeelEngine: Validator.create is required');
  }
  const V = Validator.create('TempoFeelEngine');

  function requirePhraseContextPosition() {
    if (!ComposerFactory || !ComposerFactory.sharedPhraseArcManager
      || typeof ComposerFactory.sharedPhraseArcManager.getPhraseContext !== 'function') {
      throw new Error('TempoFeelEngine: ComposerFactory.sharedPhraseArcManager.getPhraseContext is required');
    }
    const phraseCtx = ComposerFactory.sharedPhraseArcManager.getPhraseContext();
    if (!phraseCtx || typeof phraseCtx !== 'object') {
      throw new Error('TempoFeelEngine: phrase context must be an object');
    }
    return V.requireFinite(phraseCtx.position, 'phraseCtx.position');
  }

  function requireSectionPhase() {
    if (typeof ConductorState === 'undefined' || !ConductorState || typeof ConductorState.getField !== 'function') {
      throw new Error('TempoFeelEngine: ConductorState.getField is required');
    }
    const phase = ConductorState.getField('sectionPhase');
    if (typeof phase !== 'string' || phase.length === 0) {
      throw new Error('TempoFeelEngine: ConductorState.sectionPhase must be a non-empty string');
    }
    return phase;
  }

  function requireTicksPerUnit() {
    const ticks = V.requireFinite(tpUnit, 'tpUnit');
    if (ticks <= 0) {
      throw new Error('TempoFeelEngine: tpUnit must be > 0');
    }
    return ticks;
  }

  /**
   * Get a tick offset for the current timing context.
   * Positive = push forward (accelerando), negative = pull back (ritardando).
   * @returns {number} - tick offset to add to note-on tick
   */
  function getTickOffset() {
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

    // Convert to ticks using current tpUnit
    const ticksPerUnit = requireTicksPerUnit();

    return m.round(feel * ticksPerUnit);
  }

  /**
   * Get the raw feel factor (for diagnostics/logging).
   * @returns {{ feel: number, phase: string, position: number }}
   */
  function getFeelState() {
    const position = requirePhraseContextPosition();
    const phase = requireSectionPhase();

    return { feel: getTickOffset(), phase, position };
  }

  return {
    getTickOffset,
    getFeelState
  };
})();
