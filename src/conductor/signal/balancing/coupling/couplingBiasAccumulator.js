

/**
 * Coupling Bias Accumulator
 *
 * Post-pair-loop processing: axis total |r| computation and EMA smoothing,
 * high-priority pair promotion/demotion, coherence-gated nudge accumulation,
 * budget enforcement, soft-limiting, bias application, and product guard
 * recovery nudges.
 */

couplingBiasAccumulator = (() => {
  const V = validator.create('couplingBiasAccumulator');
  const { ALL_MONITORED_DIMS, NUDGEABLE_SET, GAIN_MAX,
    AXIS_SMOOTH_ALPHA, AXIS_BUDGET, GATE_EMA_ALPHA,
    HP_ROLLING_THRESHOLD, HP_MAX_BEATS, HP_COOLDOWN_BEATS } = couplingConstants;

  /** Pre-pass: compute per-axis total |r| and update smoothed EMA. */
  function computeAxisTotals(matrix) {
    const S = couplingState;
    S.axisTotalAbsR = {};
    for (let d = 0; d < ALL_MONITORED_DIMS.length; d++) {
      S.axisTotalAbsR[ALL_MONITORED_DIMS[d]] = 0;
    }
    S.axisPairContrib = {};
    for (let a = 0; a < ALL_MONITORED_DIMS.length; a++) {
      for (let b = a + 1; b < ALL_MONITORED_DIMS.length; b++) {
        const dA = ALL_MONITORED_DIMS[a];
        const dB = ALL_MONITORED_DIMS[b];
        const k = dA + '-' + dB;
        const cv = matrix[k];
        if (cv === null || cv === undefined || cv !== cv) continue;
        const ac = m.abs(cv);
        S.axisTotalAbsR[dA] = (V.optionalFinite(S.axisTotalAbsR[dA], 0)) + ac;
        S.axisTotalAbsR[dB] = (V.optionalFinite(S.axisTotalAbsR[dB], 0)) + ac;
        if (!S.axisPairContrib[dA]) S.axisPairContrib[dA] = {};
        if (!S.axisPairContrib[dB]) S.axisPairContrib[dB] = {};
        S.axisPairContrib[dA][k] = ac;
        S.axisPairContrib[dB][k] = ac;
      }
    }
    // Update axis coupling EMA
    for (let d = 0; d < ALL_MONITORED_DIMS.length; d++) {
      const ax = ALL_MONITORED_DIMS[d];
      const cur = V.optionalFinite(S.axisTotalAbsR[ax], 0);
      const prev = S.axisSmoothedAbsR[ax];
      if (prev === undefined) {
        S.axisSmoothedAbsR[ax] = cur;
      } else {
        S.axisSmoothedAbsR[ax] = prev * (1 - AXIS_SMOOTH_ALPHA) + cur * AXIS_SMOOTH_ALPHA;
      }
    }
  }

  /** Snapshot current absCorr per pair for next-beat velocity computation. */
  function snapshotPrevBeat(matrix) {
    const S = couplingState;
    S.prevBeatAbsCorr = {};
    for (let va = 0; va < ALL_MONITORED_DIMS.length; va++) {
      for (let vb = va + 1; vb < ALL_MONITORED_DIMS.length; vb++) {
        const vk = ALL_MONITORED_DIMS[va] + '-' + ALL_MONITORED_DIMS[vb];
        const vc = matrix[vk];
        if (typeof vc === 'number' && Number.isFinite(vc)) S.prevBeatAbsCorr[vk] = m.abs(vc);
      }
    }
  }

  /** High-priority pair promotion/demotion/cooldown. */
  function processHPPromotion() {
    const S = couplingState;
    if (S.hpCooldownRemaining > 0) S.hpCooldownRemaining--;
    if (S.hpPromotedPair !== null) {
      S.hpBeats++;
      const hpAt = S.adaptiveTargets[S.hpPromotedPair];
      const hpPs = S.pairState[S.hpPromotedPair];
      const hpResolved = hpAt && hpAt.rawRollingAbsCorr < HP_ROLLING_THRESHOLD * 0.8;
      const hpLowEffectiveness = hpPs && (hpPs.effectivenessEma || 0.5) < 0.30;
      if (S.hpBeats >= HP_MAX_BEATS || hpResolved || hpLowEffectiveness || !hpAt || !hpPs) {
        if (hpPs) {
          const normalMax = (S.hpPromotedPair === 'density-flicker') ? S.densityFlickerGainCeiling : GAIN_MAX;
          hpPs.gain = m.min(hpPs.gain, normalMax);
        }
        S.hpPromotedPair = null;
        S.hpBeats = 0;
        S.hpCooldownRemaining = HP_COOLDOWN_BEATS;
      }
    } else if (S.hpCooldownRemaining <= 0) {
      let worstKey = null;
      let worstRolling = 0;
      const atKeys = Object.keys(S.adaptiveTargets);
      for (let i = 0; i < atKeys.length; i++) {
        const ak = atKeys[i];
        const at = S.adaptiveTargets[ak];
        const ps = S.pairState[ak];
        if (!at || !ps) continue;
        if (ps.gain >= GAIN_MAX * 0.95 && at.rawRollingAbsCorr > HP_ROLLING_THRESHOLD) {
          const hpDims = ak.split('-');
          if (!NUDGEABLE_SET.has(hpDims[0]) && !NUDGEABLE_SET.has(hpDims[1])) continue;
          if ((ps.effectivenessEma || 0.5) < 0.35) continue;
          if (at.rawRollingAbsCorr > worstRolling) {
            worstRolling = at.rawRollingAbsCorr;
            worstKey = ak;
          }
        }
      }
      if (worstKey !== null) {
        S.hpPromotedPair = worstKey;
        S.hpBeats = 0;
      }
    }
  }

  function coherenceGate(pos, neg) {
    const total = pos + m.abs(neg);
    if (total < 0.001) return 1.0;
    return m.abs(pos + neg) / total;
  }

  /**
   * Finalize biases: coherence gate, budget enforcement, soft-limiting,
   * bias application, guard recovery nudges, diagnostic emission.
   * @param {{ D: number, T: number, F: number, DPos: number, DNeg: number, TPos: number, TNeg: number, FPos: number, FNeg: number, DBypass: number, TBypass: number, FBypass: number }} nudges
   * @param {object} setup
   */
  function finalize(nudges, setup) {
    const S = couplingState;
    const hs = safePreBoot.call(() => couplingHomeostasis.getState(), null);

    // Coherence gate
    const gateD = coherenceGate(nudges.DPos, nudges.DNeg);
    const gateT = coherenceGate(nudges.TPos, nudges.TNeg);
    const gateF = coherenceGate(nudges.FPos, nudges.FNeg);
    const gateEngagePressure = hs && hs.budgetConstraintActive
      ? clamp(
        hs.budgetConstraintPressure * 0.50 +
        hs.tailRecoveryHandshake * 0.20 +
        clamp((0.72 - hs.globalGainMultiplier) / 0.42, 0, 1) * 0.15,
        0,
        1)
      : 0;
    function engageGate(rawGate, gateEma) {
      if (gateEngagePressure <= 0 || rawGate < 0.98) return rawGate;
      const emaPressure = clamp((gateEma - 0.92) / 0.08, 0, 1);
      const engagedCeiling = clamp(1 - gateEngagePressure * 0.14 - emaPressure * 0.10, 0.78, 1);
      return m.min(rawGate, engagedCeiling);
    }
    const engagedGateD = engageGate(gateD, S.gateEmaD);
    const engagedGateT = engageGate(gateT, S.gateEmaT);
    const engagedGateF = engageGate(gateF, S.gateEmaF);
    let nudgeD = nudges.D * engagedGateD + nudges.DBypass;
    let nudgeT = nudges.T * engagedGateT + nudges.TBypass;
    let nudgeF = nudges.F * engagedGateF + nudges.FBypass;

    // Gate diagnostics
    S.lastGateD = Number(engagedGateD.toFixed(4));
    S.lastGateT = Number(engagedGateT.toFixed(4));
    S.lastGateF = Number(engagedGateF.toFixed(4));
    S.lastFloorDampen = Number(setup.floorDampen.toFixed(4));
    S.lastBypassD = Number(nudges.DBypass.toFixed(6));
    S.lastBypassT = Number(nudges.TBypass.toFixed(6));
    S.lastBypassF = Number(nudges.FBypass.toFixed(6));
    S.gateMinD = m.min(S.gateMinD, engagedGateD);
    S.gateMinT = m.min(S.gateMinT, engagedGateT);
    S.gateMinF = m.min(S.gateMinF, engagedGateF);
    S.gateEmaD = S.gateEmaD * (1 - GATE_EMA_ALPHA) + engagedGateD * GATE_EMA_ALPHA;
    S.gateEmaT = S.gateEmaT * (1 - GATE_EMA_ALPHA) + engagedGateT * GATE_EMA_ALPHA;
    S.gateEmaF = S.gateEmaF * (1 - GATE_EMA_ALPHA) + engagedGateF * GATE_EMA_ALPHA;
    S.gateBeatCount++;
    explainabilityBus.emit('COUPLING_GATES', 'all', {
      gateD: S.lastGateD, gateT: S.lastGateT, gateF: S.lastGateF,
      floorDampen: S.lastFloorDampen,
      bypassD: S.lastBypassD, bypassT: S.lastBypassT, bypassF: S.lastBypassF,
    });

    // Dynamic axis budget
    let dynAxisBudget = AXIS_BUDGET;
    if (hs && hs.totalEnergyEma > 0.1) {
      dynAxisBudget = clamp(hs.totalEnergyEma / 15.0, 0.12, 0.36);
    }
    const dynFlickerBudget = dynAxisBudget * 1.5;
    if (m.abs(nudgeD) > dynAxisBudget) nudgeD = m.sign(nudgeD) * dynAxisBudget;
    if (m.abs(nudgeT) > dynAxisBudget) nudgeT = m.sign(nudgeT) * dynAxisBudget;
    if (m.abs(nudgeF) > dynFlickerBudget) nudgeF = m.sign(nudgeF) * dynFlickerBudget;

    // Soft-limit
    let softLimit = 0.16;
    const healthGrade = safePreBoot.call(() => signalHealthAnalyzer.getHealth().overall, 'healthy');
    if (healthGrade === 'strained' || healthGrade === 'stressed' || healthGrade === 'critical') {
      softLimit = 0.20;
    }
    const flickerSoftLimit = softLimit * 1.5;

    // Saturation detection
    S.saturatedAxes.clear();
    if (m.abs(nudgeD) >= softLimit * 0.9) S.saturatedAxes.add('density');
    if (m.abs(nudgeT) >= softLimit * 0.9) S.saturatedAxes.add('tension');
    if (m.abs(nudgeF) >= flickerSoftLimit * 0.9) S.saturatedAxes.add('flicker');

    nudgeD = clamp(nudgeD, -softLimit, softLimit);
    nudgeT = clamp(nudgeT, -softLimit, softLimit);
    nudgeF = clamp(nudgeF, -flickerSoftLimit, flickerSoftLimit);

    S.biasDensity = 1.0 + nudgeD;
    S.biasTension = 1.0 + nudgeT;
    S.biasFlicker = 1.0 + nudgeF;
    // R81 E3: Flicker crush floor. At 50% pipeline crush the coupling
    // manager's flicker contribution is the dominant suppressor. Cap the
    // maximum suppression at 5% to keep the feedback loop active.
    S.biasFlicker = m.max(S.biasFlicker, 0.95);

    // Tension product self-limiter
    const tensionProd = safePreBoot.call(() => signalReader.snapshot()?.tensionProduct, 1.0);
    if (typeof tensionProd === 'number' && tensionProd > 1.30 && S.biasTension > 1.0) {
      const tensionSaturationDepth = clamp((tensionProd - 1.30) / 0.12, 0, 1);
      S.biasTension = 1.0 + (S.biasTension - 1.0) * (1.0 - tensionSaturationDepth * 0.70);
    }

    // Flicker guard recovery nudge
    if (S.flickerGuardState === 'guarding' && S.biasFlicker < 0.98) {
      let nudgeRate = 0.002;
      if (S.flickerGuardBeats > 60) { nudgeRate = 0.008; }
      else if (S.flickerGuardBeats > 30) { nudgeRate = 0.005; }
      S.biasFlicker = m.min(S.biasFlicker + nudgeRate, 1.0);
    }
    // Density guard recovery nudge
    if (S.densityGuardState === 'guarding' && S.biasDensity < 0.98) {
      let densityNudgeRate = 0.002;
      if (S.densityGuardBeats > 60) { densityNudgeRate = 0.008; }
      else if (S.densityGuardBeats > 30) { densityNudgeRate = 0.005; }
      S.biasDensity = m.min(S.biasDensity + densityNudgeRate, 1.0);
    }
  }

  return { computeAxisTotals, snapshotPrevBeat, processHPPromotion, finalize };
})();
