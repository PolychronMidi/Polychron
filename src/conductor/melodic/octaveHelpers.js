// src/conductor/melodic/octaveHelpers.js - Shared octave histogram utility.
// Used by OctaveSpreadMonitor, RegisterPressureMonitor.
// Pure query — reads AbsoluteTimeWindow.

octaveHelpers = (() => {
  /**
   * Build an octave-band count histogram from recent notes.
   * @param {number} [windowSeconds=6] - lookback window
   * @param {number} [bands=11] - number of octave bands (0-10 by default)
   * @returns {{ counts: number[], total: number }}
   */
  function getOctaveHistogram(windowSeconds, bands) {
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : 6;
    const numBands = (typeof bands === 'number' && bands > 0) ? bands : 11;
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: ws });
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
