// src/conductor/PolyrhythmicAlignmentTracker.js - Phase alignment of polyrhythmic layers.
// Detects convergence/divergence points where polyrhythmic cycles align or scatter.
// Flicker modifier widens at alignment points for dramatic emphasis.
// Pure query API — no side effects.

PolyrhythmicAlignmentTracker = (() => {
  const WINDOW_SECONDS = 4;
  const ALIGNMENT_THRESHOLD = 0.08; // seconds tolerance for "aligned" onsets

  /**
   * Analyze layer alignment from recent entries.
   * @returns {{ alignmentScore: number, convergencePoint: boolean, flickerMod: number }}
   */
  function getAlignmentSignal() {
    const entries = (typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.getEntries === 'function')
      ? AbsoluteTimeWindow.getEntries(WINDOW_SECONDS)
      : [];

    if (entries.length < 6) {
      return { alignmentScore: 0, convergencePoint: false, flickerMod: 1 };
    }

    // Group onsets by layer
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
      return { alignmentScore: 0, convergencePoint: false, flickerMod: 1 };
    }

    // Sort each layer's onsets
    for (let k = 0; k < layerKeys.length; k++) {
      layerOnsets[layerKeys[k]].sort((a, b) => a - b);
    }

    // Count cross-layer near-coincidences
    let alignments = 0;
    let comparisons = 0;

    for (let a = 0; a < layerKeys.length; a++) {
      for (let b = a + 1; b < layerKeys.length; b++) {
        const onsetsA = layerOnsets[layerKeys[a]];
        const onsetsB = layerOnsets[layerKeys[b]];
        let bIdx = 0;
        for (let i = 0; i < onsetsA.length; i++) {
          while (bIdx < onsetsB.length - 1 && onsetsB[bIdx + 1] <= onsetsA[i]) bIdx++;
          // Check closest onset in B
          for (let j = m.max(0, bIdx - 1); j < m.min(onsetsB.length, bIdx + 2); j++) {
            if (m.abs(onsetsA[i] - onsetsB[j]) < ALIGNMENT_THRESHOLD) {
              alignments++;
              break;
            }
          }
          comparisons++;
        }
      }
    }

    const alignmentScore = comparisons > 0 ? alignments / comparisons : 0;

    // Detect a convergence point: recent spike in alignment
    // If >60% of recent cross-layer onsets align, it's a convergence moment
    const convergencePoint = alignmentScore > 0.6;

    // Flicker modifier: convergence points → widen flicker for dramatic emphasis
    let flickerMod = 1;
    if (convergencePoint) {
      flickerMod = 1.15; // aligned layers → amplify texture shimmer
    } else if (alignmentScore < 0.15) {
      flickerMod = 0.95; // highly divergent → tighten for stability
    }

    return { alignmentScore, convergencePoint, flickerMod };
  }

  /**
   * Get flicker modifier for the flickerAmplitude chain.
   * @returns {number}
   */
  function getFlickerModifier() {
    return getAlignmentSignal().flickerMod;
  }

  return {
    getAlignmentSignal,
    getFlickerModifier
  };
})();
