// src/conductor/crossLayerDensityBalancer.js - Per-layer onset density balancer.
// Compares onset density across polyrhythmic layers and detects when one
// layer dominates. Density bias to rebalance activity across layers.
// Pure query API - no side effects.

crossLayerDensityBalancer = (() => {
  const WINDOW_SECONDS = 6;

  /** @private */
  function crossLayerDensityBalancerComputeBalanceSignal() {
    const entries = L0.query('note', { windowSeconds: WINDOW_SECONDS });

    if (entries.length < 6) {
      return { imbalance: 0, dominantLayer: 'none', densityBias: 1 };
    }

    // Count onsets per layer
    /** @type {Object.<string, number>} */
    const layerCounts = {};

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      const layer = String(e.layer || 'default');
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    }

    const layerKeys = Object.keys(layerCounts);
    if (layerKeys.length < 2) {
      return { imbalance: 0, dominantLayer: layerKeys[0] || 'none', densityBias: 1 };
    }

    // Find max and min layer densities
    let maxCount = 0;
    let minCount = Infinity;
    let dominantLayer = 'none';

    for (let i = 0; i < layerKeys.length; i++) {
      const count = layerCounts[layerKeys[i]];
      if (count > maxCount) {
        maxCount = count;
        dominantLayer = layerKeys[i];
      }
      if (count < minCount) minCount = count;
    }

    // Imbalance: 0 = perfectly balanced, 1 = one layer has all activity
    const imbalance = maxCount > 0 ? clamp(1 - minCount / maxCount, 0, 1) : 0;

    // Density bias: high imbalance - slight reduction to allow under-represented
    // layers to contribute; balanced - normal density
    let densityBias = 1;
    if (imbalance > 0.6) {
      densityBias = 0.94; // heavily imbalanced - thin dominant layer
    } else if (imbalance > 0.4) {
      densityBias = 0.97;
    }

    return { imbalance, dominantLayer, densityBias };
  }

  const crossLayerDensityBalancerCache = beatCache.create(crossLayerDensityBalancerComputeBalanceSignal);

  /**
   * Compare density across layers.
   * @returns {{ imbalance: number, dominantLayer: string, densityBias: number }}
   */
  function getBalanceSignal() { return crossLayerDensityBalancerCache.get(); }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getBalanceSignal().densityBias;
  }

  conductorIntelligence.registerDensityBias('crossLayerDensityBalancer', () => crossLayerDensityBalancer.getDensityBias(), 0.9, 1.05);
  conductorIntelligence.registerStateProvider('crossLayerDensityBalancer', () => {
    const s = crossLayerDensityBalancer.getBalanceSignal();
    return { crossLayerImbalance: s ? s.imbalance : 0 };
  });

  return {
    getBalanceSignal,
    getDensityBias
  };
})();
