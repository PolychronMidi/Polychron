// src/conductor/OnsetDensityProfiler.js - Ground-truth onset density metric via ATW.
// Note-onset count per second across both layers, independent of EventBus feedback.
// Directly scales conductor densityBias and crossModBias.

OnsetDensityProfiler = (() => {
  const V = Validator.create('OnsetDensityProfiler');
  const WINDOW_SECONDS = 3;
  const TARGET_NPS = 6; // target notes-per-second for "balanced" density

  /**
   * Get precise onset density (notes per second) from ATW.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ nps: number, trend: string }}
   */
  function getDensity(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 2) return { nps: 0, trend: 'sparse' };

    const first = notes[0];
    const last = notes[notes.length - 1];
    if (!first || !last) return { nps: 0, trend: 'sparse' };

    const span = last.time - first.time;
    if (span <= 0) return { nps: 0, trend: 'sparse' };

    const nps = notes.length / span;

    // Determine trend relative to midpoint comparison
    let trend = 'steady';
    const midIdx = m.floor(notes.length / 2);
    const midNote = notes[midIdx];
    if (midNote) {
      const midTime = midNote.time;
      const firstHalfSpan = midTime - first.time;
      const secondHalfSpan = last.time - midTime;
      if (firstHalfSpan > 0 && secondHalfSpan > 0) {
        const firstHalfNps = midIdx / firstHalfSpan;
        const secondHalfNps = (notes.length - midIdx) / secondHalfSpan;
        if (secondHalfNps > firstHalfNps * 1.3) trend = 'accelerating';
        else if (secondHalfNps < firstHalfNps * 0.7) trend = 'decelerating';
      }
    }

    return { nps, trend };
  }

  /**
   * Get a density bias for the conductor.
   * >1 when density is below target (encourage more notes);
   * <1 when above target (thin out).
   * @returns {number} - 0.6 to 1.4
   */
  function getDensityBias() {
    const d = getDensity();
    if (d.nps === 0) return 1.0;
    const ratio = d.nps / TARGET_NPS;
    if (ratio > 1.5) return 0.7;
    if (ratio > 1.2) return 0.85;
    if (ratio < 0.5) return 1.35;
    if (ratio < 0.8) return 1.15;
    return 1.0;
  }

  /**
   * Get a crossMod bias based on onset density trends.
   * Accelerating → dampen crossMod; decelerating → boost it.
   * @returns {number} - 0.8 to 1.2
   */
  function getCrossModBias() {
    const d = getDensity();
    if (d.trend === 'accelerating') return 0.85;
    if (d.trend === 'decelerating') return 1.15;
    return 1.0;
  }

  /**
   * Get combined density for both layers.
   * @returns {{ combined: number, l1: number, l2: number }}
   */
  function getLayerDensities() {
    const l1 = getDensity({ layer: 'L1' });
    const l2 = getDensity({ layer: 'L2' });
    const all = getDensity();
    return { combined: all.nps, l1: l1.nps, l2: l2.nps };
  }

  ConductorIntelligence.registerDensityBias('OnsetDensityProfiler', () => OnsetDensityProfiler.getDensityBias(), 0.6, 1.4);
  ConductorIntelligence.registerStateProvider('OnsetDensityProfiler', () => ({
    onsetCrossModBias: clamp(OnsetDensityProfiler.getCrossModBias(), 0.8, 1.2)
  }));

  return {
    getDensity,
    getDensityBias,
    getCrossModBias,
    getLayerDensities
  };
})();
