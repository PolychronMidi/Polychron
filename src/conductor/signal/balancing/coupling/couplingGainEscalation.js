

/**
 * Coupling Gain Escalation
 *
 * Per-pair gain adaptation: monotone circuit breaker, escalation rate
 * computation with pair-specific multipliers, pairGainMax caps, gain
 * relaxation, effectiveness EMA, rolling window push, and adaptive
 * target calibration.
 */

couplingGainEscalation = (() => {
  const { GAIN_INIT, GAIN_MIN, GAIN_MAX, GAIN_ESCALATE_RATE, GAIN_EMERGENCY_RATE, GAIN_RELAX_RATE,
    NUDGEABLE_SET, AXIS_COUPLING_CEILING, HP_GAIN_MAX,
    FLICKER_PAIR_GAIN_CAP, FLICKER_PAIR_GAIN_CAP_THRESHOLD,
    DENSITY_PAIR_GAIN_CAP, DENSITY_PAIR_GAIN_CAP_THRESHOLD,
    MONOTONE_TRIGGER, HIGH_CORR_MONOTONE_TRIGGER, MONOTONE_ABS_THRESHOLD, MONOTONE_IMPULSE_RATE,
    TARGET_ADAPT_EMA, TARGET_RELAX_RATE, TARGET_TIGHTEN_RATE, TARGET_MIN,
    P95_WINDOW, TELEMETRY_WINDOW } = couplingConstants;
  const pushWindowValue = pipelineCouplingManagerSnapshot.pushWindowValue;

  /** Process non-nudgeable pair: update EMA and windows only. */
  function handleNonNudgeable(key, ps, absCorr, isEntropyPair, dynTelemetryWindow) {
    const telWin = dynTelemetryWindow || TELEMETRY_WINDOW;
    ps.gain = 0;
    ps.lastEffectiveGain = 0;
    ps.lastAbsCorr = absCorr;
    pushWindowValue(ps.recentAbsCorr, absCorr, P95_WINDOW);
    pushWindowValue(ps.telemetryAbsCorr, absCorr, telWin);
    const at = couplingState.getAdaptiveTarget(key);
    const adaptEma = isEntropyPair ? TARGET_ADAPT_EMA * 2.5 : TARGET_ADAPT_EMA;
    at.rollingAbsCorr = at.rollingAbsCorr * (1 - adaptEma) + absCorr * adaptEma;
    at.rawRollingAbsCorr = at.rawRollingAbsCorr * (1 - adaptEma) + absCorr * adaptEma;
  }

  /**
   * Full per-pair gain processing: monotone tracking, gain escalation or
   * relaxation, axis gain scale, effectiveness, windows, target calibration.
   * @returns {{ axisGainScale: number }}
   */
  function processGain(key, dimA, dimB, corr, absCorr, target, ps, tailTelemetry, setup, flags, nonNudgeableHandOffPressure) {
    const S = couplingState;

    // Monotone tracking
    if (!S.monotoneState[key]) S.monotoneState[key] = { sign: 0, count: 0, consecutiveTriggers: 0 };
    const mst = S.monotoneState[key];
    const corrSign = corr > 0.001 ? 1 : corr < -0.001 ? -1 : 0;
    if (corrSign !== 0 && corrSign === mst.sign && absCorr > MONOTONE_ABS_THRESHOLD) {
      mst.count++;
    } else {
      if (corrSign !== mst.sign) mst.consecutiveTriggers = 0;
      mst.sign = corrSign;
      mst.count = absCorr > MONOTONE_ABS_THRESHOLD ? 1 : 0;
    }
    const monotoneTrigger = corr > 0.85 ? HIGH_CORR_MONOTONE_TRIGGER : MONOTONE_TRIGGER;
    const monotoneActive = mst.count >= monotoneTrigger;
    if (monotoneActive && mst.count === monotoneTrigger) mst.consecutiveTriggers++;

    const p95 = tailTelemetry.p95;
    const recentP95 = tailTelemetry.recentP95;
    const telemetrySevereRate = tailTelemetry.severeRate;
    const telemetryHotspotRate = tailTelemetry.hotspotRate;
    let axisGainScale = 1.0;

    if (absCorr > target) {
      const improving = absCorr < ps.lastAbsCorr - 0.005;
      const pairSaturated = S.saturatedAxes.has(dimA) || S.saturatedAxes.has(dimB);
      if (!improving && !pairSaturated) {
        let rate = absCorr > target * 2 ? GAIN_EMERGENCY_RATE : GAIN_ESCALATE_RATE;
        if (p95 > target * 1.5) {
          rate *= 1.5;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.05, 1.0);
        } else {
          ps.heatPenalty = m.max(0, (ps.heatPenalty || 0) - 0.01);
        }
        if (flags.isTensionEntropyPair && corr < 0) {
          rate *= 1.2;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.03, 1.0);
        }
        if (flags.isDensityFlickerPair && m.abs(corr) > 0.80) {
          const dfGrad = (m.abs(corr) - 0.80) * 2.0;
          rate *= (1 + dfGrad);
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + dfGrad * 0.25, 1.0);
        }
        if (flags.isDensityFlickerPair) {
          let dfSevereCount = 0;
          for (let r = 0; r < ps.recentAbsCorr.length; r++) {
            if (ps.recentAbsCorr[r] > 0.85) dfSevereCount++;
          }
          const dfSevereRate = ps.recentAbsCorr.length > 0 ? dfSevereCount / ps.recentAbsCorr.length : 0;
          const dfTailPressure = clamp((m.max(p95, recentP95) - 0.88) * 2.8, 0, 0.48)
            + clamp((dfSevereRate - 0.15) * 1.4, 0, 0.34)
            + clamp((telemetrySevereRate - 0.12) * 1.6, 0, 0.28)
            + clamp((m.abs(corr) - 0.90) * 1.8, 0, 0.24);
          if (dfTailPressure > 0) {
            rate *= 1 + dfTailPressure;
            ps.heatPenalty = m.min((ps.heatPenalty || 0) + dfTailPressure * 0.18, 1.0);
          }
        }
        if (flags.isEntropySurfacePair && (m.abs(corr) > 0.70 || p95 > 0.78)) {
          let entropyExceedCount = 0;
          for (let r = 0; r < ps.recentAbsCorr.length; r++) {
            if (ps.recentAbsCorr[r] > 0.78) entropyExceedCount++;
          }
          const entropyExceedRate = ps.recentAbsCorr.length > 0 ? entropyExceedCount / ps.recentAbsCorr.length : 0;
          const entropyPressure = clamp((m.abs(corr) - 0.70) * 1.5, 0, 0.34)
            + clamp((p95 - 0.78) * 1.9, 0, 0.36)
            + clamp((telemetryHotspotRate - 0.16) * 0.9, 0, 0.18)
            + clamp((telemetrySevereRate - 0.04) * 1.2, 0, 0.24)
            + clamp((entropyExceedRate - 0.18) * 0.8, 0, 0.18);
          if (entropyPressure > 0) {
            rate *= 1 + entropyPressure;
            ps.heatPenalty = m.min((ps.heatPenalty || 0) + entropyPressure * 0.14, 1.0);
          }
        }
        if (flags.isEntropySurfacePair && setup.entropyAxisPressure > 0) {
          rate *= 1 + setup.entropyAxisPressure * 0.55;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + setup.entropyAxisPressure * 0.08, 1.0);
        }
        // R73 E2: Entropy-cluster severe escalation. When an entropy-surface
        // pair is severe (p95 > 0.80) and telemetry confirms persistent
        // hotspot activity, apply 1.3x multiplier to break structural
        // entropy-axis coupling concentration (3/3 severe in R72).
        if (flags.isEntropySurfacePair && p95 > 0.80 && telemetrySevereRate > 0.06) {
          const entropySevereBoost = 1.3 * clamp((p95 - 0.80) / 0.12, 0.5, 1.0);
          rate *= entropySevereBoost;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.06, 1.0);
        }
        if (nonNudgeableHandOffPressure > 0) {
          rate *= 1 + nonNudgeableHandOffPressure * 0.45;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + nonNudgeableHandOffPressure * 0.08, 1.0);
        }
        if (flags.isPhasePair && (m.abs(corr) > 0.78 || p95 > 0.88)) {
          let phaseExceedCount = 0;
          for (let r = 0; r < ps.recentAbsCorr.length; r++) {
            if (ps.recentAbsCorr[r] > 0.85) phaseExceedCount++;
          }
          const phaseExceedRate = ps.recentAbsCorr.length > 0 ? phaseExceedCount / ps.recentAbsCorr.length : 0;
          const phasePressure = clamp((m.abs(corr) - 0.78) * 1.8, 0, 0.45)
            + clamp((p95 - 0.88) * 2.0, 0, 0.35)
            + clamp((phaseExceedRate - 0.25) * 0.9, 0, 0.25);
          rate *= (1 + phasePressure);
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + phasePressure * 0.12, 1.0);
        }
        if (flags.isPhaseSurfacePair && (m.abs(corr) > 0.72 || p95 > 0.80)) {
          const phaseSurfacePressure = clamp((m.abs(corr) - 0.72) * 1.4, 0, 0.28)
            + clamp((p95 - 0.80) * 1.6, 0, 0.22);
          rate *= 1 + phaseSurfacePressure;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + phaseSurfacePressure * 0.10, 1.0);
        }
        if (flags.isTrustPair && (NUDGEABLE_SET.has(dimA) || NUDGEABLE_SET.has(dimB)) && (m.abs(corr) > 0.74 || p95 > 0.82)) {
          let trustExceedCount = 0;
          for (let r = 0; r < ps.recentAbsCorr.length; r++) {
            if (ps.recentAbsCorr[r] > 0.80) trustExceedCount++;
          }
          const trustExceedRate = ps.recentAbsCorr.length > 0 ? trustExceedCount / ps.recentAbsCorr.length : 0;
          const trustPressure = clamp((m.abs(corr) - 0.74) * 1.7, 0, 0.40)
            + clamp((p95 - 0.82) * 2.0, 0, 0.35)
            + clamp((trustExceedRate - 0.20) * 1.0, 0, 0.25);
          rate *= (1 + trustPressure);
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + trustPressure * 0.14, 1.0);
        }
        // R75 E1: Tension-flicker coherent spike suppression.
        // When regime is coherent and a tension-flicker pair shows high
        // absCorr with persistent severe exceedance, apply 1.5x escalation
        // to break the late-run coupling lock observed in R75 (p95 0.922).
        const isTensionFlickerPair = (dimA === 'tension' && dimB === 'flicker') || (dimA === 'flicker' && dimB === 'tension');
        if (isTensionFlickerPair && setup.regime === 'coherent' &&
            absCorr > 0.85 && tailTelemetry.recentSevereRate > 0.20) {
          const coherentSpikePressure = clamp((absCorr - 0.85) * 3.0, 0, 0.50)
            + clamp((tailTelemetry.recentSevereRate - 0.20) * 1.5, 0, 0.40);
          rate *= 1 + coherentSpikePressure;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + coherentSpikePressure * 0.15, 1.0);
        }
        if (!flags.isDensityFlickerPair && m.abs(corr) > 0.85) {
          rate *= 1.15;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.01, 1.0);
        }
        const eff = ps.effectivenessEma || 0.5;
        if (eff < 0.50) rate *= m.max(0.25, eff / 0.50);
        const hp = ps.heatPenalty || 0;
        if (hp > 0.30) rate *= m.max(0.35, 1.0 - hp);
        rate *= S.globalGainMultiplier;
        rate *= setup.floorDampen;

        let pairGainMax = flags.isDensityFlickerPair ? S.densityFlickerGainCeiling : GAIN_MAX;
        if (eff < 0.40) {
          const effCap = GAIN_INIT + (pairGainMax - GAIN_INIT) * m.max(0.40, eff);
          pairGainMax = m.min(pairGainMax, m.max(GAIN_INIT * 1.5, effCap));
        }
        if (key === S.hpPromotedPair) pairGainMax = m.max(pairGainMax, HP_GAIN_MAX);
        if ((dimA === 'flicker' || dimB === 'flicker') && S.flickerGuardState === 'guarding' &&
            typeof setup.flickerProd === 'number' && setup.flickerProd < FLICKER_PAIR_GAIN_CAP_THRESHOLD) {
          pairGainMax = m.min(pairGainMax, FLICKER_PAIR_GAIN_CAP);
        }
        if ((dimA === 'density' || dimB === 'density') && S.densityGuardState === 'guarding' &&
            typeof setup.densityProd === 'number' && setup.densityProd < DENSITY_PAIR_GAIN_CAP_THRESHOLD) {
          pairGainMax = m.min(pairGainMax, DENSITY_PAIR_GAIN_CAP);
        }
        if (absCorr > 0.85) {
          const severeDensityFlicker = flags.isDensityFlickerPair && (p95 > 0.88 || telemetrySevereRate > 0.10);
          pairGainMax = m.min(pairGainMax, severeDensityFlicker ? 0.34 : 0.30);
        }
        if (monotoneActive) {
          const cumulativeScale = m.min(2.0, 1.0 + (mst.consecutiveTriggers - 1) * 0.50);
          rate *= MONOTONE_IMPULSE_RATE * cumulativeScale;
          ps.heatPenalty = m.min((ps.heatPenalty || 0) + 0.15, 1.0);
        }
        ps.gain = clamp(ps.gain + rate, GAIN_MIN, pairGainMax);
      }

      // Axis-centric proportional gain scaling
      const dimATotal = S.axisTotalAbsR[dimA] || 0;
      const dimBTotal = S.axisTotalAbsR[dimB] || 0;
      const dimACeiling = AXIS_COUPLING_CEILING[dimA] || 2.0;
      const dimBCeiling = AXIS_COUPLING_CEILING[dimB] || 2.0;
      if (dimATotal > dimACeiling && S.axisPairContrib[dimA]) {
        const pairShare = (S.axisPairContrib[dimA][key] || 0) / dimATotal;
        axisGainScale = m.min(axisGainScale, pairShare * (Object.keys(S.axisPairContrib[dimA]).length));
      }
      if (dimBTotal > dimBCeiling && S.axisPairContrib[dimB]) {
        const pairShare = (S.axisPairContrib[dimB][key] || 0) / dimBTotal;
        axisGainScale = m.min(axisGainScale, pairShare * (Object.keys(S.axisPairContrib[dimB]).length));
      }
      axisGainScale = clamp(axisGainScale, 0.15, 1.5);
    } else {
      let relaxRate = flags.isEntropyPair ? GAIN_RELAX_RATE * 2 : GAIN_RELAX_RATE;
      if (flags.isTensionEntropyPair) relaxRate *= 0.35;
      ps.gain = clamp(ps.gain - relaxRate, GAIN_INIT, GAIN_MAX);
      ps.heatPenalty = m.max(0, (ps.heatPenalty || 0) - 0.05);
    }

    // Effectiveness EMA update
    if (ps.gain > GAIN_INIT * 1.2 && absCorr > target) {
      const improved = absCorr < ps.lastAbsCorr ? 1 : 0;
      ps.effectivenessEma = (ps.effectivenessEma || 0.5) * 0.95 + improved * 0.05;
      ps.effActiveBeats = (ps.effActiveBeats || 0) + 1;
      ps.effMin = m.min(ps.effMin !== undefined ? ps.effMin : 1.0, ps.effectivenessEma);
      ps.effMax = m.max(ps.effMax !== undefined ? ps.effMax : 0.0, ps.effectivenessEma);
    }
    ps.lastAbsCorr = absCorr;

    // Window push
    pushWindowValue(ps.recentAbsCorr, absCorr, P95_WINDOW);
    // R75 E6: Reconciliation gap pressure for density-flicker pair.
    // When the pair's long-window p95 diverges from short-window p95 by > 0.20,
    // widen the telemetry window to accelerate reconciliation (cap at 2x base).
    let telWin = setup.dynTelemetryWindow || TELEMETRY_WINDOW;
    if (flags.isDensityFlickerPair && ps.telemetryAbsCorr.length > 0 && ps.recentAbsCorr.length > 0) {
      const longP95 = tailTelemetry.p95;
      const shortP95 = tailTelemetry.recentP95;
      const reconGap = m.abs(longP95 - shortP95);
      if (reconGap > 0.20) {
        telWin = m.min(telWin * 2, m.floor(telWin * (1 + m.min(reconGap / 0.40, 1.0))));
      }
    }
    const telemetryWeight = flags.isTrustPair ? m.min(telWin, setup.telemetryBeatSpan + 1) : setup.telemetryBeatSpan;
    for (let tw = 0; tw < telemetryWeight; tw++) {
      pushWindowValue(ps.telemetryAbsCorr, absCorr, telWin);
    }

    // Adaptive target EMA
    const at = couplingState.getAdaptiveTarget(key);
    const adaptEma = flags.isEntropyPair ? TARGET_ADAPT_EMA * 2.5 : TARGET_ADAPT_EMA;
    at.rollingAbsCorr = at.rollingAbsCorr * (1 - adaptEma) + absCorr * adaptEma;
    at.rawRollingAbsCorr = at.rawRollingAbsCorr * (1 - adaptEma) + absCorr * adaptEma;

    // Target self-calibration: intractable pairs relax, resolved pairs tighten
    const effectiveGainCap = absCorr > 0.85 ? 0.30 : GAIN_MAX;
    if (at.rawRollingAbsCorr > at.current * 1.8 && ps.gain >= effectiveGainCap * 0.85) {
      at.current = clamp(at.current + TARGET_RELAX_RATE, TARGET_MIN, couplingState.getTargetMax(key));
    } else if (at.rawRollingAbsCorr < at.current * 0.5) {
      let tightenRate = TARGET_TIGHTEN_RATE;
      const sig = safePreBoot.call(() => signalReader.snapshot(), null);
      if (sig && (dimA === 'density' || dimB === 'density')) {
        const sigScalar = 1 / (1 + m.exp(-25 * (sig.densityProduct - 0.72)));
        tightenRate *= sigScalar;
      }
      if (sig && (dimA === 'flicker' || dimB === 'flicker') && (dimA === 'trust' || dimB === 'trust')) {
        const ts = safePreBoot.call(() => adaptiveTrustScores.getSnapshot(), {});
        let avgTrust = 0;
        let tCount = 0;
        const entries = Object.values(ts || {});
        for (let i = 0; i < entries.length; i++) {
          if (entries[i] && typeof entries[i].score === 'number') {
            avgTrust += entries[i].score;
            tCount++;
          }
        }
        if (tCount > 0) avgTrust /= tCount;
        const flickerTrustScalar = 1 / (1 + m.exp(-25 * ((sig.flickerProduct + avgTrust) / 2 - 0.70)));
        tightenRate *= flickerTrustScalar;
      }
      if (tightenRate > 0.0001) {
        at.current = clamp(at.current - tightenRate, TARGET_MIN, at.baseline);
      }
    }

    return { axisGainScale };
  }

  return { processGain, handleNonNudgeable };
})();
