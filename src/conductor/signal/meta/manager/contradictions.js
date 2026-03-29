// contradictions.js -- cross-controller contradiction detection and
// adaptive rate multiplier computation. Identifies when controllers
// work at cross-purposes and applies resolution multipliers.

hyperMetaManagerContradictions = (() => {
  const ST = hyperMetaManagerState;
  const S  = ST.S;

  /**
   * @param {string[]} controllers
   * @param {string} description
   */
  function recordContradiction(controllers, description) {
    ST.contradictions.push({ beat: S.beatCount, controllers, description });
    if (ST.contradictions.length > ST.MAX_CONTRADICTIONS) ST.contradictions.shift();
    safePreBoot.call(() => explainabilityBus.emit('hyper-meta-contradiction', 'both', {
      beat: S.beatCount, controllers, description,
    }));
  }

  // ADAPTIVE RATE MULTIPLIERS

  /**
   * Compute rate multipliers that downstream controllers query.
   * @param {ReturnType<typeof hyperMetaManagerHealth.gatherControllerState>} state
   */
  function updateRateMultipliers(state) {
    let globalMultiplier = 1.0;
    if (S.systemPhase === 'oscillating')  globalMultiplier = 0.5;
    else if (S.systemPhase === 'stabilized') globalMultiplier = 1.3;

    // Phase floor boost authority expansion
    if (state.phaseFloor && state.phaseFloor.shareEma < 0.05) {
      if (S.systemPhase !== 'oscillating') {
        S.phaseBoostCeiling = clamp(S.phaseBoostCeiling + 0.5, 25.0, 40.0);
      }
    } else {
      S.phaseBoostCeiling = clamp(S.phaseBoostCeiling - 0.2, 25.0, 40.0);
    }

    // P95 alpha multiplier -- accelerate tracking when controller p95 lags reality
    let p95AlphaMultiplier = 1.0;
    if (state.pairCeiling) {
      const lagPairs = ['density-flicker', 'flicker-trust', 'tension-flicker'];
      for (let i = 0; i < lagPairs.length; i++) {
        const ps = state.pairCeiling[lagPairs[i]];
        if (ps && ps.p95Ema < 0.70 && ps.activeBeats > 50) {
          p95AlphaMultiplier = m.max(p95AlphaMultiplier, 1.8);
        }
      }
    }

    // Section 0 initial ceiling tightening
    let s0TighteningMultiplier = 1.0;
    if (state.warmupRamp && state.warmupRamp.pairs) {
      const dfWarmup = state.warmupRamp.pairs['density-flicker'];
      if (dfWarmup && dfWarmup.s0ExceedanceEma > 0.15) s0TighteningMultiplier = 1.4;
    }

    ST.rateMultipliers.global = globalMultiplier;
    ST.rateMultipliers.phaseBoostCeiling = S.phaseBoostCeiling;
    ST.rateMultipliers.p95Alpha = p95AlphaMultiplier;
    ST.rateMultipliers.s0Tightening = s0TighteningMultiplier;

    // Variance gate relaxation for phase axis
    let varianceGateRelaxMultiplier = 1.0;
    if (state.phaseFloor && state.phaseFloor.shareEma < 0.03) {
      varianceGateRelaxMultiplier = clamp(
        1.0 + (0.03 - state.phaseFloor.shareEma) * 40, 1.0, 2.5);
    }
    ST.rateMultipliers.varianceGateRelax = varianceGateRelaxMultiplier;

    // E7: Trust axis rebalancing booster
    const trustBoost = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e7TrustBoost'), 1.0));
    if (trustBoost > 1.0) {
      ST.rateMultipliers.entropyRegulator = (ST.rateMultipliers.entropyRegulator) * trustBoost;
    }

    // Per-controller multipliers (effectiveness-weighted)
    const names = Object.keys(ST.controllerStats);
    for (let i = 0; i < names.length; i++) {
      const stats = ST.controllerStats[names[i]];
      ST.rateMultipliers[names[i]] = globalMultiplier + clamp(stats.effectivenessEma * 0.3, 0, 0.15);
    }
  }

  // CROSS-CONTROLLER CONTRADICTION DETECTION

  /**
   * Detect contradictions that the watchdog might miss.
   * @param {ReturnType<typeof hyperMetaManagerHealth.gatherControllerState>} state
   */
  function detectContradictions(state) {
    // 1: Phase floor boosting while homeostasis throttling
    if (state.phaseFloor && state.homeostasis) {
      const phaseActive = state.phaseFloor.shareEma < state.phaseFloor.collapseThreshold;
      if (phaseActive && state.homeostasis.globalGainMultiplier < 0.7) {
        recordContradiction(
          ['phaseFloorController', 'couplingHomeostasis'],
          'Phase floor boosting while homeostasis throttling global gain');
        ST.rateMultipliers.phaseExemption = m.max(ST.rateMultipliers.phaseExemption, 1.5);
      }
    }

    // 2: Ceiling + warmup both at minimum on same pair
    if (state.pairCeiling && state.warmupRamp && state.warmupRamp.pairs) {
      const pairs = Object.keys(state.pairCeiling);
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const cs = state.pairCeiling[pair];
        const ws = state.warmupRamp.pairs[pair];
        if (!cs || !ws) continue;

        const defaults = pair === 'density-flicker'
          ? { minCeiling: 0.04, minWarmup: 6 }
          : { minCeiling: 0.05, minWarmup: 16 };

        if (cs.ceiling <= defaults.minCeiling * 1.2 &&
            ws.lastWarmupBeats <= defaults.minWarmup * 1.2) {
          recordContradiction(
            ['pairGainCeilingController', 'warmupRampController'],
            'Both ceiling and warmup at minimum for ' + pair + ' -- may cause oscillation');
          ST.rateMultipliers['ceilingRelax_' + pair] = 1.3;
        } else {
          ST.rateMultipliers['ceilingRelax_' + pair] = 1.0;
        }
      }
    }

    // 3: Phase floor boosting while pair ceiling tightening on phase pairs
    if (state.phaseFloor && state.pairCeiling) {
      const phaseActive = state.phaseFloor.shareEma < state.phaseFloor.lowShareThreshold;
      const ftState = state.pairCeiling['flicker-trust'];
      if (phaseActive && ftState && ftState.ceiling < 0.08) {
        recordContradiction(
          ['phaseFloorController', 'pairGainCeilingController'],
          'Phase floor boosting while flicker-trust ceiling very tight -- energy conflict');
        ST.rateMultipliers.phasePairCeilingRelax = 1.4;
      } else {
        ST.rateMultipliers.phasePairCeilingRelax = 1.0;
      }
    }

    // 4: Coherent regime suppresses phase coupling energy
    if (state.phaseFloor && state.profiler) {
      const regime = state.profiler.regime || '';
      const phaseShareLow = state.phaseFloor.shareEma < 0.08;
      const isCoherent = regime === 'coherent';
      const noThrottle = !state.homeostasis || state.homeostasis.globalGainMultiplier >= 0.7;
      if (phaseShareLow && isCoherent && noThrottle) {
        recordContradiction(
          ['phaseFloorController', 'couplingRefreshSetup'],
          'Coherent regime suppresses phase coupling via target relaxation while phase share < 0.08');
        const severity = clamp((0.08 - state.phaseFloor.shareEma) / 0.06, 0, 1);
        ST.rateMultipliers.phaseExemption = m.max(
          ST.rateMultipliers.phaseExemption, 1.0 + severity * 1.2);
      }
    }
  }

  return {
    updateRateMultipliers,
    detectContradictions,
  };
})();
