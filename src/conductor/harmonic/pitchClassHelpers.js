// src/conductor/harmonic/pitchClassHelpers.js - Shared pitch-class utilities.
// Used by ChromaticSaturationMonitor, ModalColorTracker, PitchClassGravityMap,
// TonalAnchorDistanceTracker, ConsonanceDissonanceTracker, TensionResolutionTracker,
// LayerCoherenceScorer.
// Pure query — reads AbsoluteTimeWindow.

pitchClassHelpers = (() => {
  // Consonant intervals (semitones mod 12): P1=0, m3=3, M3=4, P4=5, P5=7, m6=8, M6=9
  const CONSONANT_INTERVALS = new Set([0, 3, 4, 5, 7, 8, 9]);

  /**
   * Build a 12-element pitch-class count histogram from recent notes.
   * @param {number} [windowSeconds=8] - lookback window
   * @param {string} [layer] - optional layer filter (e.g. 'L1', 'L2')
   * @returns {{ counts: number[], total: number }} - 12-element count array + note count
   */
  function getPitchClassHistogram(windowSeconds, layer) {
    const ws = Validator.optionalFinite(windowSeconds, 8);
    /** @type {any} */
    const query = { windowSeconds: ws };
    if (typeof layer === 'string' && layer.length > 0) query.layer = layer;
    const notes = AbsoluteTimeWindow.getNotes(query);
    const counts = new Array(12).fill(0);
    let total = 0;
    for (let i = 0; i < notes.length; i++) {
      const midi = notes[i].midi;
      if (typeof midi === 'number' && Number.isFinite(midi)) {
        counts[((midi % 12) + 12) % 12]++;
        total++;
      }
    }
    return { counts, total };
  }

  /**
   * Build a 12-element pitch-class histogram from a pre-fetched notes array.
   * Avoids re-querying AbsoluteTimeWindow when the caller already has notes.
   * @param {Array<{midi: number}>} notes
   * @returns {{ counts: number[], total: number }}
   */
  function buildFromNotes(notes) {
    const counts = new Array(12).fill(0);
    let total = 0;
    for (let i = 0; i < notes.length; i++) {
      const midi = notes[i].midi;
      if (typeof midi === 'number' && Number.isFinite(midi)) {
        counts[((midi % 12) + 12) % 12]++;
        total++;
      }
    }
    return { counts, total };
  }

  return { CONSONANT_INTERVALS, getPitchClassHistogram, buildFromNotes };
})();
