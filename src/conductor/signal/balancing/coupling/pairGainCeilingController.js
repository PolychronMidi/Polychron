// pairGainCeilingController.js - Hypermeta self-calibrating pair gain ceiling (#15).
// Replaces hardcoded per-pair gain ceiling chains with adaptive ceilings
// derived from rolling p95 EMA and exceedance history. Consumed by
// couplingEffectiveGain. Each pair self-calibrates its ceiling based on
// observed tail pressure, preventing whack-a-mole ceiling proliferation.

pairGainCeilingController = (() => {

  // R6 E2: Increased from 0.06 to 0.08 to accelerate EMA convergence for flicker-trust reconciliation
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
    'density-flicker': { baseCeiling: 0.10, minCeiling: 0.04, maxCeiling: 0.25, p95Sensitivity: 0.82, exceedanceSensitivity: 0.08 },
    'tension-flicker': { baseCeiling: 0.10, minCeiling: 0.05, maxCeiling: 0.35, p95Sensitivity: 0.83, exceedanceSensitivity: 0.06 },
    'flicker-trust':   { baseCeiling: 0.08, minCeiling: 0.04, maxCeiling: 0.30, p95Sensitivity: 0.82, exceedanceSensitivity: 0.08 },
    // R8 E2: density-tension ceiling -- dominant hotspot pair (p95 0.911, 22 exceedance beats)
    'density-tension': { baseCeiling: 0.12, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.85, exceedanceSensitivity: 0.08 },
    'density-trust':   { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.85, exceedanceSensitivity: 0.05 },
    'tension-trust':   { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.85, exceedanceSensitivity: 0.05 },
    // R5 E1: flicker-phase profile to contain balloon-effect displacement
    'flicker-phase':   { baseCeiling: 0.16, minCeiling: 0.06, maxCeiling: 0.45, p95Sensitivity: 0.80, exceedanceSensitivity: 0.06 },
    // R7 E5: flicker-entropy profile -- sole underseen pair (lagIndex 0.116, p95 0.841)
    'flicker-entropy': { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.82, exceedanceSensitivity: 0.06 },
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

    // E3: p95 EMA alpha scaled by hyperMetaOrchestrator to reduce reconciliation gap
    const p95AlphaMultiplier = safePreBoot.call(() => hyperMetaOrchestrator.getP95AlphaMultiplier(), 1.0) || 1.0;
    const effectiveP95Alpha = _P95_EMA_ALPHA * p95AlphaMultiplier;

    // EMA tracking
    ps.p95Ema += (p95 - ps.p95Ema) * effectiveP95Alpha;
    ps.exceedanceEma += (hotspotRate - ps.exceedanceEma) * _EXCEEDANCE_EMA_ALPHA;
    ps.severityEma += (severeRate - ps.severityEma) * _EXCEEDANCE_EMA_ALPHA;

    // Compute desired ceiling based on rolling state
    // When p95Ema exceeds sensitivity threshold, tighten ceiling
    // When p95Ema is well below threshold, relax ceiling
    const p95Excess = ps.p95Ema - profile.p95Sensitivity;
    const exceedanceExcess = ps.exceedanceEma - profile.exceedanceSensitivity;

    // E4: S0 tightening multiplier from hyperMetaOrchestrator for Section 0 exceedance reduction
    const s0Multiplier = safePreBoot.call(() => hyperMetaOrchestrator.getS0TighteningMultiplier(), 1.0) || 1.0;

    // E4 (R100): Phase-aware rate scaling from orchestrator system phase
    const globalMultiplier = safePreBoot.call(() => hyperMetaOrchestrator.getRateMultiplier('global'), 1.0) || 1.0;

    if (p95Excess > 0 || exceedanceExcess > 0) {
      // Tighten: pressure proportional to severity
      const tightenPressure = clamp(
        p95Excess * 2.0 + exceedanceExcess * 4.0 + ps.severityEma * 6.0,
        0, 1
      );
      const tightenAmount = _CEILING_ADAPT_RATE * tightenPressure * s0Multiplier * globalMultiplier;
      ps.ceiling = m.max(profile.minCeiling, ps.ceiling - tightenAmount);
    } else if (p95Excess < -0.05 && ps.exceedanceEma < profile.exceedanceSensitivity * 0.5) {
      // Relax: only when well below threshold AND exceedance is low
      const relaxPressure = clamp(m.abs(p95Excess) * 1.5, 0, 1);
      const relaxAmount = _CEILING_RELAX_RATE * relaxPressure * globalMultiplier;
      ps.ceiling = m.min(profile.maxCeiling, ps.ceiling + relaxAmount);
    }

    // E6: Report exceedance to orchestrator for axis-concentration tracking
    if (hotspotRate > 0) {
      safePreBoot.call(() => hyperMetaOrchestrator.recordExceedance(pair));
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
    if (!profile) return 1 / 0; // Infinity -- no ceiling
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
    // Start with the adaptive EMA-derived ceiling
    let ceiling = ps.ceiling;

    // Apply instant overrides when current-beat telemetry is extreme
    // This provides beat-level responsiveness on top of the EMA trend
    if (p95 > profile.p95Sensitivity + 0.06 && severeRate > profile.exceedanceSensitivity) {
      // Severe: tightest ceiling (replaces the 0.08 hardcoded cap)
      ceiling = m.min(ceiling, profile.minCeiling + (profile.baseCeiling - profile.minCeiling) * 0.25);
    } else if (p95 > profile.p95Sensitivity + 0.03) {
      // High p95: moderate ceiling (replaces the 0.10 hardcoded cap)
      ceiling = m.min(ceiling, profile.minCeiling + (profile.baseCeiling - profile.minCeiling) * 0.5);
    } else if (p95 > profile.p95Sensitivity && hotspotRate > profile.exceedanceSensitivity * 0.2) {
      // Elevated: mild ceiling (replaces the 0.15 hardcoded cap)
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

  // ===== SELF-REGISTRATION =====
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
