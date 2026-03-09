

/**
 * Coupling State
 *
 * All mutable state for the pipeline coupling manager, plus accessor
 * functions and the per-section reset logic.
 */

couplingState = (() => {
  const C = couplingConstants;

  // Container state
  /** @type {Record<string, { baseline: number, current: number, rollingAbsCorr: number, rawRollingAbsCorr: number }>} */
  const adaptiveTargets = {};
  /** @type {Record<string, { gain: number, lastAbsCorr: number, recentAbsCorr: number[], telemetryAbsCorr: number[], heatPenalty: number, effectivenessEma: number, effMin: number, effMax: number, effActiveBeats: number, lastEffectiveGain: number }>} */
  const pairState = {};
  /** @type {Record<string, { sign: number, count: number, consecutiveTriggers: number }>} */
  const monotoneState = {};
  /** @type {Record<string, number>} */
  const axisSmoothedAbsR = {};
  /** @type {Set<string>} */
  const saturatedAxes = new Set();

  // Scalar / per-beat state (properties for external mutability)
  const S = {
    biasDensity: 1.0,
    biasTension: 1.0,
    biasFlicker: 1.0,
    densityFlickerGainCeiling: C.GAIN_MAX,
    globalGainMultiplier: 1.0,
    coherentShareEma: 0.15,
    exploringBeatCount: 0,
    flickerGuardState: 'normal',
    flickerGuardBeats: 0,
    densityGuardState: 'normal',
    densityGuardBeats: 0,
    couplingVelocityEma: 0,
    velocityBoostActive: false,
    velocityBoostCooldown: 0,
    /** @type {Record<string, number>} */
    prevBeatAbsCorr: {},
    /** @type {Record<string, number>} */
    axisTotalAbsR: {},
    /** @type {Record<string, Record<string, number>>} */
    axisPairContrib: {},
    /** @type {Record<string, number>} */
    budgetPriorityScore: {},
    /** @type {Record<string, number>} */
    budgetPriorityBoost: {},
    /** @type {Record<string, number>} */
    budgetPriorityRank: {},
    lastGateD: 1.0, lastGateT: 1.0, lastGateF: 1.0,
    lastFloorDampen: 1.0,
    lastBypassD: 0, lastBypassT: 0, lastBypassF: 0,
    gateMinD: 1.0, gateMinT: 1.0, gateMinF: 1.0,
    gateEmaD: 1.0, gateEmaT: 1.0, gateEmaF: 1.0,
    gateBeatCount: 0,
    /** @type {string | null} */
    hpPromotedPair: null,
    hpBeats: 0,
    hpCooldownRemaining: 0,
  };

  function getAdaptiveTarget(key) {
    if (!adaptiveTargets[key]) {
      const baseline = C.PAIR_TARGETS[key] !== undefined ? C.PAIR_TARGETS[key] : C.DEFAULT_TARGET;
      adaptiveTargets[key] = { baseline, current: baseline, rollingAbsCorr: 0, rawRollingAbsCorr: 0 };
    }
    return adaptiveTargets[key];
  }

  function getPairState(key) {
    if (!pairState[key]) {
      const initGain = C.NON_NUDGEABLE_SET.has(key)
        ? 0
        : (C.PAIR_GAIN_INIT[key] !== undefined ? C.PAIR_GAIN_INIT[key] : C.GAIN_INIT);
      pairState[key] = {
        gain: initGain, lastAbsCorr: 0, recentAbsCorr: [], telemetryAbsCorr: [],
        heatPenalty: 0, effectivenessEma: 0.5, effMin: 1.0, effMax: 0.0, effActiveBeats: 0, lastEffectiveGain: 0,
      };
    }
    return pairState[key];
  }

  function getTarget(key) {
    return getAdaptiveTarget(key).current;
  }

  function getTargetMax(key) {
    const globalMax = key === 'density-flicker' ? C.DENSITY_FLICKER_TARGET_MAX : C.TARGET_MAX;
    const at = adaptiveTargets[key];
    return at ? m.min(globalMax, at.baseline * 2.5) : globalMax;
  }

  function reset() {
    S.biasDensity = 1.0;
    S.biasTension = 1.0;
    S.biasFlicker = 1.0;
    saturatedAxes.clear();
    // Warm-start gains for chronically elevated pairs
    const keys = Object.keys(pairState);
    for (let i = 0; i < keys.length; i++) {
      const initGain = C.PAIR_GAIN_INIT[keys[i]] !== undefined ? C.PAIR_GAIN_INIT[keys[i]] : C.GAIN_INIT;
      const ps = pairState[keys[i]];
      let warmGain = initGain;
      if (ps.recentAbsCorr.length >= 4) {
        const sorted = ps.recentAbsCorr.slice().sort((a, b) => a - b);
        const mid = m.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        const pairTarget = getAdaptiveTarget(keys[i]).current;
        if (median > pairTarget * 2) {
          warmGain = m.min(initGain * 1.5, C.GAIN_MAX * 0.6);
        }
      }
      ps.gain = warmGain;
      ps.lastAbsCorr = 0;
      ps.recentAbsCorr = [];
      ps.heatPenalty = 0;
      ps.effMin = 1.0;
      ps.effMax = 0.0;
      ps.effActiveBeats = 0;
    }
    // Graduated dampening for adaptive targets (cross-section memory preserved)
    const targetKeys = Object.keys(adaptiveTargets);
    for (let i = 0; i < targetKeys.length; i++) {
      const at = adaptiveTargets[targetKeys[i]];
      const driftRatio = at.baseline > 0 ? at.current / at.baseline : 1;
      const dampen = driftRatio > 1.5 ? 0.3 : 0.7;
      at.rollingAbsCorr *= dampen;
      at.rawRollingAbsCorr *= dampen;
    }
    S.coherentShareEma = S.coherentShareEma * 0.7 + 0.15 * 0.3;
    S.exploringBeatCount = 0;
    S.velocityBoostCooldown = 0;
    S.velocityBoostActive = false;
    S.couplingVelocityEma = 0;
    S.prevBeatAbsCorr = {};
    const mstKeys = Object.keys(monotoneState);
    for (let mi = 0; mi < mstKeys.length; mi++) { monotoneState[mstKeys[mi]].count = 0; monotoneState[mstKeys[mi]].sign = 0; }
    const smKeys = Object.keys(axisSmoothedAbsR);
    for (let si = 0; si < smKeys.length; si++) axisSmoothedAbsR[smKeys[si]] *= 0.50;
    S.flickerGuardState = 'normal';
    S.densityGuardState = 'normal';
    S.hpPromotedPair = null;
    S.hpBeats = 0;
    S.hpCooldownRemaining = 0;
    S.budgetPriorityScore = {};
    S.budgetPriorityBoost = {};
    S.budgetPriorityRank = {};
  }

  // Attach containers and accessors to the state object
  S.adaptiveTargets = adaptiveTargets;
  S.pairState = pairState;
  S.monotoneState = monotoneState;
  S.axisSmoothedAbsR = axisSmoothedAbsR;
  S.saturatedAxes = saturatedAxes;
  S.getAdaptiveTarget = getAdaptiveTarget;
  S.getPairState = getPairState;
  S.getTarget = getTarget;
  S.getTargetMax = getTargetMax;
  S.reset = reset;

  return S;
})();
