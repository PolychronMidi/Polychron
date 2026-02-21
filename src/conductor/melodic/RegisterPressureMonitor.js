// src/conductor/RegisterPressureMonitor.js - Monitors pitch-register density across layers.
// Queries AbsoluteTimeWindow for pitch distribution across octave bands.
// Pure query API — guides voice allocation to avoid register crowding.

RegisterPressureMonitor = (() => {
  const NUM_BANDS = 10; // octave bands 0-9 (MIDI 0-119)

  /**
   * Get note counts per octave band for a given layer (or all layers).
   * @param {Object} [opts]
   * @param {string} [opts.layer] - filter by layer
   * @param {number} [opts.windowSeconds] - analysis window (default 4s)
   * @returns {Array<number>} - 10-element array of note counts per octave band
   */
  function getRegisterPressure(opts = {}) {
    const { layer, windowSeconds } = opts;
    const { counts } = octaveHelpers.getOctaveHistogram(windowSeconds || 4, NUM_BANDS, layer);
    return counts;
  }

  /**
   * Compute overlap between L1 and L2 register usage.
   * Returns 0 (no overlap) to 1 (identical distribution).
   * @param {number} [windowSeconds]
   * @returns {number}
   */
  function getCrossLayerOverlap(windowSeconds) {
    const l1 = getRegisterPressure({ layer: 'L1', windowSeconds });
    const l2 = getRegisterPressure({ layer: 'L2', windowSeconds });
    const l1Total = l1.reduce((a, b) => a + b, 0);
    const l2Total = l2.reduce((a, b) => a + b, 0);
    if (l1Total === 0 || l2Total === 0) return 0;

    // Normalize both to probability distributions, compute overlap coefficient
    let overlap = 0;
    for (let i = 0; i < NUM_BANDS; i++) {
      overlap += m.min(l1[i] / l1Total, l2[i] / l2Total);
    }
    return clamp(overlap, 0, 1);
  }

  /**
   * Suggest a register bias to reduce crowding.
   * Returns an octave offset suggestion (-2 to +2) for the current layer.
   * @param {string} layer - current layer
   * @returns {{ octaveBias: number, crowdedBands: Array<number>, emptyBands: Array<number> }}
   */
  function getRegisterBias(layer) {
    const bands = getRegisterPressure({ layer, windowSeconds: 4 });
    const total = bands.reduce((a, b) => a + b, 0);
    if (total < 4) return { octaveBias: 0, crowdedBands: [], emptyBands: [] };

    // Find playable range from OCTAVE globals
    const minBand = (OCTAVE) ? m.floor(OCTAVE.min) : 3;
    const maxBand = (OCTAVE) ? m.floor(OCTAVE.max) : 7;

    const crowdedBands = [];
    const emptyBands = [];
    const threshold = total / (maxBand - minBand + 1);

    for (let i = minBand; i <= maxBand; i++) {
      if (bands[i] > threshold * 1.8) crowdedBands.push(i);
      if (bands[i] < threshold * 0.3) emptyBands.push(i);
    }

    // Bias toward empty bands, away from crowded bands
    let octaveBias = 0;
    if (emptyBands.length > 0 && crowdedBands.length > 0) {
      const avgEmpty = emptyBands.reduce((a, b) => a + b, 0) / emptyBands.length;
      const avgCrowded = crowdedBands.reduce((a, b) => a + b, 0) / crowdedBands.length;
      octaveBias = clamp(m.round(avgEmpty - avgCrowded), -2, 2);
    }

    return { octaveBias, crowdedBands, emptyBands };
  }

  /**
   * Get a high/low register pressure signal.
   * High pressure = notes crowded at extremes of playable range.
   * @param {Object} [opts]
   * @param {number} [opts.windowSeconds]
   * @returns {{ highPressure: boolean, lowPressure: boolean }}
   */
  function getPressureSignal(opts) {
    const bands = getRegisterPressure(opts);
    const total = bands.reduce((a, b) => a + b, 0);
    if (total < 4) return { highPressure: false, lowPressure: false };
    // High bands (7-9) vs mid bands (4-6)
    const highCount = bands[7] + bands[8] + bands[9];
    const lowCount = bands[0] + bands[1] + bands[2] + bands[3];
    const midCount = bands[4] + bands[5] + bands[6];
    const threshold = midCount * 1.5;
    return {
      highPressure: highCount > threshold,
      lowPressure: lowCount > threshold
    };
  }

  return {
    getRegisterPressure,
    getCrossLayerOverlap,
    getRegisterBias,
    getPressureSignal
  };
})();
