// src/conductor/melodic/MelodicContourTracker.js - Tracks pitch trajectory across recent notes.
// Reads AbsoluteTimeWindow to compute phrase-scale contour shape (rising/falling/arching/static).
// Also provides melodic directionality analysis (ascending/descending bias) — merged from
// MelodicDirectionalityTracker.
// Pure query API — no events emitted; polled by GlobalConductor and MotifTransformAdvisor.

MelodicContourTracker = (() => {
  /** @type {{ shape: string, direction: number, range: number, avgPitch: number }} */
  let currentContour = { shape: 'static', direction: 0, range: 0, avgPitch: 60 };

  const DEFAULT_CONTOUR = { shape: 'static', direction: 0, range: 0, avgPitch: 60 };

  /**
   * Compute contour shape from an array of MIDI pitches.
   * @param {number[]} pitches
   * @returns {{ shape: string, direction: number, range: number, avgPitch: number }}
   */
  function _computeContour(pitches) {
    const thirdLen = m.max(1, m.ceil(pitches.length / 3));
    let sumFirst = 0;
    let sumLast = 0;
    let sumAll = 0;
    for (let i = 0; i < thirdLen; i++) sumFirst += pitches[i];
    for (let i = pitches.length - thirdLen; i < pitches.length; i++) sumLast += pitches[i];
    for (let i = 0; i < pitches.length; i++) sumAll += pitches[i];

    const avgFirst = sumFirst / thirdLen;
    const avgLast = sumLast / thirdLen;
    const direction = clamp((avgLast - avgFirst) / 12, -1, 1);

    let lo = pitches[0];
    let hi = pitches[0];
    for (let i = 1; i < pitches.length; i++) {
      if (pitches[i] < lo) lo = pitches[i];
      if (pitches[i] > hi) hi = pitches[i];
    }
    const range = hi - lo;
    const avgPitch = sumAll / pitches.length;

    let shape = 'static';
    if (direction > 0.15) shape = 'rising';
    else if (direction < -0.15) shape = 'falling';
    else if (range > 12) shape = 'arching';

    return { shape, direction, range, avgPitch };
  }

  /**
   * Recompute the melodic contour from the recent note window.
   * Called at phrase boundaries or by any consumer needing a fresh read.
   */
  function update() {
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: 4 });
    if (notes.length < 3) return;
    const pitches = notes.map(n => n.midi);
    currentContour = _computeContour(pitches);
  }

  /**
   * Get the current contour snapshot.
   * @returns {{ shape: string, direction: number, range: number, avgPitch: number }}
   */
  function getContour() {
    return { shape: currentContour.shape, direction: currentContour.direction, range: currentContour.range, avgPitch: currentContour.avgPitch };
  }

  /**
   * Suggest a contrasting contour direction for variety.
   * @returns {{ preferredDirection: number, bias: string }}
   */
  function getContrastingSuggestion() {
    switch (currentContour.shape) {
      case 'rising': return { preferredDirection: -1, bias: 'falling' };
      case 'falling': return { preferredDirection: 1, bias: 'rising' };
      case 'arching': return { preferredDirection: 0, bias: 'narrow' };
      default: return { preferredDirection: rf() < 0.5 ? 1 : -1, bias: 'dynamic' };
    }
  }

  /**
   * Get contour for a specific layer only.
   * @param {string} layer - e.g. 'L1', 'L2'
   * @returns {{ shape: string, direction: number, range: number, avgPitch: number }}
   */
  function getLayerContour(layer) {
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: 4 });
    if (notes.length < 3) return DEFAULT_CONTOUR;
    return _computeContour(notes.map(n => n.midi));
  }

  // --- Directionality analysis (merged from MelodicDirectionalityTracker) ---

  /**
   * Analyze predominant melodic direction from recent notes.
   * @returns {{ direction: string, ascendRatio: number, descendRatio: number, densityBias: number }}
   */
  function getDirectionalitySignal() {
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: 8 });
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

    let direction = 'undulating';
    if (ascendRatio > 0.65) direction = 'ascending';
    else if (descendRatio > 0.65) direction = 'descending';
    else if (ascendRatio < 0.2 && descendRatio < 0.2) direction = 'static';

    const imbalance = m.abs(ascendRatio - descendRatio);
    let densityBias = 1;
    if (imbalance > 0.5) densityBias = 0.95;
    else if (imbalance < 0.1) densityBias = 1.02;

    return { direction, ascendRatio, descendRatio, densityBias };
  }

  /**
   * Get density multiplier for the targetDensity chain (directionality).
   * @returns {number}
   */
  function getDirectionalityDensityBias() {
    return getDirectionalitySignal().densityBias;
  }

  /** Reset contour state. */
  function reset() {
    currentContour = { shape: 'static', direction: 0, range: 0, avgPitch: 60 };
  }

  return {
    update,
    getContour,
    getContrastingSuggestion,
    getLayerContour,
    getDirectionalitySignal,
    getDirectionalityDensityBias,
    reset
  };
})();
