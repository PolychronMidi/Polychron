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
    // R76 E3: exceedanceSensitivity 0.08->0.04. DF p95=0.938 with 5.85%
    // exceedance rate never triggered at 0.08. At 0.04, ceiling engages.
    'density-flicker': { baseCeiling: 0.10, minCeiling: 0.04, maxCeiling: 0.25, p95Sensitivity: 0.82, exceedanceSensitivity: 0.04 },
    // R75 E2: exceedanceSensitivity 0.06->0.03. At 0.06, the observed
    // exceedance rate of 0.039 (27 beats) never triggered ceiling tightening.
    // R80 E1: p95Sensitivity 0.83->0.77. TF surged to 31 exceedance beats in
    // R79 (69% of total). Classic balloon from FT containment (E1 R79). At
    // 0.83, ceiling engaged late. At 0.77, ceiling engages earlier to contain
    // the displaced energy before it becomes structural.
    'tension-flicker': { baseCeiling: 0.10, minCeiling: 0.05, maxCeiling: 0.35, p95Sensitivity: 0.77, exceedanceSensitivity: 0.03 },
    // R77 E3: exceedanceSensitivity 0.08->0.05. FT is dominant tail pair
    // (pressure 0.6113) with highest sensitivity among profiled pairs.
    // At 0.08, ceiling never engages. Aligns with DF 0.04, TF 0.03, DT 0.04.
    // R79 E1: p95Sensitivity 0.82->0.76. FT is the sole remaining trending
    // pair (r=0.427 increasing in R78) after 5 other pairs de-trended.
    // Classic balloon displacement. At 0.82, ceiling never engaged because
    // FT p95 sits below the threshold. At 0.76, ceiling engages at current
    // levels to contain the displaced coupling energy.
    'flicker-trust':   { baseCeiling: 0.08, minCeiling: 0.04, maxCeiling: 0.30, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
    // R8 E2: density-tension ceiling -- dominant hotspot pair (p95 0.911, 22 exceedance beats)
    // R75 E2: exceedanceSensitivity 0.08->0.04. At 0.08, the 0.045 rate (23 beats) never triggered.
    // R78 E2: p95Sensitivity 0.85->0.80. DT had 55 exceedance beats in R77 with
    // p95=0.906. At 0.85, ceiling engages late in the trajectory. At 0.80,
    // tightening begins earlier to contain DT's structural anti-correlation.
    'density-tension': { baseCeiling: 0.12, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.80, exceedanceSensitivity: 0.04 },
    'density-trust':   { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.85, exceedanceSensitivity: 0.05 },
    'tension-trust':   { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.85, exceedanceSensitivity: 0.05 },
    // R5 E1: flicker-phase profile to contain balloon-effect displacement
    // R77 E3: p95Sensitivity 0.80->0.73. FP correlation r=0.418 increasing,
    // p95=0.734. At 0.80, ceiling never tightened. At 0.73, ceiling engages
    // at current p95 levels to contain correlation drift.
    'flicker-phase':   { baseCeiling: 0.16, minCeiling: 0.06, maxCeiling: 0.45, p95Sensitivity: 0.73, exceedanceSensitivity: 0.06 },
    // R7 E5: flicker-entropy profile -- sole underseen pair (lagIndex 0.116, p95 0.841)
    // R78 E3: p95Sensitivity 0.82->0.76. FE p95=0.765 with r=0.321 increasing
    // in R77. At 0.82, ceiling never engaged. At 0.76, ceiling tightens at
    // current p95 level to contain growing correlation.
    'flicker-entropy': { baseCeiling: 0.14, minCeiling: 0.06, maxCeiling: 0.40, p95Sensitivity: 0.76, exceedanceSensitivity: 0.06 },
    // R77 E2: entropy-trust -- non-nudgeable dominant tail pair (p95 0.763,
    // r=-0.387 decreasing). Extends self-calibrating ceiling to the pair
    // driving nonNudgeableTailPressure (0.452). Wider bounds since non-nudgeable
    // pairs have fewer intervention levers.
    'entropy-trust':   { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.75, exceedanceSensitivity: 0.05 },
    // R77 E2: entropy-phase -- newly trending pair (p95 0.752, r=0.344
    // increasing). Ceiling engages at current p95 level to contain drift
    // before it becomes structural.
    'entropy-phase':   { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.74, exceedanceSensitivity: 0.05 },
    // R80 E2: tension-entropy -- new anti-correlation r=-0.427 decreasing in
    // R79. 1 exceedance beat already. Extends ceiling coverage to contain the
    // correlation before it entrenches. Wider bounds (like entropy-trust) since
    // this is a newly emerging pair with limited history.
    'tension-entropy': { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
    // R80 E2: tension-phase -- new correlation r=0.470 increasing in R79.
    // Pre-emptive ceiling profile. No exceedance yet but the correlation is
    // the strongest new trend. Ceiling establishes infrastructure before the
    // pair reaches tail territory.
    'tension-phase':   { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
    // R80 E4: density-entropy -- new correlation r=0.320 increasing in R79.
    // Pre-emptive ceiling coverage. Entropy axis surged to 23.5% share,
    // highest among all axes. Ceiling establishes control infrastructure
    // before the DE correlation reaches structural levels.
    'density-entropy': { baseCeiling: 0.18, minCeiling: 0.08, maxCeiling: 0.50, p95Sensitivity: 0.76, exceedanceSensitivity: 0.05 },
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

    // R81 E1: Topology creativity multiplier from orchestrator. During
    // "emergence" (exploring + resonant topology), ceilings tighten slower
    // to allow self-coherent coupling patterns to express. During "locked"
    // (coherent + crystallized), ceilings tighten faster to break stasis.
    const topologyCreativity = safePreBoot.call(() => hyperMetaOrchestrator.getTopologyCreativityMultiplier(), 1.0) || 1.0;

    if (p95Excess > 0 || exceedanceExcess > 0) {
      // Tighten: pressure proportional to severity
      // R63 E6: Non-linear tighten rate -- when exceedance EMA is high, the
      // ceiling adapts quadratically faster. Addresses concentrated bursts
      // (e.g., 108 tension-flicker exceedance beats in a single section)
      // where the linear 0.008 rate could not keep up.
      const exceedanceAccelerator = 1.0 + clamp(ps.exceedanceEma / m.max(0.01, profile.exceedanceSensitivity), 0, 3) * 0.5;
      const tightenPressure = clamp(
        p95Excess * 2.0 + exceedanceExcess * 4.0 + ps.severityEma * 6.0,
        0, 1
      );
      // R81 E1: topologyCreativity inverted for tighten: emergence (>1.0) slows
      // tightening (divide), locked (<1.0) accelerates tightening (divide by <1).
      const topologyTightenScale = topologyCreativity > 0.5 ? 1.0 / topologyCreativity : 1.0;
      const tightenAmount = _CEILING_ADAPT_RATE * tightenPressure * exceedanceAccelerator * s0Multiplier * globalMultiplier * topologyTightenScale;
      ps.ceiling = m.max(profile.minCeiling, ps.ceiling - tightenAmount);
    } else if (p95Excess < -0.05 && ps.exceedanceEma < profile.exceedanceSensitivity * 0.5) {
      // Relax: only when well below threshold AND exceedance is low
      const relaxPressure = clamp(m.abs(p95Excess) * 1.5, 0, 1);
      // R81 E1: topologyCreativity applied directly to relax: emergence (>1.0)
      // relaxes ceilings faster, locked (<1.0) relaxes slower.
      const relaxAmount = _CEILING_RELAX_RATE * relaxPressure * globalMultiplier * topologyCreativity;
      ps.ceiling = m.min(profile.maxCeiling, ps.ceiling + relaxAmount);
    }

    // R63 E5: Orchestrator-directed phase pair ceiling relaxation.
    // When the orchestrator detects phase-floor-vs-pair-ceiling contradiction,
    // it emits phasePairCeilingRelax > 1.0. Apply additional relaxation to
    // phase-related pairs so ceiling doesn't block phaseFloorController boosts.
    if (pair.indexOf('phase') !== -1 || pair === 'flicker-trust') {
      const ceilingRelaxSignal = safePreBoot.call(() => hyperMetaOrchestrator.getRateMultiplier('phasePairCeilingRelax'), 1.0) || 1.0;
      if (ceilingRelaxSignal > 1.0 && ps.ceiling < profile.baseCeiling) {
        const relaxLift = _CEILING_RELAX_RATE * (ceilingRelaxSignal - 1.0) * 3.0;
        ps.ceiling = m.min(profile.baseCeiling, ps.ceiling + relaxLift);
      }
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
