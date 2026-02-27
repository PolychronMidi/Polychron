// @ts-check

/**
 * Contextual Trust Learning (E11)
 *
 * Extends the trust system by keying trust scores on (module * regime)
 * pairs. Different dynamical regimes may warrant different trust weights
 * for the same cross-layer module. This module wraps adaptiveTrustScores
 * with contextual lookup and registers as a cross-layer module.
 *
 * API:
 *   contextualTrust.getWeight(moduleName) - number (regime-aware)
 *   contextualTrust.record(moduleName, payoff)
 *   contextualTrust.reset()
 */

contextualTrust = (() => {
  const V = validator.create('contextualTrust');

  const DECAY    = 0.9;
  const LO       = -1;
  const HI       = 1;
  const W_LO     = 0.4;
  const W_HI     = 1.8;
  const W_SCALE  = 0.75;

  /** @type {Map<string, number>} */
  let scores = new Map();

  function _key(moduleName) {
    const snap = systemDynamicsProfiler.getSnapshot();
    const regime = snap ? snap.regime : 'evolving';
    return `${moduleName}::${regime}`;
  }

  /**
   * Record an outcome for a module in the current regime context.
   */
  function record(moduleName, payoff) {
    V.assertNonEmptyString(moduleName, 'moduleName');
    const p = V.requireFinite(payoff, 'payoff');
    const k = _key(moduleName);
    const prev = scores.get(k) || 0;
    const next = Math.max(LO, Math.min(HI, prev * DECAY + p * (1 - DECAY)));
    scores.set(k, next);
  }

  /**
   * Get trust weight for a module in the current regime.
   * Falls back to global adaptiveTrustScores if no contextual data.
   */
  function getWeight(moduleName) {
    const k = _key(moduleName);
    if (scores.has(k)) {
      const s = /** @type {number} */ (scores.get(k));
      return Math.max(W_LO, Math.min(W_HI, 1 + s * W_SCALE));
    }
    // Fallback to global trust
    return adaptiveTrustScores.getWeight(moduleName);
  }

  function getScoreCount() { return scores.size; }

  function reset() {
    scores = new Map();
  }

  const mod = { record, getWeight, getScoreCount, reset };

  crossLayerRegistry.register('contextualTrust', mod, ['all']);

  return mod;
})();
