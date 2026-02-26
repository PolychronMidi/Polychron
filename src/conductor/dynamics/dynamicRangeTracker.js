// src/conductor/dynamics/dynamicRangeTracker.js - Unified dynamic range analysis.
// Merges DynamicRangeAdvisor + DynamicContrastMemory.
// Provides instantaneous velocity spread bias + longitudinal contrast tracking.
// Pure query API - recordExtremes for longitudinal memory.

dynamicRangeTracker = (() => {
  const V = validator.create('dynamicRangeTracker');
  const WINDOW_SECONDS = 4;
  let globalMin = 127;
  let globalMax = 0;
  /** @type {Array<{ time: number, min: number, max: number }>} */
  const snapshots = [];
  const MAX_SNAPSHOTS = 32;

  // Beat-level cache: getVelocityProfile is called 2x per beat (getSpreadBias via flickerModifier + suggestDynamicShift)
  const _velocityCache = beatCache.create(() => _getVelocityProfile());

  /**
   * Analyze the velocity distribution of recent notes (instantaneous view).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ min: number, max: number, mean: number, spread: number, compressed: boolean }}
   */
  function getVelocityProfile(opts) {
    if (opts === undefined) return _velocityCache.get();
    return _getVelocityProfile(opts);
  }

  /** @private */
  function _getVelocityProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = absoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 3) {
      return { min: 64, max: 64, mean: 64, spread: 0, compressed: false };
    }

    let lo = 127;
    let hi = 0;
    let sum = 0;
    for (let i = 0; i < notes.length; i++) {
      const v = (typeof notes[i].velocity === 'number') ? notes[i].velocity : 64;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
    }
    const mean = sum / notes.length;
    const spread = hi - lo;
    return { min: lo, max: hi, mean, spread, compressed: spread < 20 };
  }

  /**
   * Get velocity-spread bias for the flickerAmplitude chain.
   * Continuous ramp: narrow spread → widen (boost); wide spread → slight reduction.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.8 to 1.3
   */
  function getSpreadBias(opts) {
    const profile = getVelocityProfile(opts);
    // Continuous ramp: spread 0→30 maps to 1.15→1.0; spread 30→80 maps to 1.0→0.92
    // (raised floor from 0.88 to 0.92 to reduce flicker crush)
    if (profile.spread <= 30) {
      return 1.15 - (profile.spread / 30) * 0.15;
    }
    const ramp = clamp((profile.spread - 30) / 50, 0, 1);
    return 1.0 - ramp * 0.08;
  }

  /**
   * Record velocity extremes from a recent window (longitudinal tracking).
   * Call periodically (e.g., once per beat).
   * @param {number} time - absolute time in seconds
   */
  function recordExtremes(time) {
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new Error('dynamicRangeTracker.recordExtremes: time must be finite');
    }

    const notes = absoluteTimeWindow.getNotes({ windowSeconds: 2 });
    if (notes.length < 2) return;

    let windowMin = 127;
    let windowMax = 0;
    for (let i = 0; i < notes.length; i++) {
      const vel = (typeof notes[i].velocity === 'number') ? notes[i].velocity : 64;
      if (vel < windowMin) windowMin = vel;
      if (vel > windowMax) windowMax = vel;
    }

    if (windowMin < globalMin) globalMin = windowMin;
    if (windowMax > globalMax) globalMax = windowMax;

    snapshots.push({ time, min: windowMin, max: windowMax });
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
  }

  /**
   * Analyze dynamic contrast usage across the piece (longitudinal view).
   * @returns {{ globalRange: number, recentRange: number, contrastDeficit: boolean, suggestion: string }}
   */
  function getContrastProfile() {
    const globalRange = globalMax - globalMin;

    let recentMin = 127;
    let recentMax = 0;
    const recent = snapshots.slice(-8);
    for (let i = 0; i < recent.length; i++) {
      if (recent[i].min < recentMin) recentMin = recent[i].min;
      if (recent[i].max > recentMax) recentMax = recent[i].max;
    }
    const recentRange = recentMax - recentMin;

    const contrastDeficit = globalRange > 30 && recentRange < globalRange * 0.4;

    let suggestion = 'sufficient';
    if (contrastDeficit) suggestion = 'widen-dynamics';
    else if (globalRange < 20) suggestion = 'explore-extremes';

    return { globalRange, recentRange, contrastDeficit, suggestion };
  }

  /**
   * Get contrast-driven flicker modifier.
   * Continuous ramp based on dynamic range utilization.
   * Narrow global range or low recent utilization → amplify flicker.
   * @returns {number} - 0.95 to 1.2
   */
  function getContrastFlickerModifier() {
    const profile = getContrastProfile();
    if (profile.globalRange < 1) return 1.0;
    if (profile.globalRange < 30) {
      // Narrow global range — ramp boost: globalRange 0→30 maps to 1.1→1.0
      return 1.0 + clamp((30 - profile.globalRange) / 30, 0, 1) * 0.1;
    }
    // Wide global range — ramp based on recent utilization ratio
    // utilizationRatio 0→0.8 maps to 1.15→1.0
    const utilizationRatio = profile.recentRange / profile.globalRange;
    return 1.0 + clamp((0.8 - utilizationRatio) / 0.8, 0, 1) * 0.15;
  }

  /**
   * Suggest velocity adjustment direction.
   * @returns {{ direction: string, magnitude: number }}
   */
  function suggestDynamicShift() {
    const profile = getVelocityProfile();
    if (profile.compressed && profile.mean > 80) return { direction: 'soften', magnitude: 0.3 };
    if (profile.compressed && profile.mean < 50) return { direction: 'brighten', magnitude: 0.3 };
    if (profile.spread > 70) return { direction: 'stabilize', magnitude: 0.15 };
    return { direction: 'maintain', magnitude: 0 };
  }

  /** Reset tracking. */
  function reset() {
    globalMin = 127;
    globalMax = 0;
    snapshots.length = 0;
  }

  conductorIntelligence.registerFlickerModifier('dynamicRangeTracker:spread', () => dynamicRangeTracker.getSpreadBias(), 0.92, 1.15);
  conductorIntelligence.registerFlickerModifier('dynamicRangeTracker:contrast', () => dynamicRangeTracker.getContrastFlickerModifier(), 0.95, 1.2);
  conductorIntelligence.registerRecorder('dynamicRangeTracker', (ctx) => { dynamicRangeTracker.recordExtremes(ctx.absTime); });
  conductorIntelligence.registerModule('dynamicRangeTracker', { reset }, ['section']);

  return {
    getVelocityProfile,
    getSpreadBias,
    recordExtremes,
    getContrastProfile,
    getContrastFlickerModifier,
    suggestDynamicShift,
    reset
  };
})();
