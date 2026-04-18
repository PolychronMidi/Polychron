// src/conductor/melodic/intervalBalanceTracker.js - Unified interval analysis.
// Merges IntervalTensionProfiler + IntervalVarietyTracker + LeapStepBalancer.
// Provides density bias, interval selection biases, rut detection, and leap penalties.
// Pure query API - no side effects.

intervalBalanceTracker = (() => {
  const { query } = analysisHelpers.createTrackerQuery('intervalBalanceTracker', 5, { minNotes: 3 });

  // Beat-level cache: getIntervalProfile is called 2-3x per beat
  // (densityBias + getIntervalBias via stateProvider + getLeapPenaltyBias)
  const intervalBalanceTrackerProfileCache = beatCache.create(() => intervalBalanceTrackerGetIntervalProfile());

  /**
   * Analyze interval distribution from recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgInterval: number, maxInterval: number, stepRatio: number, leapRatio: number, unisonRatio: number, variety: number, rut: string|null, monotonous: boolean, erratic: boolean }}
   */
  function getIntervalProfile(opts) {
    if (opts === undefined) return intervalBalanceTrackerProfileCache.get();
    return intervalBalanceTrackerGetIntervalProfile(opts);
  }

  /** @private */
  function intervalBalanceTrackerGetIntervalProfile(opts = {}) {
    const notes = query(opts);
    if (!notes) return { avgInterval: 0, maxInterval: 0, stepRatio: 0, leapRatio: 0, unisonRatio: 0, variety: 0, rut: null, monotonous: false, erratic: false };
    const midis = analysisHelpers.extractMidiArray(notes, 60);

    let sumInterval = 0;
    let maxInterval = 0;
    let steps = 0;   // 1-2 semitones
    let leaps = 0;   // 3+ semitones
    let unisons = 0; // 0 semitones
    let other = 0;   // 3-4 semitones (sub-leap)
    const count = notes.length - 1;

    for (let i = 1; i < midis.length; i++) {
      const prev = midis[i - 1];
      const curr = midis[i];
      const interval = m.abs(curr - prev);
      sumInterval += interval;
      if (interval > maxInterval) maxInterval = interval;

      if (interval === 0) unisons++;
      else if (interval <= 2) steps++;
      else if (interval >= 5) leaps++;
      else other++;
    }

    const total = steps + leaps + unisons + other;
    if (total === 0) {
      return { avgInterval: 0, maxInterval: 0, stepRatio: 0, leapRatio: 0, unisonRatio: 0, variety: 0, rut: null, monotonous: false, erratic: false };
    }

    const avgInterval = sumInterval / count;
    const stepRatio = steps / total;
    const leapRatio = leaps / total;
    const unisonRatio = unisons / total;

    // Variety: entropy measure (higher = more diverse)
    const otherRatio = other / total;
    const buckets = [stepRatio, leapRatio, unisonRatio, otherRatio];
    let entropy = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i] > 0) entropy -= buckets[i] * m.log2(buckets[i]);
    }
    const variety = clamp(entropy / 2, 0, 1);

    let rut = null;
    if (stepRatio > 0.7) rut = 'step-rut';
    else if (leapRatio > 0.6) rut = 'leap-rut';
    else if (unisonRatio > 0.5) rut = 'unison-rut';

    return {
      avgInterval,
      maxInterval,
      stepRatio,
      leapRatio,
      unisonRatio,
      variety,
      rut,
      monotonous: stepRatio > 0.8,
      erratic: leapRatio > 0.6
    };
  }

  /**
   * Get interval selection biases to escape ruts and maintain balance.
   * Combines rut-escape biases with corrective leap/step balance (~40% leaps / 60% steps).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ stepBias: number, leapBias: number }}
   */
  function getIntervalBias(opts) {
    const profile = getIntervalProfile(opts);

    // Rut-escape biases (high priority)
    if (profile.rut === 'step-rut') return { stepBias: 0.8, leapBias: 1.35 };
    if (profile.rut === 'leap-rut') return { stepBias: 1.3, leapBias: 0.8 };
    if (profile.rut === 'unison-rut') return { stepBias: 1.2, leapBias: 1.2 };

    // Corrective balance toward ~40% leaps
    const leapsIncludingOther = profile.leapRatio + (1 - profile.stepRatio - profile.leapRatio - profile.unisonRatio);
    const idealLeapRatio = 0.4;
    const deviation = leapsIncludingOther - idealLeapRatio;
    return {
      stepBias: clamp(1 + deviation * 0.5, 0.7, 1.3),
      leapBias: clamp(1 - deviation * 0.6, 0.7, 1.4)
    };
  }

  /**
   * Get density multiplier for targetDensity chain.
   * Very unbalanced intervals - slight density correction.
   * @returns {number}
   */
  function getDensityBias() {
    const profile = getIntervalProfile();
    const leapTotal = profile.leapRatio + (1 - profile.stepRatio - profile.leapRatio - profile.unisonRatio);
    const deviation = m.abs(leapTotal - 0.4);
    return clamp(1 - deviation * 0.2, 0.9, 1.1);
  }

  /**
   * Get a leap-penalty bias for voice leading scoring.
   * Monotonous - reduce leap penalty; erratic - increase it.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.5 to 1.5
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
    if (profile.monotonous) return { suggestion: 'widen', targetAvgInterval: 4 };
    if (profile.erratic) return { suggestion: 'narrow', targetAvgInterval: 2 };
    return { suggestion: 'maintain', targetAvgInterval: profile.avgInterval };
  }

  conductorIntelligence.registerDensityBias('intervalBalanceTracker', () => intervalBalanceTracker.getDensityBias(), 0.90, 1.1);
  conductorIntelligence.registerStateProvider('intervalBalanceTracker', () => {
    const b = intervalBalanceTracker.getIntervalBias();
    return {
      intervalStepBias: b ? b.stepBias : 1,
      intervalLeapBias: b ? b.leapBias : 1,
      leapStepLeapBias: b ? b.leapBias : 1,
      leapStepStepBias: b ? b.stepBias : 1
    };
  });

  function reset() {}
  conductorIntelligence.registerModule('intervalBalanceTracker', { reset }, ['section']);

  return {
    getIntervalProfile,
    getIntervalBias,
    getDensityBias,
    getLeapPenaltyBias,
    suggestIntervalChange
  };
})();
