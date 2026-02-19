// src/conductor/DynamicContrastMemory.js - Remembers dynamic extremes across the piece.
// Ensures sufficient velocity contrast range is exploited over the full duration.
// Pure query API — widens dynamics when contrast range is underused.

DynamicContrastMemory = (() => {
  let globalMin = 127;
  let globalMax = 0;
  /** @type {Array<{ time: number, min: number, max: number }>} */
  const snapshots = [];
  const MAX_SNAPSHOTS = 32;

  /**
   * Record velocity extremes from a recent window.
   * Call periodically (e.g., once per beat).
   * @param {number} time - absolute time in seconds
   */
  function recordExtremes(time) {
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new Error('DynamicContrastMemory.recordExtremes: time must be finite');
    }

    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: 2 });
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
   * Analyze dynamic contrast usage across the piece.
   * @returns {{ globalRange: number, recentRange: number, contrastDeficit: boolean, suggestion: string }}
   */
  function getContrastProfile() {
    const globalRange = globalMax - globalMin;

    // Recent range from last 8 snapshots
    let recentMin = 127;
    let recentMax = 0;
    const recent = snapshots.slice(-8);
    for (let i = 0; i < recent.length; i++) {
      if (recent[i].min < recentMin) recentMin = recent[i].min;
      if (recent[i].max > recentMax) recentMax = recent[i].max;
    }
    const recentRange = recentMax - recentMin;

    // Deficit if recent range is much smaller than what we've shown is possible
    const contrastDeficit = globalRange > 30 && recentRange < globalRange * 0.4;

    let suggestion = 'sufficient';
    if (contrastDeficit) suggestion = 'widen-dynamics';
    else if (globalRange < 20) suggestion = 'explore-extremes';

    return { globalRange, recentRange, contrastDeficit, suggestion };
  }

  /**
   * Get a flicker amplitude modifier to encourage dynamic contrast.
   * Contrast deficit → amplify flicker so density creates wider velocity spread.
   * @returns {number} - 0.95 to 1.2
   */
  function getFlickerModifier() {
    const profile = getContrastProfile();
    if (profile.contrastDeficit) return 1.15;
    if (profile.suggestion === 'explore-extremes') return 1.1;
    return 1.0;
  }

  /** Reset tracking. */
  function reset() {
    globalMin = 127;
    globalMax = 0;
    snapshots.length = 0;
  }

  return {
    recordExtremes,
    getContrastProfile,
    getFlickerModifier,
    reset
  };
})();
