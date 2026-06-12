// src/utils/priorsHelpers.js - Shared helpers for all priors modules.
// Deduplicates resolvePhase, resolveWeightOrDefault, weightedAdjustment.

priorsHelpers = (() => {
  /**
   * Resolve the current phrase phase from opts, phraseContext, or sharedPhraseArcManager.
   * Full version - checks opts.phase - opts.phraseContext.phase - FactoryManager fallback.
   * @param {Object} [opts]
   * @returns {string}
   */
  function resolvePhase(opts) {
    if (opts && typeof opts.phase === 'string' && opts.phase.length > 0) {
      return opts.phase;
    }

    if (opts && opts.phraseContext && typeof opts.phraseContext === 'object'
        && typeof opts.phraseContext.phase === 'string' && opts.phraseContext.phase.length > 0) {
      return opts.phraseContext.phase;
    }

    if (FactoryManager && FactoryManager.sharedPhraseArcManager
        && FactoryManager.sharedPhraseArcManager.getPhase) {
      const phase = FactoryManager.sharedPhraseArcManager.getPhase();
      if (typeof phase === 'string' && phase.length > 0) {
        return phase;
      }
    }

    return 'development';
  }

  /**
   * Look up a weight from a table, falling back when absent or non-positive.
   * @param {Object} table
   * @param {string} key
   * @param {number} [fallback=1]
   * @returns {number}
   */
  function resolveWeightOrDefault(table, key, fallback = 1) {
    const raw = table && Object.prototype.hasOwnProperty.call(table, key)
      ? Number(table[key])
      : Number(fallback);
    if (!Number.isFinite(raw) || raw <= 0) return Number(fallback);
    return raw;
  }

  /**
   * Convert a prior weight into a signed adjustment value.
   * weight > 1 - negative adjustment (favoured), weight < 1 - positive (penalised).
   * @param {number} weight
   * @param {number} scale
   * @returns {number}
   */
  function weightedAdjustment(weight, scale) {
    if (!Number.isFinite(Number(weight)) || !Number.isFinite(Number(scale))) return 0;
    const w = Number(weight);
    const s = Number(scale);
    if (w >= 1) return -(w - 1) * s;
    return (1 - w) * s;
  }

  return { resolvePhase, resolveWeightOrDefault, weightedAdjustment };
})();
