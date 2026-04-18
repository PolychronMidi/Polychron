// src/conductor/durationalContourTracker.js - Tracks note-duration trajectory over time.
// Detects acceleration (durations getting shorter) or deceleration (durations getting longer).
// Pure query API - biases duration envelope for intentional temporal shaping.

durationalContourTracker = (() => {
  const V = validator.create('durationalContourTracker');
  const query = analysisHelpers.createTrackerQuery(V, 4, { minNotes: 4 });

  // Beat-level cache: getDurationBias is called 2x per beat (flickerModifier + stateProvider)
  const durationalContourTrackerBiasCache = beatCache.create(() => durationalContourTrackerGetDurationBias());

  /**
   * Analyze duration contour in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, trend: string, avgDuration: number, accelerating: boolean, decelerating: boolean }}
   */
  function getDurationContour(opts = {}) {
    const notes = query(opts);
    if (!notes) return { slope: 0, trend: 'insufficient', avgDuration: 0, accelerating: false, decelerating: false };

    // Beat duration for normalization
    const beatDur = beatGridHelpers.getBeatDuration();

    /** @type {number[]} */
    const durations = [];
    for (let i = 0; i < notes.length; i++) {
      durations.push((typeof notes[i].duration === 'number' && Number.isFinite(notes[i].duration))
        ? notes[i].duration : beatDur * 0.5);
    }
    const { slope, avgFirst, avgSecond } = analysisHelpers.halfSplitSlope(durations);
    const avgDuration = (avgFirst + avgSecond) / 2;

    // Normalize slope relative to beat duration for threshold comparison
    const normalizedSlope = beatDur > 0 ? slope / beatDur : 0;

    let trend = 'stable';
    if (normalizedSlope < -0.1) trend = 'accelerating';
    else if (normalizedSlope > 0.1) trend = 'decelerating';

    return {
      slope,
      trend,
      avgDuration,
      accelerating: normalizedSlope < -0.1,
      decelerating: normalizedSlope > 0.1
    };
  }

  /**
   * Get duration envelope bias for temporal shaping (cached per beat).
   * Accelerating - gently resist (boost longer durations); decelerating - gently resist (boost shorter).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ durationBias: number, flickerMod: number }}
   */
  function getDurationBias(opts) {
    if (opts === undefined) return durationalContourTrackerBiasCache.get();
    return durationalContourTrackerGetDurationBias(opts);
  }

  /** @private */
  function durationalContourTrackerGetDurationBias(opts) {
    const contour = getDurationContour(opts);
    // Continuous ramp based on normalizedSlope magnitude.
    // slope is normalized: negative = accelerating, positive = decelerating.
    // Use slope to interpolate rather than boolean thresholds.
    const beatDur = beatGridHelpers.getBeatDuration();
    const normSlope = beatDur > 0 ? contour.slope / beatDur : 0;
    if (normSlope < -0.02) {
      // Accelerating: ramp durationBias 1.0-1.15, flickerMod 1.0-1.1
      const t = clamp((m.abs(normSlope) - 0.02) / 0.28, 0, 1);
      return { durationBias: 1.0 + t * 0.15, flickerMod: 1.0 + t * 0.1 };
    }
    if (normSlope > 0.02) {
      // Decelerating: ramp durationBias 1.0-0.85, flickerMod 1.0-1.05
      const t = clamp((normSlope - 0.02) / 0.28, 0, 1);
      return { durationBias: 1.0 - t * 0.15, flickerMod: 1.0 + t * 0.05 };
    }
    return { durationBias: 1.0, flickerMod: 1.0 };
  }

  // R11 E4: Tension bias from durational contour. Accelerating notes
  // (durations getting shorter) naturally build intensity -- complement
  // with mild tension increase (up to 1.08). Decelerating notes signal
  // release -- mild tension reduction (down to 0.94). This couples
  // rhythmic momentum with harmonic tension for musically coherent
  // trajectory shaping. A new tension channel from an untouched module.
  function getTensionBias() {
    const contour = getDurationContour();
    const beatDur = beatGridHelpers.getBeatDuration();
    const normSlope = beatDur > 0 ? contour.slope / beatDur : 0;
    if (normSlope < -0.02) {
      const t = clamp((m.abs(normSlope) - 0.02) / 0.28, 0, 1);
      return 1.0 + t * 0.08;
    }
    if (normSlope > 0.02) {
      const t = clamp((normSlope - 0.02) / 0.28, 0, 1);
      return 1.0 - t * 0.06;
    }
    return 1.0;
  }

  conductorIntelligence.registerTensionBias('durationalContourTracker', () => durationalContourTracker.getTensionBias(), 0.94, 1.08);

  conductorIntelligence.registerFlickerModifier('durationalContourTracker', () => {
    const b = durationalContourTracker.getDurationBias();
    return b ? b.flickerMod : 1;
  }, 0.8, 1.3);
  conductorIntelligence.registerStateProvider('durationalContourTracker', () => {
    const b = durationalContourTracker.getDurationBias();
    return { durationalContourBias: b ? b.durationBias : 1 };
  });

  function reset() {}
  conductorIntelligence.registerModule('durationalContourTracker', { reset }, ['section']);

  return {
    getDurationContour,
    getDurationBias,
    getTensionBias
  };
})();
