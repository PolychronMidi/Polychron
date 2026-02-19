// src/conductor/MelodicDirectionalityTracker.js - Predominant melodic direction tracker.
// Measures whether recent melodic motion is predominantly ascending, descending,
// or undulating. Biases toward corrective motion when direction is monotonous.
// Pure query API — density bias for range balance.

MelodicDirectionalityTracker = (() => {
  const WINDOW_SECONDS = 8;

  /**
   * Analyze melodic directionality from recent notes.
   * @returns {{ direction: string, ascendRatio: number, descendRatio: number, densityBias: number }}
   */
  function getDirectionalitySignal() {
    const notes = (typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.getNotes === 'function')
      ? AbsoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS })
      : [];

    if (notes.length < 4) {
      return { direction: 'undulating', ascendRatio: 0.5, descendRatio: 0.5, densityBias: 1 };
    }

    let ascends = 0;
    let descends = 0;
    let total = 0;

    for (let i = 1; i < notes.length; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : -1;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : -1;
      if (prev < 0 || curr < 0) continue;
      const diff = curr - prev;
      if (diff > 0) ascends++;
      else if (diff < 0) descends++;
      total++;
    }

    if (total === 0) {
      return { direction: 'static', ascendRatio: 0.5, descendRatio: 0.5, densityBias: 1 };
    }

    const ascendRatio = ascends / total;
    const descendRatio = descends / total;

    // Determine predominant direction
    let direction = 'undulating';
    if (ascendRatio > 0.65) direction = 'ascending';
    else if (descendRatio > 0.65) direction = 'descending';
    else if (ascendRatio < 0.2 && descendRatio < 0.2) direction = 'static';

    // Density bias: highly directional → slight reduction to avoid running
    // out of register space; balanced → allow normal density
    const imbalance = m.abs(ascendRatio - descendRatio);
    let densityBias = 1;
    if (imbalance > 0.5) {
      densityBias = 0.95; // very one-directional
    } else if (imbalance < 0.1) {
      densityBias = 1.02; // well-balanced undulation
    }

    return { direction, ascendRatio, descendRatio, densityBias };
  }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getDirectionalitySignal().densityBias;
  }

  return {
    getDirectionalitySignal,
    getDensityBias
  };
})();
