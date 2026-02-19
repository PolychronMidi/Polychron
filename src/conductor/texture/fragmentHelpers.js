// src/conductor/texture/fragmentHelpers.js - Shared pitch-class fragment extraction.
// Used by MotivicDensityTracker, RepetitionFatigueMonitor.
// Pure query — reads AbsoluteTimeWindow.

fragmentHelpers = (() => {
  /**
   * Extract pitch-class interval fragments of a given length from recent notes.
   * Each fragment is a string key of consecutive PC intervals (e.g., "3,7").
   * @param {number} [length=3] - fragment note count
   * @param {number} [windowSeconds=6] - lookback window
   * @returns {string[]} - array of fragment keys
   */
  function getPCFragments(length, windowSeconds) {
    const fragLen = (typeof length === 'number' && length >= 2) ? length : 3;
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : 6;
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: ws });
    if (notes.length < fragLen) return [];

    /** @type {string[]} */
    const fragments = [];
    for (let i = 0; i <= notes.length - fragLen; i++) {
      const pcs = [];
      let valid = true;
      for (let j = 0; j < fragLen; j++) {
        const midi = notes[i + j].midi;
        if (typeof midi !== 'number' || !Number.isFinite(midi)) { valid = false; break; }
        pcs.push(((midi % 12) + 12) % 12);
      }
      if (!valid) continue;

      // Build interval key
      const intervals = [];
      for (let j = 1; j < pcs.length; j++) {
        intervals.push(((pcs[j] - pcs[j - 1]) + 12) % 12);
      }
      fragments.push(intervals.join(','));
    }
    return fragments;
  }

  return { getPCFragments };
})();
