// src/conductor/melodic/octaveHelpers.js - Shared octave histogram utility.
// Used by octaveSpreadMonitor, registerPressureMonitor.
// Pure query — reads absoluteTimeWindow.

octaveHelpers = (() => {
  const V = validator.create('octaveHelpers');
  /**
   * Build an octave-band count histogram from recent notes.
   * @param {number} [windowSeconds=6] - lookback window
   * @param {number} [bands=11] - number of octave bands (0-10 by default)
   * @param {string} [layer] - optional layer filter (e.g. 'L1', 'L2')
   * @returns {{ counts: number[], total: number }}
   */
  function getOctaveHistogram(windowSeconds, bands, layer) {
    const ws = V.optionalFinite(windowSeconds, 6);
    const numBands = (typeof bands === 'number' && bands > 0) ? bands : 11;
    /** @type {any} */
    const query = { windowSeconds: ws };
    if (typeof layer === 'string' && layer.length > 0) query.layer = layer;
    const notes = absoluteTimeWindow.getNotes(query);
    const counts = new Array(numBands).fill(0);
    let total = 0;
    for (let i = 0; i < notes.length; i++) {
      const midi = notes[i].midi;
      if (typeof midi === 'number' && Number.isFinite(midi)) {
        const octave = clamp(m.floor(midi / 12), 0, numBands - 1);
        counts[octave]++;
        total++;
      }
    }
    return { counts, total };
  }

  return { getOctaveHistogram };
})();
