// src/conductor/MicroTimingDriftDetector.js - Inter-layer timing coherence tracker.
// Measures subtle phase drift between polyrhythmic layers to signal
// timing tightness vs. expressivity/looseness.
// Pure query API — consumed via ConductorState.

MicroTimingDriftDetector = (() => {
  const WINDOW_SECONDS = 4;
  const TIGHT_THRESHOLD = 0.02;  // seconds — very tight alignment
  const LOOSE_THRESHOLD = 0.08;  // seconds — noticeable drift

  /**
   * Measure timing coherence between layers.
   * @returns {{ avgDrift: number, tightness: number, suggestion: string }}
   */
  function getDriftSignal() {
    const entries = (typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.getEntries === 'function')
      ? AbsoluteTimeWindow.getEntries(WINDOW_SECONDS)
      : [];

    if (entries.length < 6) {
      return { avgDrift: 0, tightness: 0.5, suggestion: 'maintain' };
    }

    // Group entries by layer
    /** @type {Object.<string, number[]>} */
    const layerOnsets = {};
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || typeof e.time !== 'number') continue;
      const layer = String(e.layer || 'default');
      if (!layerOnsets[layer]) layerOnsets[layer] = [];
      layerOnsets[layer].push(e.time);
    }

    const layerKeys = Object.keys(layerOnsets);
    if (layerKeys.length < 2) {
      return { avgDrift: 0, tightness: 0.5, suggestion: 'maintain' };
    }

    // Sort onsets per layer
    for (let k = 0; k < layerKeys.length; k++) {
      layerOnsets[layerKeys[k]].sort((a, b) => a - b);
    }

    // Measure average minimum distance between layers' nearest onsets
    let totalDrift = 0;
    let pairCount = 0;

    for (let a = 0; a < layerKeys.length; a++) {
      for (let b = a + 1; b < layerKeys.length; b++) {
        const onsA = layerOnsets[layerKeys[a]];
        const onsB = layerOnsets[layerKeys[b]];
        let bIdx = 0;
        for (let i = 0; i < onsA.length; i++) {
          // Find nearest onset in B
          while (bIdx < onsB.length - 1 && m.abs(onsB[bIdx + 1] - onsA[i]) < m.abs(onsB[bIdx] - onsA[i])) {
            bIdx++;
          }
          const drift = m.abs(onsA[i] - onsB[bIdx]);
          // Only count if within a reasonable range (not just different beats)
          if (drift < 0.25) {
            totalDrift += drift;
            pairCount++;
          }
        }
      }
    }

    const avgDrift = pairCount > 0 ? totalDrift / pairCount : 0;

    // Tightness: 1 = perfectly locked, 0 = very loose
    const tightness = clamp(1 - avgDrift / LOOSE_THRESHOLD, 0, 1);

    let suggestion = 'maintain';
    if (avgDrift < TIGHT_THRESHOLD) suggestion = 'very-tight';
    else if (avgDrift > LOOSE_THRESHOLD) suggestion = 'drifting';
    else suggestion = 'expressive';

    return { avgDrift, tightness, suggestion };
  }

  return {
    getDriftSignal
  };
})();
