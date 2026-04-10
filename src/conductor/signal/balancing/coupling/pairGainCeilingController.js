// pairGainCeilingController.js - Hypermeta self-calibrating pair gain ceiling (#15).
// Replaces hardcoded per-pair gain ceiling chains with adaptive ceilings
// derived from rolling p95 EMA and exceedance history. Consumed by
// couplingEffectiveGain. Each pair self-calibrates its ceiling based on
// observed tail pressure, preventing whack-a-mole ceiling proliferation.

pairGainCeilingController = (() => {

  const _P95_EMA_ALPHA = 0.08;
  const _EXCEEDANCE_EMA_ALPHA = 0.04;
  const _CEILING_ADAPT_RATE = 0.008;
  const _CEILING_RELAX_RATE = 0.003;

  // Per-pair adaptive state
  /** @type {Record<string, { p95Ema: number, exceedanceEma: number, ceiling: number, activeBeats: number, severityEma: number }>} */
  const pairGainCeilingControllerPairState = {};

  // Configurable per-pair sensitivity profiles derived from the evolution history.
  // Pairs that historically needed tighter ceilings get lower base ceilings.
  // The ceiling adapts around this anchor, never straying too far.
  const _PAIR_PROFILES = {
    'density-flicker': { baseCeiling: 0.10, minCeiling: 0.04, maxCeiling: 0.25, p95Sensitivity: 0.82, exceedanceSensitivity: 0.04 },
    'tension-flicker': { baseCeiling: 0.10, minCeiling: 0.05, maxCeiling: 0.35, p95Sensitivity: 0.77, exceedanceSensitivity: 0.03 },
    'flicker-trust':   { baseCeiling: 0.08, minCeiling: 0.04, maxCeiling: 0.30, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
    'density-tension': { baseCeiling: 0.12, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.80, exceedanceSensitivity: 0.04 },
    'density-trust':   { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.85, exceedanceSensitivity: 0.05 },
    'tension-trust':   { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.85, exceedanceSensitivity: 0.05 },
    'flicker-phase':   { baseCeiling: 0.16, minCeiling: 0.06, maxCeiling: 0.45, p95Sensitivity: 0.73, exceedanceSensitivity: 0.06 },
    'flicker-entropy': { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.76, exceedanceSensitivity: 0.06 },
    'entropy-trust':   { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.75, exceedanceSensitivity: 0.05 },
    'entropy-phase':   { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.74, exceedanceSensitivity: 0.05 },
    'tension-entropy': { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
    'tension-phase':   { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
    'density-entropy': { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
    'density-phase':   { baseCeiling: 0.16, minCeiling: 0.06, maxCeiling: 0.45, p95Sensitivity: 0.76, exceedanceSensitivity: 0.06 },
  };

  function getPairState(pair) {
    if (!pairGainCeilingControllerPairState[pair]) {
      const profile = _PAIR_PROFILES[pair];
      pairGainCeilingControllerPairState[pair] = {
        p95Ema: 0.5,
        exceedanceEma: 0,
        ceiling: profile ? profile.baseCeiling : 1.2,
        activeBeats: 0,
        severityEma: 0
      };
    }
    return pairGainCeilingControllerPairState[pair];
  }

  /**
   * Update a pair's adaptive ceiling based on current telemetry.
   * Called from the coupling manager per-pair loop.
   * @param {string} pair - pair key like 'density-flicker'
   * @param {number} p95 - current tail p95
   * @param {number} hotspotRate - current hotspot exceedance rate
   * @param {number} severeRate - current severe exceedance rate
   */
  function updatePair(pair, p95, hotspotRate, severeRate) {
    const profile = _PAIR_PROFILES[pair];
    if (!profile) return; // only manage pairs with profiles

    const ps = getPairState(pair);
    ps.activeBeats++;

    // p95 EMA alpha scaled by hyperMetaManager to reduce reconciliation gap
    const p95AlphaMultiplier = /** @type {number} */ (hyperMetaManager.getP95AlphaMultiplier());
    const effectiveP95Alpha = _P95_EMA_ALPHA * p95AlphaMultiplier;

    // EMA tracking
    ps.p95Ema += (p95 - ps.p95Ema) * effectiveP95Alpha;
    ps.exceedanceEma += (hotspotRate - ps.exceedanceEma) * _EXCEEDANCE_EMA_ALPHA;
    ps.severityEma += (severeRate - ps.severityEma) * _EXCEEDANCE_EMA_ALPHA;

    const p95Excess = ps.p95Ema - profile.p95Sensitivity;
    const exceedanceExcess = ps.exceedanceEma - profile.exceedanceSensitivity;

    const s0Multiplier = /** @type {number} */ (hyperMetaManager.getS0TighteningMultiplier());

    const globalMultiplier = /** @type {number} */ (hyperMetaManager.getRateMultiplier('global'));

    const topologyCreativity = /** @type {number} */ (hyperMetaManager.getTopologyCreativityMultiplier());

    if (p95Excess > 0 || exceedanceExcess > 0) {
      const exceedanceAccelerator = 1.0 + clamp(ps.exceedanceEma / m.max(0.01, profile.exceedanceSensitivity), 0, 3) * 0.5;
      const tightenPressure = clamp(
        p95Excess * 2.0 + exceedanceExcess * 4.0 + ps.severityEma * 6.0,
        0, 1
      );
      const topologyTightenScale = topologyCreativity > 0.5 ? 1.0 / topologyCreativity : 1.0;
      const tightenAmount = _CEILING_ADAPT_RATE * tightenPressure * exceedanceAccelerator * s0Multiplier * globalMultiplier * topologyTightenScale;
      ps.ceiling = m.max(profile.minCeiling, ps.ceiling - tightenAmount);
    } else if (p95Excess < -0.05 && ps.exceedanceEma < profile.exceedanceSensitivity * 0.5) {
      const relaxPressure = clamp(m.abs(p95Excess) * 1.5, 0, 1);
      const relaxAmount = _CEILING_RELAX_RATE * relaxPressure * globalMultiplier * topologyCreativity;
      ps.ceiling = m.min(profile.maxCeiling, ps.ceiling + relaxAmount);
    }

    // Dimensionality expander ceiling floor: during locked topology with
    // collapsing dimensionality, the orchestrator emits a minimum ceiling
    // to preserve nudge capacity for the expander's perturbations.
    const dimFloor = /** @type {number} */ (hyperMetaManager.getRateMultiplier('dimExpanderCeilingFloor'));
    if (dimFloor > 0 && ps.ceiling < dimFloor) {
      ps.ceiling = dimFloor;
    }

    // E1: Hotspot monopoly relief
    const monopolyRelief = /** @type {number} */ (hyperMetaManager.getRateMultiplier('hotspotMonopolyRelief_' + pair));
    if (monopolyRelief > 1.0 && ps.ceiling < profile.baseCeiling) {
      const reliefLift = _CEILING_RELAX_RATE * (monopolyRelief - 1.0) * 5.0;
      ps.ceiling = m.min(profile.baseCeiling, ps.ceiling + reliefLift);
    }

    // E6: Coherent regime tightening
    const coherentTightening = /** @type {number} */ (hyperMetaManager.getRateMultiplier('e6CoherentTightening'));
    if (coherentTightening < 1.0) {
      const tightenAmount = _CEILING_ADAPT_RATE * (1.0 - coherentTightening) * 2.0;
      ps.ceiling = m.max(profile.minCeiling, ps.ceiling - tightenAmount);
    }

    if (pair.indexOf('phase') !== -1 || pair === 'flicker-trust') {
      const ceilingRelaxSignal = /** @type {number} */ (hyperMetaManager.getRateMultiplier('phasePairCeilingRelax'));
      if (ceilingRelaxSignal > 1.0 && ps.ceiling < profile.baseCeiling) {
        const relaxLift = _CEILING_RELAX_RATE * (ceilingRelaxSignal - 1.0) * 3.0;
        ps.ceiling = m.min(profile.baseCeiling, ps.ceiling + relaxLift);
      }
    }


    if (hotspotRate > 0) {
      safePreBoot.call(() => hyperMetaManager.recordExceedance(pair));
    }
  }

  /**
   * Get the current adaptive ceiling for a pair.
   * Returns Infinity for pairs without profiles (no ceiling applied).
   * @param {string} pair
   * @returns {number}
   */
  function getCeiling(pair) {
    const profile = _PAIR_PROFILES[pair];
    if (!profile) return 1 / 0;
    const ps = getPairState(pair);
    return ps.ceiling;
  }

  /**
   * Get additional severity-adjusted ceiling for density-flicker.
   * When severeRate is high, apply a tighter override ceiling.
   * This replaces the multi-branch if/else chain in couplingEffectiveGain.
   * @param {string} pair
   * @param {number} p95 - current beat's raw p95
   * @param {number} severeRate - current severe rate
   * @param {number} hotspotRate - current hotspot rate
   * @returns {number} effective ceiling for this beat
   */
  function getInstantCeiling(pair, p95, severeRate, hotspotRate) {
    const profile = _PAIR_PROFILES[pair];
    if (!profile) return 1 / 0;

    const ps = getPairState(pair);
    let ceiling = ps.ceiling;

    if (p95 > profile.p95Sensitivity + 0.06 && severeRate > profile.exceedanceSensitivity) {
      ceiling = m.min(ceiling, profile.minCeiling + (profile.baseCeiling - profile.minCeiling) * 0.25);
    } else if (p95 > profile.p95Sensitivity + 0.03) {
      ceiling = m.min(ceiling, profile.minCeiling + (profile.baseCeiling - profile.minCeiling) * 0.5);
    } else if (p95 > profile.p95Sensitivity && hotspotRate > profile.exceedanceSensitivity * 0.2) {
      ceiling = m.min(ceiling, profile.baseCeiling);
    }

    return ceiling;
  }

  function tick() {
    // Per-beat updates are driven by updatePair() calls from the coupling loop.
    // This tick function is for any independent monitoring.
  }

  function getSnapshot() {
    const snapshot = {};
    const pairs = Object.keys(pairGainCeilingControllerPairState);
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const ps = pairGainCeilingControllerPairState[pair];
      snapshot[pair] = {
        p95Ema: ps.p95Ema,
        exceedanceEma: ps.exceedanceEma,
        severityEma: ps.severityEma,
        ceiling: ps.ceiling,
        activeBeats: ps.activeBeats
      };
    }
    return snapshot;
  }

  function reset() {
    // Preserve EMAs across sections (learning persists)
    // Reset activeBeats counter
    const pairs = Object.keys(pairGainCeilingControllerPairState);
    for (let i = 0; i < pairs.length; i++) {
      pairGainCeilingControllerPairState[pairs[i]].activeBeats = 0;
    }
  }

  // SELF-REGISTRATION
  conductorIntelligence.registerRecorder('pairGainCeilingController', tick);
  conductorIntelligence.registerStateProvider('pairGainCeilingController', () => ({
    pairGainCeilingController: getSnapshot()
  }));
  conductorIntelligence.registerModule('pairGainCeilingController', { reset }, ['section']);

  return {
    updatePair,
    getCeiling,
    getInstantCeiling,
    getSnapshot,
    reset
  };
})();
