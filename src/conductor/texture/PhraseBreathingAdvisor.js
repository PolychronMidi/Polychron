// src/conductor/PhraseBreathingAdvisor.js - Detects phrase breathing points.
// Measures whether phrases have natural rest/breathing gaps or are relentlessly dense.
// Pure query API — enforces breathing room by biasing targetDensity downward.

PhraseBreathingAdvisor = (() => {
  const WINDOW_SECONDS = 6;
  const BREATH_THRESHOLD = 0.3; // gaps >0.3s count as breaths

  /**
   * Analyze breathing density in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ breathCount: number, avgGap: number, maxGap: number, breathless: boolean, airy: boolean }}
   */
  function getBreathingProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { breathCount: 0, avgGap: 0, maxGap: 0, breathless: false, airy: false };
    }

    let gapSum = 0;
    let maxGap = 0;
    let breathCount = 0;
    let gapCount = 0;

    for (let i = 1; i < notes.length; i++) {
      const gap = notes[i].time - notes[i - 1].time;
      if (gap > 0) {
        gapSum += gap;
        gapCount++;
        if (gap > maxGap) maxGap = gap;
        if (gap >= BREATH_THRESHOLD) breathCount++;
      }
    }

    const avgGap = gapCount > 0 ? gapSum / gapCount : 0;

    // Breathless = no significant gaps in the window
    const breathless = breathCount === 0 && notes.length > 8;
    // Airy = too many gaps, sparse texture
    const airy = breathCount > notes.length * 0.4;

    return { breathCount, avgGap, maxGap, breathless, airy };
  }

  /**
   * Get a density bias to enforce breathing room.
   * Breathless → reduce density; airy → boost density.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.8 to 1.2
   */
  function getDensityBias(opts) {
    const profile = getBreathingProfile(opts);
    if (profile.breathless) return 0.85;
    if (profile.airy) return 1.15;
    return 1.0;
  }

  return {
    getBreathingProfile,
    getDensityBias
  };
})();
