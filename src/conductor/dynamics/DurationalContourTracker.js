// src/conductor/DurationalContourTracker.js - Tracks note-duration trajectory over time.
// Detects acceleration (durations getting shorter) or deceleration (durations getting longer).
// Pure query API - biases duration envelope for intentional temporal shaping.

DurationalContourTracker = (() => {
  const V = validator.create('durationalContourTracker');
  const WINDOW_SECONDS = 4;

  // Beat-level cache: getDurationBias is called 2x per beat (flickerModifier + stateProvider)
  const _biasCache = beatCache.create(() => _getDurationBias());

  /**
   * Analyze duration contour in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, trend: string, avgDuration: number, accelerating: boolean, decelerating: boolean }}
   */
  function getDurationContour(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { slope: 0, trend: 'insufficient', avgDuration: 0, accelerating: false, decelerating: false };
    }

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
   * Accelerating â†’ gently resist (boost longer durations); decelerating â†’ gently resist (boost shorter).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ durationBias: number, flickerMod: number }}
   */
  function getDurationBias(opts) {
    if (opts === undefined) return _biasCache.get();
    return _getDurationBias(opts);
  }

  /** @private */
  function _getDurationBias(opts) {
    const contour = getDurationContour(opts);
    // Continuous ramp based on normalizedSlope magnitude.
    // slope is normalized: negative = accelerating, positive = decelerating.
    // Use slope to interpolate rather than boolean thresholds.
    const beatDur = beatGridHelpers.getBeatDuration();
    const normSlope = beatDur > 0 ? contour.slope / beatDur : 0;
    if (normSlope < -0.05) {
      // Accelerating: ramp durationBias 1.0→1.15, flickerMod 1.0→1.1
      const t = clamp((m.abs(normSlope) - 0.05) / 0.25, 0, 1);
      return { durationBias: 1.0 + t * 0.15, flickerMod: 1.0 + t * 0.1 };
    }
    if (normSlope > 0.05) {
      // Decelerating: ramp durationBias 1.0→0.85, flickerMod 1.0→1.05
      const t = clamp((normSlope - 0.05) / 0.25, 0, 1);
      return { durationBias: 1.0 - t * 0.15, flickerMod: 1.0 + t * 0.05 };
    }
    return { durationBias: 1.0, flickerMod: 1.0 };
  }

  ConductorIntelligence.registerFlickerModifier('DurationalContourTracker', () => {
    const b = DurationalContourTracker.getDurationBias();
    return b ? b.flickerMod : 1;
  }, 0.8, 1.3);
  ConductorIntelligence.registerStateProvider('DurationalContourTracker', () => {
    const b = DurationalContourTracker.getDurationBias();
    return { durationalContourBias: b ? b.durationBias : 1 };
  });

  return {
    getDurationContour,
    getDurationBias
  };
})();
