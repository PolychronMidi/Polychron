// src/conductor/TemporalProportionTracker.js - Golden-ratio / Fibonacci proportions in durations.
// Tracks phrase & section durations, evaluates how close their ratios come to
// aesthetically pleasing proportions (Ï• â‰ˆ 1.618, âˆš2, 2:3, etc.).
// Pure query API â€” signals proportion quality and nudge suggestions.

TemporalProportionTracker = (() => {
  const V = Validator.create('temporalProportionTracker');
  const PHI = 1.618033988749895;
  /** @type {number[]} */
  const sectionDurations = [];
  /** @type {number[]} */
  const phraseDurations = [];
  const MAX_HISTORY = 24;

  // Target ratios ranked by aesthetic preference
  const TARGET_RATIOS = [PHI, 2 / 3, 3 / 5, 1, 1.414];

  /**
   * Record a completed section duration.
   * @param {number} durationBeats
   */
  function recordSection(durationBeats) {
    V.requireFinite(durationBeats, 'durationBeats');
    if (durationBeats <= 0) throw new Error('TemporalProportionTracker: durationBeats must be > 0');
    sectionDurations.push(durationBeats);
    if (sectionDurations.length > MAX_HISTORY) sectionDurations.shift();
  }

  /**
   * Record a completed phrase duration.
   * @param {number} durationBeats
   */
  function recordPhrase(durationBeats) {
    V.requireFinite(durationBeats, 'durationBeats');
    if (durationBeats <= 0) throw new Error('TemporalProportionTracker: durationBeats must be > 0');
    phraseDurations.push(durationBeats);
    if (phraseDurations.length > MAX_HISTORY) phraseDurations.shift();
  }

  /**
   * Compute how close recent consecutive ratios are to golden targets.
   * @param {number[]} durations
   * @returns {number} 0-1 proportion quality (1 = perfect golden ratio)
   */
  function computeRatioQuality(durations) {
    if (durations.length < 2) return 0.5;
    let totalFit = 0;
    let pairs = 0;
    for (let i = 1; i < durations.length; i++) {
      const shorter = m.min(durations[i - 1], durations[i]);
      const longer = m.max(durations[i - 1], durations[i]);
      if (shorter <= 0) continue;
      const ratio = longer / shorter;
      // Find closest target ratio
      let bestDist = Infinity;
      for (let t = 0; t < TARGET_RATIOS.length; t++) {
        const dist = m.abs(ratio - TARGET_RATIOS[t]);
        if (dist < bestDist) bestDist = dist;
      }
      // Convert distance to 0-1 quality (0 dist â†’ 1 quality)
      totalFit += m.max(0, 1 - bestDist * 0.8);
      pairs++;
    }
    return pairs > 0 ? totalFit / pairs : 0.5;
  }

  /**
   * Suggest an ideal next phrase length based on golden-ratio relationship to previous.
   * @returns {{ suggestion: string, idealBeats: number, quality: number }}
   */
  function getProportionSignal() {
    const phraseQuality = computeRatioQuality(phraseDurations);
    const sectionQuality = computeRatioQuality(sectionDurations);
    const quality = (phraseQuality + sectionQuality) * 0.5;

    // Suggest ideal next phrase length
    let idealBeats = 8; // default
    if (phraseDurations.length > 0) {
      const last = phraseDurations[phraseDurations.length - 1];
      // Suggest golden-ratio-related length
      idealBeats = m.round(last * PHI);
      if (idealBeats > 32) idealBeats = m.round(last / PHI);
      if (idealBeats < 2) idealBeats = m.round(last * PHI);
    }

    let suggestion = 'maintain';
    if (quality < 0.35) suggestion = 'seek-proportion';
    else if (quality > 0.75) suggestion = 'proportional';

    return { suggestion, idealBeats, quality };
  }

  /** Reset tracking. */
  function reset() {
    sectionDurations.length = 0;
    phraseDurations.length = 0;
  }

  ConductorIntelligence.registerStateProvider('TemporalProportionTracker', () => {
    const s = TemporalProportionTracker.getProportionSignal();
    return {
      proportionSuggestion: s ? s.suggestion : 'maintain',
      proportionIdealBeats: s ? s.idealBeats : 8,
      proportionQuality: s ? s.quality : 0.5
    };
  });
  ConductorIntelligence.registerModule('TemporalProportionTracker', { reset }, ['section']);

  return {
    recordSection,
    recordPhrase,
    getProportionSignal,
    reset
  };
})();

