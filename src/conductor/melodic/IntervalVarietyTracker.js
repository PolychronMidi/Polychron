// src/conductor/IntervalVarietyTracker.js - Melodic interval diversity analysis.
// Detects step-ruts (all 2nds), leap-ruts (all 5ths+), or unison-ruts.
// Pure query API — biases interval selection weight in composers.

IntervalVarietyTracker = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Analyze melodic interval distribution in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ stepRatio: number, leapRatio: number, unisonRatio: number, variety: number, rut: string|null }}
   */
  function getIntervalProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 3) {
      return { stepRatio: 0, leapRatio: 0, unisonRatio: 0, variety: 0, rut: null };
    }

    let steps = 0;   // 1-2 semitones
    let leaps = 0;   // 5+ semitones
    let unisons = 0; // 0 semitones
    let other = 0;   // 3-4 semitones (minor/major 3rd)

    for (let i = 1; i < notes.length; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : 60;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : 60;
      const interval = m.abs(curr - prev);

      if (interval === 0) unisons++;
      else if (interval <= 2) steps++;
      else if (interval >= 5) leaps++;
      else other++;
    }

    const total = steps + leaps + unisons + other;
    if (total === 0) {
      return { stepRatio: 0, leapRatio: 0, unisonRatio: 0, variety: 0, rut: null };
    }

    const stepRatio = steps / total;
    const leapRatio = leaps / total;
    const unisonRatio = unisons / total;

    // Variety = entropy-like measure (higher = more diverse)
    const otherRatio = other / total;
    const buckets = [stepRatio, leapRatio, unisonRatio, otherRatio];
    let entropy = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i] > 0) entropy -= buckets[i] * m.log2(buckets[i]);
    }
    const variety = clamp(entropy / 2, 0, 1); // Normalize (max entropy = 2 for 4 buckets)

    let rut = null;
    if (stepRatio > 0.7) rut = 'step-rut';
    else if (leapRatio > 0.6) rut = 'leap-rut';
    else if (unisonRatio > 0.5) rut = 'unison-rut';

    return { stepRatio, leapRatio, unisonRatio, variety, rut };
  }

  /**
   * Get interval selection biases to escape ruts.
   * Step-rut → boost leaps; leap-rut → boost steps; unison-rut → boost all movement.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ stepBias: number, leapBias: number }}
   */
  function getIntervalBias(opts) {
    const profile = getIntervalProfile(opts);
    if (profile.rut === 'step-rut') {
      return { stepBias: 0.8, leapBias: 1.35 };
    }
    if (profile.rut === 'leap-rut') {
      return { stepBias: 1.3, leapBias: 0.8 };
    }
    if (profile.rut === 'unison-rut') {
      return { stepBias: 1.2, leapBias: 1.2 };
    }
    return { stepBias: 1.0, leapBias: 1.0 };
  }

  return {
    getIntervalProfile,
    getIntervalBias
  };
})();
