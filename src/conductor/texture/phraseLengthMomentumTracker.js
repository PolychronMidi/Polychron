// src/conductor/phraseLengthMomentumTracker.js - Track phrase length trajectory.
// Detects whether phrases are getting shorter (accelerating) or longer (expanding).
// Pure query API - advises phrase-count decisions alongside sectionLengthAdvisor.

phraseLengthMomentumTracker = (() => {
  const V = validator.create('phraseLengthMomentumTracker');
  /** @type {Array<{ section: number, phraseIndex: number, measures: number }>} */
  const history = [];
  const MAX_HISTORY = 32;

  /**
   * Record a completed phrase's length.
   * @param {number} section - section index
   * @param {number} phraseIndex - phrase index within section
   * @param {number} measures - number of measures in the phrase
   */
  function recordPhraseLength(section, phraseIndex, measures) {
    V.requireFinite(measures, 'measures');
    history.push({ section, phraseIndex, measures });
    if (history.length > MAX_HISTORY) history.shift();
  }

  /**
   * Compute phrase-length momentum.
   * @returns {{ momentum: number, trend: string, avgLength: number, accelerating: boolean, expanding: boolean }}
   */
  function getMomentum() {
    if (history.length < 4) {
      return { momentum: 0, trend: 'insufficient', avgLength: 4, accelerating: false, expanding: false };
    }

    /** @type {number[]} */
    const measures = [];
    for (let i = 0; i < history.length; i++) measures.push(history[i].measures);
    const { slope: momentum, avgFirst, avgSecond } = analysisHelpers.halfSplitSlope(measures);
    const avgLength = (avgFirst + avgSecond) / 2;

    let trend = 'stable';
    if (momentum < -0.5) trend = 'accelerating';
    else if (momentum > 0.5) trend = 'expanding';

    return {
      momentum,
      trend,
      avgLength,
      accelerating: momentum < -0.5,
      expanding: momentum > 0.5
    };
  }

  /**
   * Suggest a phrase-length adjustment.
   * Continuously accelerating â†’ suggest lengthening; continuously expanding â†’ suggest shortening.
   * @returns {{ adjustment: number, suggestion: string }}
   */
  function suggestAdjustment() {
    const mom = getMomentum();
    if (mom.accelerating) {
      return { adjustment: 1, suggestion: 'lengthen' };
    }
    if (mom.expanding) {
      return { adjustment: -1, suggestion: 'shorten' };
    }
    return { adjustment: 0, suggestion: 'maintain' };
  }

  /** Reset tracking. */
  function reset() {
    history.length = 0;
  }

  conductorIntelligence.registerStateProvider('phraseLengthMomentumTracker', () => {
    const s = phraseLengthMomentumTracker.suggestAdjustment();
    return {
      phraseLengthAdjustment: s ? s.adjustment : 0,
      phraseLengthSuggestion: s ? s.suggestion : 'maintain'
    };
  });
  conductorIntelligence.registerModule('phraseLengthMomentumTracker', { reset }, ['section']);

  return {
    recordPhraseLength,
    getMomentum,
    suggestAdjustment,
    reset
  };
})();
