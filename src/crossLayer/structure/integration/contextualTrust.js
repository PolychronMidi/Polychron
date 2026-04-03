

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

  function contextualTrustKey(moduleName) {
    const regime = conductorSignalBridge.getSignals().regime || 'evolving';
    return `${moduleName}::${regime}`;
  }

  /**
   * Record an outcome for a module in the current regime context.
   */
  function record(moduleName, payoff) {
    V.assertNonEmptyString(moduleName, 'moduleName');
    const p = V.requireFinite(payoff, 'payoff');
    const k = contextualTrustKey(moduleName);
    const prev = V.optionalFinite(scores.get(k), 0);
    const next = m.max(LO, m.min(HI, prev * DECAY + p * (1 - DECAY)));
    scores.set(k, next);
  }

  function getScore(moduleName) {
    V.assertNonEmptyString(moduleName, 'moduleName');
    const k = contextualTrustKey(moduleName);
    return scores.has(k) ? /** @type {number} */ (scores.get(k)) : null;
  }

  function getContextualWeight(moduleName) {
    const contextualScore = getScore(moduleName);
    if (contextualScore === null) return null;
    return m.max(W_LO, m.min(W_HI, 1 + contextualScore * W_SCALE));
  }

  /**
   * Get trust weight for a module in the current regime.
   * Falls back to global adaptiveTrustScores if no contextual data.
   */
  function getWeight(moduleName) {
    const contextualWeight = getContextualWeight(moduleName);
    if (contextualWeight !== null) return contextualWeight;
    return typeof adaptiveTrustScores.getBaseWeight === 'function'
      ? adaptiveTrustScores.getBaseWeight(moduleName)
      : adaptiveTrustScores.getWeight(moduleName);
  }

  function getScoreCount() { return scores.size; }

  function reset() {
    scores = new Map();
  }

  const mod = { record, getScore, getContextualWeight, getWeight, getScoreCount, reset };

  crossLayerRegistry.register('contextualTrust', mod, ['all']);

  return mod;
})();
