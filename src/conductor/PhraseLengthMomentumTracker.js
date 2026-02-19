// src/conductor/PhraseLengthMomentumTracker.js - Track phrase length trajectory.
// Detects whether phrases are getting shorter (accelerating) or longer (expanding).
// Pure query API — advises phrase-count decisions alongside SectionLengthAdvisor.

PhraseLengthMomentumTracker = (() => {
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
    if (typeof measures !== 'number' || !Number.isFinite(measures)) {
      throw new Error('PhraseLengthMomentumTracker.recordPhraseLength: measures must be finite');
    }
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

    const half = m.floor(history.length / 2);
    let sumFirst = 0;
    let sumSecond = 0;

    for (let i = 0; i < half; i++) sumFirst += history[i].measures;
    for (let i = half; i < history.length; i++) sumSecond += history[i].measures;

    const avgFirst = sumFirst / half;
    const avgSecond = sumSecond / (history.length - half);
    const avgLength = (avgFirst + avgSecond) / 2;
    const momentum = avgSecond - avgFirst;

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
   * Continuously accelerating → suggest lengthening; continuously expanding → suggest shortening.
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

  return {
    recordPhraseLength,
    getMomentum,
    suggestAdjustment,
    reset
  };
})();
