// phaseFloorController.js - Hypermeta self-calibrating phase energy floor (#14).
// Replaces hardcoded phase collapse thresholds, streak counts, and boost
// multipliers with adaptive logic derived from rolling phase share volatility
// and coherent regime duration. Consumed by axisEnergyEquilibratorAxisAdjustments.

phaseFloorController = (() => {

  // ADAPTIVE STATE
  const _SHARE_EMA_ALPHA = 0.06;
  const _VOLATILITY_EMA_ALPHA = 0.04;
  const _COHERENT_STREAK_EMA_ALPHA = 0.03;
  // R22 E5: 0.05->0.08. Phase at 0.1334, below fair share (0.167).
  // Faster recovery tracking makes the phase floor controller more responsive
  // to phase deficit, reducing the lag between boost application and success
  // measurement. Helps break the chronic mid-suppression pattern.
  const _RECOVERY_EMA_ALPHA = 0.08;

  let phaseFloorControllerShareEma = 0.1667; // starts at FAIR_SHARE
  let phaseFloorControllerVolatilityEma = 0;
  let phaseFloorControllerCoherentStreakEma = 0;
  let phaseFloorControllerLastShare = 0.1667;
  let phaseFloorControllerCurrentCoherentStreak = 0;
  let phaseFloorControllerBeatCount = 0;
  let phaseFloorControllerRecoverySuccessEma = 0.5;
  let phaseFloorControllerLastBoostApplied = 0;

  // DERIVED THRESHOLDS (self-calibrating)

  /**
   * Derive the phase collapse threshold (default 0.02) from volatility.
   * Higher volatility -> slightly higher threshold (more sensitive detection).
   * Lower volatility -> tighter threshold (phase is stably low, needs less trigger).
   */
  function getCollapseThreshold() {
    return clamp(0.015 + phaseFloorControllerVolatilityEma * 0.5, 0.01, 0.04);
  }

  /**
   * Derive the low-share tracking threshold (default 0.03) from share EMA.
   * Adapts to the phase share's natural operating range.
   */
  function getLowShareThreshold() {
    const fairShare = 1.0 / 6.0;
    // R17 E1: Raised threshold 0.06->0.12 to match computeBoosts widening.
    // Ensures the lowShareThreshold formula also responds to moderate
    // phase deficit, not just extreme collapse.
    const persistentLowSharePressure = clamp((0.12 - phaseFloorControllerShareEma) / 0.12, 0, 1);
    // R5 E3: Add fair-share-relative floor to prevent adaptive threshold from
    // decaying below moderate-suppression detection. Without this, shareEma *
    // 0.45 tracks the declining share downward, creating a self-reinforcing
    // blind spot: phase drops -> EMA drops -> threshold drops -> controller
    // never fires -> phase drops further.
    // R8 E1: Raised anchor from fairShare * 0.65 (0.108) to fairShare * 0.80
    // (0.133) and upper clamp from 0.12 to 0.14. Phase at 0.132 was in a
    // blind zone: above the 0.108 threshold but well below fair share (0.167).
    // The controller never fired, allowing chronic mid-suppression. The new
    // anchor detects shares below ~80% of fair share; the raised clamp allows
    // the threshold to reach the necessary level.
    // R27 E4: Raised anchor from 0.80 to 0.85 (0.1417). Phase slipped from
    // 0.152 to 0.143 in R26. The 0.133 anchor was too low to trigger support
    // when phase is in the 0.14-0.15 range. New 0.1417 anchor provides
    // earlier intervention to prevent phase from drifting below 0.14.
    // R28 E2: Raised upper clamp from 0.14 to 0.16. Phase continued to
    // slip to 0.128 despite raised anchor. The 0.14 ceiling prevented the
    // threshold from reaching the needed level. With clamp at 0.16, the
    // adaptive formula can output thresholds up to 0.16, firing when
    // phase shares drop below ~15% of fair share.
    return clamp(
      m.max(getCollapseThreshold() + 0.010, phaseFloorControllerShareEma * 0.45, 0.04 + persistentLowSharePressure * 0.030, fairShare * 0.85),
      0.02, 0.16
    );
  }

  /**
   * Derive streak thresholds from coherent regime duration.
   * Longer coherent streaks -> lower streak threshold (faster response needed).
   * Short coherent streaks -> higher threshold (more patience before boosting).
   */
  function getFloorActivationStreak() {
    // Base: 12 beats. Range: [6, 20].
    const coherentPressure = clamp((phaseFloorControllerCoherentStreakEma - 20) / 40, 0, 1);
    const persistentLowSharePressure = clamp((0.05 - phaseFloorControllerShareEma) / 0.05, 0, 1);
    // When coherent streaks are long (>40), activate faster (fewer beats)
    return m.round(clamp(10 - coherentPressure * 8 - persistentLowSharePressure * 6, 4, 16));
  }

  function getExtremeCollapseStreak() {
    // Base: 8 beats. Range: [4, 14].
    // Scale with floor activation -- always below floor threshold.
    return m.round(clamp(getFloorActivationStreak() * 0.6, 4, 14));
  }

  function getEscalatedBoostStreak() {
    // Base: 20 beats. Range: [12, 30].
    // Scale proportionally to floor activation streak.
    return m.round(clamp(getFloorActivationStreak() * 1.6, 12, 30));
  }

  /**
   * Derive graduated boost multiplier from deficit severity and recovery history.
   * Replaces hardcoded 4.0/6.0/8.0/12.0/20.0 with a continuous formula.
   *
   * @param {number} share - current phase share
   * @param {number} phaseLowShareStreak - how many consecutive beats below low-share threshold
   * @param {number} phaseCollapseStreak - how many consecutive beats below collapse threshold
   * @returns {{ phaseCollapseBoost: number, phaseFloorBoost: number }}
   */
  function computeBoosts(share, phaseLowShareStreak, phaseCollapseStreak) {
    const fairShare = 1.0 / 6.0;
    const deficitRatio = clamp((fairShare - share) / fairShare, 0, 1);
    // R17 E1: Raised persistent threshold 0.05->0.10 and severe threshold
    // 0.06->0.12. Phase at 0.101 gave zero contribution from both terms
    // (both below their thresholds). Wider detection catches moderate
    // deficit (8-12% share range) and strengthens the boost formula.
    // R23 E5: 0.10->0.13. R73 E5: 0.13->0.14. Phase at 0.130 gives
    // zero pressure at 0.13. Raising to 0.14 detects the current deficit
    // (pressure ~0.07 at shareEma=0.13), enabling earlier boost activation.
    const persistentLowSharePressure = clamp((0.14 - phaseFloorControllerShareEma) / 0.14, 0, 1);
    const severeLowSharePressure = clamp((0.12 - share) / 0.12, 0, 1);
    // Recovery success dampens boost (if previous boosts recovered phase, be less aggressive)
    // Recovery failure amplifies boost (if previous boosts didn't work, push harder)
    const recoveryFactor = clamp(2.2 - phaseFloorControllerRecoverySuccessEma * 1.5 + persistentLowSharePressure * 0.55, 1.0, 2.6);

    // E4 (R100): Phase-aware boost scaling from orchestrator system phase
    // When oscillating, dampen boosts to avoid amplifying instability
    // When stabilized, reduce boost urgency since system is healthy
    const systemPhase = safePreBoot.call(() => hyperMetaOrchestrator.getSystemPhase(), 'converging') || 'converging';
    const phaseScaling = systemPhase === 'oscillating' ? 0.6
      : systemPhase === 'stabilized' ? 0.85
      : 1.0;

    // Phase collapse boost: when share < collapseThreshold AND streak > 8 -> stronger
    // Base range: [3.0, 8.0]. Graduates with streak duration.
    const collapseStreakFactor = clamp((phaseCollapseStreak - 4) / 12, 0, 1);
    const phaseCollapseBoost = clamp(3.5 + collapseStreakFactor * 5.5 * recoveryFactor * phaseScaling, 3.5, 11.0);

    // Phase floor boost: graduated from streak duration and deficit severity
    // Replaces the 8.0/12.0/20.0 step-function with continuous curve
    const floorStreak = getFloorActivationStreak();
    const escalatedStreak = getEscalatedBoostStreak();

    let phaseFloorBoost = 1.0;
    if (phaseLowShareStreak > floorStreak) {
      const streakDepth = clamp((phaseLowShareStreak - floorStreak) / m.max(1, escalatedStreak - floorStreak), 0, 1);
      // Base boost range: [6.0, 14.0] graduated by streak depth
      const baseBoost = 8.0 + streakDepth * 10.0 + persistentLowSharePressure * 4.0;
      phaseFloorBoost = clamp(baseBoost * (deficitRatio * 0.75 + severeLowSharePressure * 0.55) * recoveryFactor * phaseScaling, 6.0, 22.0);
    }

    // Extreme collapse: share < 1% -- emergency override
    // E1: boost ceiling managed by hyperMetaOrchestrator (#17)
    if (share < getExtremeCollapseShare() && phaseLowShareStreak > getExtremeCollapseStreak()) {
      const boostCeiling = safePreBoot.call(() => hyperMetaOrchestrator.getPhaseBoostCeiling(), 25.0) || 25.0;
      phaseFloorBoost = clamp(14.0 + deficitRatio * 10.0 * recoveryFactor * phaseScaling, 14.0, boostCeiling);
    }

    return { phaseCollapseBoost, phaseFloorBoost };
  }

  /**
   * Derive extreme collapse share threshold from share EMA.
   * Default ~0.01. When phase is typically very low, threshold adapts.
   */
  function getExtremeCollapseShare() {
    return clamp(m.min(0.01, phaseFloorControllerShareEma * 0.08), 0.005, 0.02);
  }

  /**
   * Check whether phase floor is active.
   * @param {number} phaseLowShareStreak
   * @returns {boolean}
   */
  function isFloorActive(phaseLowShareStreak) {
    return phaseLowShareStreak > getFloorActivationStreak();
  }

  /**
   * Check whether extreme collapse is active.
   * @param {number} share
   * @param {number} phaseLowShareStreak
   * @returns {boolean}
   */
  function isExtremeCollapse(share, phaseLowShareStreak) {
    return share < getExtremeCollapseShare() && phaseLowShareStreak > getExtremeCollapseStreak();
  }

  // TICK: called each beat via conductor recorder
  function tick() {
    phaseFloorControllerBeatCount++;

    const energyData = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    if (!energyData || !energyData.shares) return;

    const share = typeof energyData.shares.phase === 'number' ? energyData.shares.phase : 0.1667;

    // Track volatility: |delta| of share from beat to beat
    const delta = m.abs(share - phaseFloorControllerLastShare);
    phaseFloorControllerVolatilityEma += (delta - phaseFloorControllerVolatilityEma) * _VOLATILITY_EMA_ALPHA;
    phaseFloorControllerShareEma += (share - phaseFloorControllerShareEma) * _SHARE_EMA_ALPHA;
    phaseFloorControllerLastShare = share;

    // Track coherent regime streak length
    const regime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'initializing');
    if (regime === 'coherent') {
      phaseFloorControllerCurrentCoherentStreak++;
    } else {
      if (phaseFloorControllerCurrentCoherentStreak > 0) {
        phaseFloorControllerCoherentStreakEma +=
          (phaseFloorControllerCurrentCoherentStreak - phaseFloorControllerCoherentStreakEma) * _COHERENT_STREAK_EMA_ALPHA;
      }
      phaseFloorControllerCurrentCoherentStreak = 0;
    }

    // Track recovery success: did a previous boost actually recover phase share?
    if (phaseFloorControllerLastBoostApplied > 1.0 && share > getLowShareThreshold()) {
      // Boost was applied and phase recovered -- success
      phaseFloorControllerRecoverySuccessEma += (1.0 - phaseFloorControllerRecoverySuccessEma) * _RECOVERY_EMA_ALPHA;
    } else if (phaseFloorControllerLastBoostApplied > 1.0 && share < getCollapseThreshold()) {
      // Boost was applied but phase still collapsed -- failure
      phaseFloorControllerRecoverySuccessEma += (0.0 - phaseFloorControllerRecoverySuccessEma) * _RECOVERY_EMA_ALPHA;
    }
  }

  /**
   * Record the boost that was actually applied this beat (for recovery tracking).
   * Called by axisEnergyEquilibratorAxisAdjustments after computing boost.
   * @param {number} boost
   */
  function recordBoostApplied(boost) {
    phaseFloorControllerLastBoostApplied = boost;
  }

  function getSnapshot() {
    return {
      shareEma: phaseFloorControllerShareEma,
      volatilityEma: phaseFloorControllerVolatilityEma,
      coherentStreakEma: phaseFloorControllerCoherentStreakEma,
      recoverySuccessEma: phaseFloorControllerRecoverySuccessEma,
      collapseThreshold: getCollapseThreshold(),
      lowShareThreshold: getLowShareThreshold(),
      floorActivationStreak: getFloorActivationStreak(),
      extremeCollapseStreak: getExtremeCollapseStreak(),
      escalatedBoostStreak: getEscalatedBoostStreak(),
      extremeCollapseShare: getExtremeCollapseShare(),
      beatCount: phaseFloorControllerBeatCount
    };
  }

  function reset() {
    // Preserve EMAs across sections (they carry inter-section learning)
    phaseFloorControllerCurrentCoherentStreak = 0;
    phaseFloorControllerLastBoostApplied = 0;
  }

  // SELF-REGISTRATION
  conductorIntelligence.registerRecorder('phaseFloorController', tick);
  conductorIntelligence.registerStateProvider('phaseFloorController', () => ({
    phaseFloorController: getSnapshot()
  }));
  conductorIntelligence.registerModule('phaseFloorController', { reset }, ['section']);

  return {
    getCollapseThreshold,
    getLowShareThreshold,
    getFloorActivationStreak,
    getExtremeCollapseStreak,
    getEscalatedBoostStreak,
    getExtremeCollapseShare,
    computeBoosts,
    isFloorActive,
    isExtremeCollapse,
    recordBoostApplied,
    getSnapshot,
    reset
  };
})();
