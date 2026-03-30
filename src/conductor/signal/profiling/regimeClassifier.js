// regimeClassifier.js - Regime classification facade with hysteresis state.

regimeClassifier = (() => {
  const V = validator.create('regimeClassifier');
  const regimeClassifierConfig = {
    REGIME_WINDOW: 5,
    REGIME_MAJORITY: 3,
    // Lab R3: 0.15 sounded good/tense. Lower from 0.55->0.40.
    OSCILLATING_CURVATURE_DEFAULT: 0.40,
    EVOLVING_MAX_DWELL_SEC: 125,
    COHERENT_MAX_DWELL_SEC: 62,
    // Lab R1: Exploring more interesting than coherent, allowed for longer blocks
    EXPLORING_MAX_DWELL_SEC: 180,
    POST_FORCED_RECOVERY_SEC: 20,
    COHERENT_MOMENTUM_SEC: 7,
    // Legacy beat-based values kept for reference but _SEC versions are authoritative
    EVOLVING_MAX_DWELL: 150,
    COHERENT_MAX_DWELL: 75,
    POST_FORCED_RECOVERY_WINDOW: 24,
    COHERENT_MOMENTUM_WINDOW: 8,
    // Seconds-based dwell thresholds (authoritative for comparisons)
    // Lab R1: Coherent fatigues after 15-30s. Tighten hard cap from 31->28.
    COHERENT_HARD_CAP_SEC: 28,
    COHERENT_FLOOR_HIGH_SEC: 40,
    COHERENT_FLOOR_LOW_SEC: 30,
    STARVATION_EXPLORING_SEC: 6.6,
    STARVATION_COHERENT_SEC: 12.5,
    EXPLORING_MONOPOLY_FLOOR_SEC: 8.3,
    POST_FORCED_COOLDOWN_SHORT_SEC: 6.6,
    POST_FORCED_COOLDOWN_LONG_SEC: 11.6,
    EXPLORING_FLOOR_BONUS_SEC: 83,
    EXPLORING_DUR_BONUS_UNIT_SEC: 41.5,
    EXPLORING_CONVERGENCE_SEC: 26.6,
    COHERENT_DUR_PENALTY_SEC: 29,
    COHERENT_SATURATION_SEC: 83,
    EVOLVING_MIN_DWELL_DEFAULT_SEC: 8.3,
    EVOLVING_VELOCITY_THRESHOLD_SEC: 83,
    CROSSOVER_MIN_DWELL_SEC: 2.5,
    REGIME_TARGET_COHERENT_LO: 0.10,
    // Lab R1: coherent fatigues, exploring more interesting. Tighten ceiling 0.35->0.33.
    REGIME_TARGET_COHERENT_HI: 0.33,
    // R9 E2: Raised from 0.14 to 0.18.
    // R46 E4: Raise 0.18->0.24. Evolving stuck at 21.4% in R45 with
    // exploring at 40.7%. At 0.18, evolvingDeficit=0 (21.4% > 18%)
    // so all adaptive recovery is dormant (forced breaks go exploring,
    // entry bands narrow, starvation injector off). At 0.24, deficit
    // re-engages: forced breaks choose evolving, entry velocity ceiling
    // widens, and coherent gate relaxes.
    REGIME_TARGET_EVOLVING_LO: 0.27,
    // R85 E3: Expand coherent self-balancer headroom. coherentThresholdScale
    // auto-adjusts to steer coherent share toward [0.10, 0.35] target. At
    // cap 1.20, the balancer maxes out at +20% threshold which is insufficient
    // when coupling strength is inflated (R83 E2 trust velocity amplification
    // added a 6th responsive dimension). R14 E1: Raise cap 1.40->1.65 because
    // scale already at 1.40 (max) but coherent still at 49%. More headroom
    // lets the self-balancer actually correct coherent dominance.
    REGIME_SCALE_NUDGE: 0.012,
    REGIME_SCALE_MIN: 0.55,
    REGIME_SCALE_MAX: 1.65,
    COHERENT_SHARE_ALPHA_INIT: 0.05,
    COHERENT_SHARE_ALPHA_DECAY: 80,
    EXPLORING_MAX_DWELL: 180,
    tickSource: 'profiler-recorder'
  };

  function regimeClassifierCreateState() {
    return {
      V,
      lastRegime: 'evolving',
      rawRegimeWindow: [],
      exploringBeats: 0,
      coherentBeats: 0,
      exploringStartSec: 0,
      coherentStartSec: 0,
      evolvingStartSec: 0,
      oscillatingCurvatureThreshold: regimeClassifierConfig.OSCILLATING_CURVATURE_DEFAULT,
      coherentThresholdScale: 0.65,
      evolvingBeats: 0,
      evolvingMinDwell: 10, // R78 E2: Raised from 8 for longer evolving blocks. 7.8% evolving in R77 but each block is short (6 beats avg). 10-beat minimum creates more musically impactful evolving passages.
      forcedRegime: '',
      forcedRegimeBeatsRemaining: 0,
      forcedBreakCount: 0,
      lastForcedReason: '',
      runMaxCoherentBeats: 0,
      runCoherentBeats: 0,
      runBeatCount: 0,
      runCoherentShare: 0,
      runTransitionCount: 0,
      runLastResolvedRegime: 'evolving',
      lastObservedTickId: 0,
      forcedOverrideActive: false,
      forcedOverrideBeats: 0,
      lastForcedTriggerStreak: 0,
      lastForcedTriggerBeat: 0,
      lastForcedTriggerTick: 0,
      runResolvedRegimeCounts: {},
      forcedTransitionEventSerial: 0,
      pendingForcedTransitionEvent: null,
      cadenceMonopolyPressure: 0,
      cadenceMonopolyActive: false,
      cadenceMonopolyReason: '',
      postForcedRecoveryBeats: 0,
      postForcedCooldown: 0,
      evolvingProximityBonus: 0,
      coherentMomentumBeats: 0,
      postForcedRecoveryEndSec: 0,
      postForcedCooldownEndSec: 0,
      coherentMomentumEndSec: 0,
      evolvingMinDwellSec: 8.3,
      coherentShareAlphaMin: 0.035, // Lab R1: fast-trust confirmed good, raised from 0.025
      coherentShareEma: 0.25,
      lastClassifyInputs: {
        couplingStrength: 0,
        coherentThreshold: 0,
        evolvingProximityBonus: 0,
        velocity: 0,
        velThreshold: 0.008,
        effectiveDim: 0,
        cadenceMonopolyPressure: 0,
        rawExploringShare: 0,
        rawEvolvingShare: 0,
        rawNonCoherentOpportunityShare: 0,
        resolvedNonCoherentShare: 0,
        opportunityGap: 0
      },
      highDimVelStreak: 0,
      dimEma: 3.0,
      dimStdEma: 0.3,
      velocityEma: 0.05,
      velocityStdEma: 0.02,
      coherentBlockStreak: 0,
      rawRegimeCounts: {},
      runRawRegimeCounts: {},
      rawRegimeMaxStreak: {},
      rawStreakRegime: '',
      rawStreakCount: 0
    };
  }

  const regimeClassifierState = regimeClassifierCreateState();

  function setOscillatingThreshold(threshold) {
    regimeClassifierState.oscillatingCurvatureThreshold = V.requireFinite(threshold, 'threshold');
  }

  /**
   * Set profile-adaptive coherent entry threshold scale.
   * Values < 1.0 make coherent regime easier to enter.
   * @param {number} scale
   */
  function setCoherentThresholdScale(scale) {
    regimeClassifierState.coherentThresholdScale = V.requireFinite(scale, 'coherentThresholdScale');
  }

  /**
   * R21 E3: Set profile-adaptive coherent share alpha floor.
   * Higher values = faster EMA convergence = quicker saturation penalty.
   * explosive: 0.04 (~25-beat horizon), atmospheric: 0.02 (~50-beat),
   * default: 0.025 (~40-beat).
   * @param {number} alphaMin
   */
  function setCoherentShareAlphaMin(alphaMin) {
    regimeClassifierState.coherentShareAlphaMin = V.requireFinite(alphaMin, 'alphaMin');
  }

  /**
   * R22 E4 / R24 E1: Set profile-adaptive evolving minimum dwell time.
   * Prevents premature evolving->coherent transitions.
   * explosive: 4, atmospheric: 6, default: 4.
   * @param {number} minDwell
   */
  function setEvolvingMinDwell(minDwell) {
    regimeClassifierState.evolvingMinDwell = V.requireFinite(minDwell, 'minDwell');
  }

  /** @param {number} sec */
  function setEvolvingMinDwellSec(sec) {
    regimeClassifierState.evolvingMinDwellSec = V.requireFinite(sec, 'evolvingMinDwellSec');
  }

  /** @returns {number} */
  function getOscillatingThreshold() { return regimeClassifierState.oscillatingCurvatureThreshold; }

  /** @returns {number} */
  function getExploringBeats() { return regimeClassifierState.exploringBeats; }

  /** @returns {string} */
  function getLastRegime() { return regimeClassifierState.lastRegime; }

  /**
   * Classify the current operating regime based on velocity and curvature patterns.
   * @param {number} avgVelocity
   * @param {number} avgCurvature
   * @param {number} effectiveDim
   * @param {number} couplingStrength
   * @returns {string}
   */
  function classify(avgVelocity, avgCurvature, effectiveDim, couplingStrength) {
    return regimeClassifierClassification.classify(regimeClassifierState, regimeClassifierConfig, avgVelocity, avgCurvature, effectiveDim, couplingStrength);
  }

  /**
   * @param {string} regime
   * @param {string} reason
   * @param {number} beatsRemaining
   * @param {number} [triggerStreak]
    * @param {number} [triggerTickId]
   */
  function activateForcedRegime(regime, reason, beatsRemaining, triggerStreak, triggerTickId) {
    regimeClassifierResolution.activateForcedRegime(regimeClassifierState, regimeClassifierConfig, regime, reason, beatsRemaining, triggerStreak, triggerTickId);
  }

  /**
   * Align run-level regime telemetry with profiler cadence.
   * systemDynamicsProfiler runs from the recorder path, so profiler ticks are
   * the canonical regime cadence. beatCount is not safe here because it is
   * L1-only and resets on binaural shifts.
   * @param {number} [tickId]
   * @returns {number}
   */
  /**
   * @param {string} rawRegime
   * @param {number} [tickId]
   * @returns {string}
   */
  function resolve(rawRegime, tickId) {
    return /** @type {string} */ (regimeClassifierResolution.resolve(regimeClassifierState, regimeClassifierConfig, rawRegime, tickId, activateForcedRegime));
  }

  /**
   * Grade the trajectory health.
   * @param {string} regime
   * @returns {string}
   */
  function grade(regime) {
    if (regime === 'exploring' || regime === 'coherent' || regime === 'evolving') return 'healthy';
    if (regime === 'drifting' || regime === 'fragmented') return 'strained';
    if (regime === 'oscillating') return 'stressed';
    if (regime === 'stagnant') return 'critical';
    return 'healthy';
  }

  function reset() {
    const fresh = regimeClassifierCreateState();
    const keys = Object.keys(fresh);
    for (let i = 0; i < keys.length; i++) regimeClassifierState[keys[i]] = fresh[keys[i]];
  }

  function consumeForcedTransitionEvent() {
    if (!regimeClassifierState.pendingForcedTransitionEvent) return null;
    const event = Object.assign({}, regimeClassifierState.pendingForcedTransitionEvent);
    regimeClassifierState.pendingForcedTransitionEvent = null;
    return event;
  }

  /**
   * R34 E6: Transition readiness diagnostic. Returns coupling gap (positive =
   * above threshold), velocity status, and whether velocity is the blocking
   * factor. R35 E5: Adds exploring-block diagnostic.
   * R37 E5/E6: Adds effectiveDim and rawRegimeMaxStreak.
  * @returns {{ gap: number, couplingStrength: number, coherentThreshold: number, velocity: number, velThreshold: number, thresholdScale: number, velocityBlocked: boolean, exploringBlock: string, coherentBlock: string, evolvingBeats: number, coherentBeats: number, runCoherentBeats: number, maxCoherentBeats: number, runBeatCount: number, runTickCount: number, runCoherentShare: number, runTransitionCount: number, forcedBreakCount: number, forcedRegime: string, forcedRegimeBeatsRemaining: number, forcedOverrideActive: boolean, forcedOverrideBeats: number, lastForcedReason: string, lastForcedTriggerStreak: number, lastForcedTriggerBeat: number, lastForcedTriggerTick: number, postForcedRecoveryBeats: number, postForcedRecoveryRemainingSec: number, tickSource: string, rawRegimeCounts: Record<string, number>, runRawRegimeCounts: Record<string, number>, rawRegimeMaxStreak: Record<string, number>, runResolvedRegimeCounts: Record<string, number>, effectiveDim: number, cadenceMonopolyPressure: number, cadenceMonopolyActive: boolean, cadenceMonopolyReason: string, rawExploringShare: number, rawEvolvingShare: number, rawNonCoherentOpportunityShare: number, resolvedNonCoherentShare: number, opportunityGap: number }}
   */
  function getTransitionReadiness() {
    return regimeClassifierHelpers.buildTransitionReadiness({
      lastClassifyInputs: regimeClassifierState.lastClassifyInputs,
      coherentThresholdScale: regimeClassifierState.coherentThresholdScale,
      evolvingBeats: regimeClassifierState.evolvingBeats,
      coherentBeats: regimeClassifierState.coherentBeats,
      runCoherentBeats: regimeClassifierState.runCoherentBeats,
      runMaxCoherentBeats: regimeClassifierState.runMaxCoherentBeats,
      runBeatCount: regimeClassifierState.runBeatCount,
      runCoherentShare: regimeClassifierState.runCoherentShare,
      runTransitionCount: regimeClassifierState.runTransitionCount,
      forcedBreakCount: regimeClassifierState.forcedBreakCount,
      forcedRegime: regimeClassifierState.forcedRegime,
      forcedRegimeBeatsRemaining: regimeClassifierState.forcedRegimeBeatsRemaining,
      forcedOverrideActive: regimeClassifierState.forcedOverrideActive,
      forcedOverrideBeats: regimeClassifierState.forcedOverrideBeats,
      lastForcedReason: regimeClassifierState.lastForcedReason,
      lastForcedTriggerStreak: regimeClassifierState.lastForcedTriggerStreak,
      lastForcedTriggerBeat: regimeClassifierState.lastForcedTriggerBeat,
      lastForcedTriggerTick: regimeClassifierState.lastForcedTriggerTick,
      postForcedRecoveryBeats: regimeClassifierState.postForcedRecoveryBeats,
      postForcedRecoveryEndSec: regimeClassifierState.postForcedRecoveryEndSec,
      tickSource: regimeClassifierConfig.tickSource,
      rawRegimeCounts: regimeClassifierState.rawRegimeCounts,
      runRawRegimeCounts: regimeClassifierState.runRawRegimeCounts,
      rawRegimeMaxStreak: regimeClassifierState.rawRegimeMaxStreak,
      runResolvedRegimeCounts: regimeClassifierState.runResolvedRegimeCounts,
      cadenceMonopolyPressure: regimeClassifierState.cadenceMonopolyPressure,
      cadenceMonopolyActive: regimeClassifierState.cadenceMonopolyActive,
      cadenceMonopolyReason: regimeClassifierState.cadenceMonopolyReason,
    });
  }

  return { classify, resolve, grade, setOscillatingThreshold, getOscillatingThreshold, setCoherentThresholdScale, setCoherentShareAlphaMin, setEvolvingMinDwell, setEvolvingMinDwellSec, getExploringBeats, getLastRegime, getTransitionReadiness, consumeForcedTransitionEvent, reset };
})();
