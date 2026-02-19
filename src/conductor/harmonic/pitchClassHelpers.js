// src/conductor/harmonic/pitchClassHelpers.js - Shared pitch-class histogram utility.
// Used by ChromaticSaturationMonitor, ModalColorTracker, PitchClassGravityMap, TonalAnchorDistanceTracker.
// Pure query — reads AbsoluteTimeWindow.

pitchClassHelpers = (() => {
  /**
   * Build a 12-element pitch-class count histogram from recent notes.
   * @param {number} [windowSeconds=8] - lookback window
   * @returns {number[]} - array of 12 counts, indexed by pitch class (C=0)
   */
  function getPitchClassHistogram(windowSeconds) {
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : 8;
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: ws });
    const counts = new Array(12).fill(0);
    for (let i = 0; i < notes.length; i++) {
      const midi = notes[i].midi;
      if (typeof midi === 'number' && Number.isFinite(midi)) {
        counts[((midi % 12) + 12) % 12]++;
      }
    }
    return counts;
  }

  return { getPitchClassHistogram };
})();
