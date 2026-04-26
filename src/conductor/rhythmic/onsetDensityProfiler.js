// src/conductor/onsetDensityProfiler.js - Ground-truth onset density metric via ATW.
// Note-onset count per second across both layers, independent of eventBus feedback.
// Directly scales conductor densityBias and crossModBias.

moduleLifecycle.declare({
  name: 'onsetDensityProfiler',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'validator'],
  lazyDeps: ['analysisHelpers'],
  provides: ['onsetDensityProfiler'],
  init: (deps) => {
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('onsetDensityProfiler');
  const query = analysisHelpers.createTrackerQuery(V, 3, { minNotes: 2 });
  const TARGET_NPS = 15; // target notes-per-second for "balanced" density

  // Beat-level cache: getDensity() with default opts is called 2-3x per beat
  // (getDensityBias + getCrossModBias via stateProvider)
  const onsetDensityProfilerDefaultDensityCache = beatCache.create(() => onsetDensityProfilerGetDensity());

  /**
   * Get precise onset density (notes per second) from ATW.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ nps: number, trend: string }}
   */
  function getDensity(opts) {
    if (opts === undefined) return onsetDensityProfilerDefaultDensityCache.get();
    return onsetDensityProfilerGetDensity(opts);
  }

  /** @private */
  function onsetDensityProfilerGetDensity(opts = {}) {
    const notes = query(opts);
    if (!notes) return { nps: 0, trend: 'sparse' };

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
   * Continuous interpolation prevents multiplicative crush with peer density biases.
   * @returns {number} - 0.80 to 1.35
   */
  function getDensityBias() {
    const d = getDensity();
    if (d.nps === 0) return 1.0;
    const ratio = d.nps / TARGET_NPS;
    // Continuous ramp: ratio 0.5-1.0 - bias 1.35-1.0, ratio 1.0-3.0 - bias 1.0-0.80
    if (ratio <= 1.0) {
      const ramp = clamp((1.0 - ratio) / 0.5, 0, 1);
      return 1.0 + ramp * 0.35;
    }
    // Density-aware attenuation: when conductor density product is low,
    // reduce onset suppression strength to avoid compounding the deficit.
    // At density 0.85+ - full suppression; at density 0.40 - half suppression.
    // Threshold raised (was 0.70) - at density 0.693 barely helped.
    // Uses currentDensity global (previous beat's EMA value) instead of
    // signalReader.density() - the latter re-enters collectDensityBias,
    // causing infinite recursion since this getter is called from that pipeline.
    const conductorDensity = currentDensity;
    const attenuate = conductorDensity < 0.85
      ? clamp((conductorDensity - 0.40) / 0.45, 0.5, 1.0)
      : 1.0;
    const ramp = clamp((ratio - 1.0) / 2.0, 0, 1);
    return 1.0 - ramp * 0.14 * attenuate;
  }

  /**
   * Get a crossMod bias based on onset density trends.
   * Accelerating - dampen crossMod; decelerating - boost it.
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

  conductorIntelligence.registerDensityBias('onsetDensityProfiler', () => onsetDensityProfiler.getDensityBias(), 0.86, 1.35);
  conductorIntelligence.registerStateProvider('onsetDensityProfiler', () => ({
    onsetCrossModBias: clamp(onsetDensityProfiler.getCrossModBias(), 0.8, 1.2)
  }));

  function reset() {}
  conductorIntelligence.registerModule('onsetDensityProfiler', { reset }, ['section']);

  return {
    getDensity,
    getDensityBias,
    getCrossModBias,
    getLayerDensities
  };
  },
});
