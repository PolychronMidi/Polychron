// src/conductor/onsetRegularityMonitor.js - Inter-onset-interval (IOI) regularity analysis.
// Detects metronomic uniformity vs. rhythmic chaos in onset timing.
// Pure query API - biases toward variety when IOI is too uniform, stabilizes when chaotic.

moduleLifecycle.declare({
  name: 'onsetRegularityMonitor',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'validator'],
  provides: ['onsetRegularityMonitor'],
  init: (deps) => {
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('onsetRegularityMonitor');
  const query = analysisHelpers.createTrackerQuery(V, 4, { minNotes: 4 });

  /**
   * Compute IOI regularity from recent onsets.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgIOI: number, ioiCV: number, regularity: number, uniform: boolean, chaotic: boolean }}
   */
  function getRegularityProfile(opts = {}) {
    const notes = query(opts);
    if (!notes) return { avgIOI: 0, ioiCV: 0, regularity: 0.5, uniform: false, chaotic: false };

    const iois = beatGridHelpers.getRecentIOIs(notes);

    if (iois.length < 2) {
      return { avgIOI: 0, ioiCV: 0, regularity: 0.5, uniform: false, chaotic: false };
    }

    // Mean IOI
    let sum = 0;
    for (let i = 0; i < iois.length; i++) sum += iois[i];
    const avgIOI = sum / iois.length;

    // Standard deviation
    let sqDiffSum = 0;
    for (let i = 0; i < iois.length; i++) {
      const diff = iois[i] - avgIOI;
      sqDiffSum += diff * diff;
    }
    const stddev = m.sqrt(sqDiffSum / iois.length);

    // Coefficient of variation (0 = perfectly regular, higher = more variable)
    const ioiCV = avgIOI > 0 ? stddev / avgIOI : 0;

    // Regularity score (1 = metronomic, 0 = chaotic)
    const regularity = clamp(1 - ioiCV, 0, 1);

    return {
      avgIOI,
      ioiCV,
      regularity,
      uniform: regularity > 0.85,
      chaotic: regularity < 0.35
    };
  }

  /**
   * Get a rhythm variety bias.
   * Continuous ramp: chaotic (regularity 0) - 0.92; uniform (regularity 1) - 1.2.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.92 to 1.20
   */
  function getRhythmVarietyBias(opts) {
    const profile = getRegularityProfile(opts);
    // Linear ramp: regularity 0-1 maps to 0.92-1.20 (was 0.88-1.20 - chronic floor pin)
    return 0.92 + profile.regularity * 0.28;
  }

  conductorIntelligence.registerDensityBias('onsetRegularityMonitor', () => onsetRegularityMonitor.getRhythmVarietyBias(), 0.90, 1.25);

  function reset() {}
  conductorIntelligence.registerModule('onsetRegularityMonitor', { reset }, ['section']);

  return {
    getRegularityProfile,
    getRhythmVarietyBias
  };
  },
});
