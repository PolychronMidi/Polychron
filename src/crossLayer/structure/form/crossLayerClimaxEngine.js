// src/crossLayer/crossLayerClimaxEngine.js - Multi-parameter climax coordination.
// Detects and orchestrates climax moments across both layers.
// When section progress, interaction heat, and conductor intensity all converge
// above thresholds, coordinates a unified climactic build:
// increases density, widens register, boosts velocity, raises entropy target.

crossLayerClimaxEngine = (() => {
  const V = validator.create('crossLayerClimaxEngine');
  const APPROACH_THRESHOLD = 0.65;
  const PEAK_THRESHOLD = 0.82;
  const SMOOTHING = 0.25;

  // Pressure detection
  const PRESSURE_ONSET = 0.9;
  const PRESSURE_RANGE = 0.6;

  // Conductor intensity blend
  const COMPOSITE_WEIGHT = 0.6;
  const DENSITY_PRESSURE_WEIGHT = 0.2;
  const TENSION_PRESSURE_WEIGHT = 0.2;

  // Composite climax signal weights
  const ARC_WEIGHT = 0.25;
  const CONDUCTOR_WEIGHT = 0.3;
  const HEAT_WEIGHT = 0.2;
  const INTENT_WEIGHT = 0.25;

  // Climax modifiers
  // R22: Play boost 0.35->0.12 -- climax intensity through velocity/register, not
  // more notes. +35% playProb compounded with already-dense Q3 causing aural overload.
  const MAX_PLAY_BOOST = 0.12;
  const MAX_VELOCITY_BOOST = 0.25;
  const MAX_REGISTER_WIDEN = 6;
  const ENTROPY_BASE = 0.5;
  // R22: Entropy boost 0.4->0.22 -- coherent climax should be focused, not frenzied.
  // Peak target: 0.5+0.22*0.85=0.69 (was 0.84).
  const ENTROPY_BOOST = 0.22;
  // R94 E3: Regime-responsive climax entropy scaling. During exploring,
  // climax approach injects more entropy variance (boosting entropy axis
  // share which collapsed 0.193->0.114 in R93). During coherent, reduce
  // entropy injection to preserve unified texture. Regime multiplier
  // scales the ENTROPY_BOOST: exploring 1.35x (0.54), coherent 0.85x (0.34).
  const CLIMAX_ENTROPY_REGIME_SCALE = { exploring: 1.35, evolving: 1.20, coherent: 0.85 };

  let smoothedClimax = 0;
  let peakReached = false;
  let climaxCount = 0;
  let climaxPlayAllowance = 1;
  // R23 E2: Density-aware playProb -- when already dense, climax adds velocity/register, not notes.
  let lastDensity = 0.5;

  // R28 E1: Density-pressure homeostasis. Self-regulating accumulator builds
  // pressure when output density is sustained high during climax, reducing
  // play/entropy boost proportionally. Same architecture as cadenceAlignment
  // tension-accumulation (R25 E1). Prevents aural crowding at peaks without
  // static tension gates. Regime-aware: coherent gets more relief (needs less
  // chaos at peaks), exploring gets none (preserve searching energy).
  const DENSITY_SATURATION_BEATS = 40;
  const DENSITY_HIGH_THRESHOLD = 0.62;
  // exploring gets relief too -- unlike tension-accumulation where exploring's 0.80
  // threshold was correctly calibrated (R79 E2), density crowding is worst in exploring
  // at high tension because all four climax dimensions stack up simultaneously.
  const DENSITY_PRESSURE_RELIEF = { exploring: 0.15, evolving: 0.12, coherent: 0.20 };
  let densityPressureAccum = 0;

  /**
   * Tick the climax detector each beat.
   * @param {number} absoluteSeconds
   */
  function tick(absoluteSeconds) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    // Gather signals
    const sectionProgress = clamp(timeStream.compoundProgress('section'), 0, 1);
    const sectionIndex = timeStream.getPosition('section');
    const totalSections = timeStream.getBounds('section');
    const journeyProgress = totalSections > 1 ? sectionIndex / (totalSections - 1) : 1;
    const longFormPressure = clamp(totalSections - 4, 0, 1);
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const sectionArc = m.sin(m.pow(sectionProgress, 1.2) * m.PI);
    const earlySectionDamp = 1 - clamp((0.35 - sectionProgress) / 0.35, 0, 1) * 0.20;
    const preClimaxHold = 1 - longFormPressure * clamp((0.62 - journeyProgress) / 0.62, 0, 1) * 0.22 * (1 - lowPhasePressure * 0.75);
    climaxPlayAllowance = 1 - longFormPressure * clamp((0.68 - journeyProgress) / 0.68, 0, 1) * 0.30 * (1 - lowPhasePressure * 0.75);

    const sigs = conductorSignalBridge.getSignals();
    lastDensity = sigs.density;
    // R28 E1: accumulate density pressure when sustained high during climax
    if (lastDensity > DENSITY_HIGH_THRESHOLD && smoothedClimax >= APPROACH_THRESHOLD) {
      densityPressureAccum = m.min(densityPressureAccum + 1, DENSITY_SATURATION_BEATS);
    } else {
      densityPressureAccum = m.max(0, densityPressureAccum - 0.5);
    }
    // Blend compositeIntensity with elevated density/tension products for richer peak detection
    const densityPressure = clamp((sigs.density - PRESSURE_ONSET) / PRESSURE_RANGE, 0, 1);
    const tensionPressure = clamp((sigs.tension - PRESSURE_ONSET) / PRESSURE_RANGE, 0, 1);
    const conductorIntensity = clamp((sigs.compositeIntensity * COMPOSITE_WEIGHT + densityPressure * DENSITY_PRESSURE_WEIGHT + tensionPressure * TENSION_PRESSURE_WEIGHT) * earlySectionDamp, 0, 1);

    const heatLevel = clamp(interactionHeatMap.getDensity(), 0, 1);

    const intent = sectionIntentCurves.getLastIntent();
    const intentPressure = (intent.densityTarget + intent.interactionTarget) / 2;

    // Harmonic excursion boost: distant keys amplify climax
    const harmonicEntry = L0.getLast('harmonic', { layer: 'both' });
    const excursionBoost = harmonicEntry && Number.isFinite(harmonicEntry.excursion) ? clamp(harmonicEntry.excursion * 0.02, 0, 0.1) : 0;

    // Composite climax signal
    const raw = (sectionArc * ARC_WEIGHT + conductorIntensity * CONDUCTOR_WEIGHT + heatLevel * HEAT_WEIGHT + intentPressure * INTENT_WEIGHT + excursionBoost) * preClimaxHold;
    smoothedClimax = smoothedClimax * (1 - SMOOTHING) + raw * SMOOTHING;

    // Detect peak crossing
    if (smoothedClimax >= PEAK_THRESHOLD && !peakReached) {
      peakReached = true;
      climaxCount++;
    } else if (smoothedClimax < APPROACH_THRESHOLD) {
      peakReached = false;
    }
  }

  /**
   * Get climax modifiers for a specific layer.
   * @returns {{ playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }}
   */
  function getModifiers(/* layer */) {
    if (smoothedClimax < APPROACH_THRESHOLD) {
      return { playProbScale: 1.0, velocityScale: 1.0, registerBias: 0, entropyTarget: -1 };
    }

    // Approaching or at climax: scale parameters
    const intensity = clamp((smoothedClimax - APPROACH_THRESHOLD) / (1 - APPROACH_THRESHOLD), 0, 1);

    // R94 E3: Scale entropy boost by regime
    const regimeSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const climaxRegime = regimeSnap ? regimeSnap.regime : 'evolving';
    const entropyRegimeScale = V.optionalFinite(CLIMAX_ENTROPY_REGIME_SCALE[climaxRegime], 1.0);

    // R23 E2: Density-aware play boost -- when already dense (>0.55), climax
    // intensity shifts to velocity/register rather than adding more notes.
    const densityScale = clamp((lastDensity - 0.55) / 0.35, 0, 1);
    // R28 E1: density-pressure homeostasis -- sustained high density during climax
    // self-reduces play/entropy boost. Relief is regime-aware (coherent more, exploring none).
    const dpRelief = V.optionalFinite(DENSITY_PRESSURE_RELIEF[climaxRegime], 0.12);
    const dpPressure = clamp(densityPressureAccum / DENSITY_SATURATION_BEATS, 0, 1);
    const crowdingReduction = dpPressure * dpRelief;
    if (crowdingReduction > 0.01) densityPressureAccum = m.max(0, densityPressureAccum - 0.25);
    return {
      playProbScale: 1.0 + intensity * MAX_PLAY_BOOST * climaxPlayAllowance * (1 - densityScale) * (1 - crowdingReduction),
      velocityScale: 1.0 + intensity * MAX_VELOCITY_BOOST,
      registerBias: intensity * MAX_REGISTER_WIDEN,
      entropyTarget: ENTROPY_BASE + intensity * ENTROPY_BOOST * entropyRegimeScale * (1 - crowdingReduction * 0.5)
    };
  }

  /**
   * Whether the system is currently approaching or at a climax.
   * @returns {boolean}
   */
  function isApproaching() {
    return smoothedClimax >= APPROACH_THRESHOLD;
  }

  /** @returns {boolean} */
  function isPeak() { return peakReached; }

  /** @returns {number} */
  function getClimaxLevel() { return smoothedClimax; }

  /** @returns {number} */
  function getClimaxCount() { return climaxCount; }

  function reset() {
    smoothedClimax = 0;
    peakReached = false;
    climaxCount = 0;
    climaxPlayAllowance = 1;
    lastDensity = 0.5;
    densityPressureAccum = 0;
  }

  return { tick, getModifiers, isApproaching, isPeak, getClimaxLevel, getClimaxCount, reset };
})();
crossLayerRegistry.register('crossLayerClimaxEngine', crossLayerClimaxEngine, ['all', 'section']);
