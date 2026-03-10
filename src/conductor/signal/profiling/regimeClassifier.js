// regimeClassifier.js - Regime classification facade with hysteresis state.

regimeClassifier = (() => {
  const V = validator.create('regimeClassifier');
  const regimeClassifierConfig = {
    REGIME_WINDOW: 5,
    REGIME_MAJORITY: 3,
    OSCILLATING_CURVATURE_DEFAULT: 0.55,
    EVOLVING_MAX_DWELL: 150,
    COHERENT_MAX_DWELL: 120,
    POST_FORCED_RECOVERY_WINDOW: 24,
    COHERENT_MOMENTUM_WINDOW: 8,
    REGIME_TARGET_COHERENT_LO: 0.15,
    REGIME_TARGET_COHERENT_HI: 0.35,
    REGIME_TARGET_EVOLVING_LO: 0.14,
    REGIME_SCALE_NUDGE: 0.006,
    REGIME_SCALE_MIN: 0.55,
    REGIME_SCALE_MAX: 1.20,
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
      oscillatingCurvatureThreshold: regimeClassifierConfig.OSCILLATING_CURVATURE_DEFAULT,
      coherentThresholdScale: 0.65,
      evolvingBeats: 0,
      evolvingMinDwell: 4,
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
      evolvingProximityBonus: 0,
      coherentMomentumBeats: 0,
      coherentShareAlphaMin: 0.025,
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
  * @returns {{ gap: number, couplingStrength: number, coherentThreshold: number, velocity: number, velThreshold: number, thresholdScale: number, velocityBlocked: boolean, exploringBlock: string, coherentBlock: string, evolvingBeats: number, coherentBeats: number, runCoherentBeats: number, maxCoherentBeats: number, runBeatCount: number, runTickCount: number, runCoherentShare: number, runTransitionCount: number, forcedBreakCount: number, forcedRegime: string, forcedRegimeBeatsRemaining: number, forcedOverrideActive: boolean, forcedOverrideBeats: number, lastForcedReason: string, lastForcedTriggerStreak: number, lastForcedTriggerBeat: number, lastForcedTriggerTick: number, postForcedRecoveryBeats: number, tickSource: string, rawRegimeCounts: Record<string, number>, runRawRegimeCounts: Record<string, number>, rawRegimeMaxStreak: Record<string, number>, runResolvedRegimeCounts: Record<string, number>, effectiveDim: number, cadenceMonopolyPressure: number, cadenceMonopolyActive: boolean, cadenceMonopolyReason: string, rawExploringShare: number, rawEvolvingShare: number, rawNonCoherentOpportunityShare: number, resolvedNonCoherentShare: number, opportunityGap: number }}
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

  return { classify, resolve, grade, setOscillatingThreshold, getOscillatingThreshold, setCoherentThresholdScale, setCoherentShareAlphaMin, setEvolvingMinDwell, getExploringBeats, getLastRegime, getTransitionReadiness, consumeForcedTransitionEvent, reset };
})();
