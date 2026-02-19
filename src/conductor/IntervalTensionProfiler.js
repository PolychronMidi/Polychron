// src/conductor/IntervalTensionProfiler.js - Distribution of melodic interval sizes.
// Detects stepwise ruts or excessive leaps in recent note history.
// Pure query API — advises composers to vary interval range.

IntervalTensionProfiler = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Compute interval distribution from recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgInterval: number, maxInterval: number, stepRatio: number, leapRatio: number, monotonous: boolean, erratic: boolean }}
   */
  function getIntervalProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 3) {
      return { avgInterval: 0, maxInterval: 0, stepRatio: 0, leapRatio: 0, monotonous: false, erratic: false };
    }

    let sumInterval = 0;
    let maxInterval = 0;
    let steps = 0;
    let leaps = 0;
    const count = notes.length - 1;

    for (let i = 1; i < notes.length; i++) {
      const interval = m.abs((notes[i].midi || 0) - (notes[i - 1].midi || 0));
      sumInterval += interval;
      if (interval > maxInterval) maxInterval = interval;
      if (interval <= 2) steps++;
      if (interval >= 5) leaps++;
    }

    const avgInterval = sumInterval / count;
    const stepRatio = steps / count;
    const leapRatio = leaps / count;

    return {
      avgInterval,
      maxInterval,
      stepRatio,
      leapRatio,
      monotonous: stepRatio > 0.8,
      erratic: leapRatio > 0.6
    };
  }

  /**
   * Get a leap-penalty bias for VoiceLeadingScore.
   * Monotonous → reduce leap penalty; erratic → increase it.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - leap penalty multiplier (0.5 to 1.5)
   */
  function getLeapPenaltyBias(opts) {
    const profile = getIntervalProfile(opts);
    if (profile.monotonous) return 0.6;
    if (profile.erratic) return 1.4;
    return 1.0;
  }

  /**
   * Suggest interval range adjustment.
   * @returns {{ suggestion: string, targetAvgInterval: number }}
   */
  function suggestIntervalChange() {
    const profile = getIntervalProfile();
    if (profile.monotonous) {
      return { suggestion: 'widen', targetAvgInterval: 4 };
    }
    if (profile.erratic) {
      return { suggestion: 'narrow', targetAvgInterval: 2 };
    }
    return { suggestion: 'maintain', targetAvgInterval: profile.avgInterval };
  }

  return {
    getIntervalProfile,
    getLeapPenaltyBias,
    suggestIntervalChange
  };
})();
