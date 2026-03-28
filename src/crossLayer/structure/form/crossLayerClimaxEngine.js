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
  const MAX_PLAY_BOOST = 0.35;
  const MAX_VELOCITY_BOOST = 0.25;
  const MAX_REGISTER_WIDEN = 6;
  const ENTROPY_BASE = 0.5;
  const ENTROPY_BOOST = 0.4;
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
    // Blend compositeIntensity with elevated density/tension products for richer peak detection
    const densityPressure = clamp((sigs.density - PRESSURE_ONSET) / PRESSURE_RANGE, 0, 1);
    const tensionPressure = clamp((sigs.tension - PRESSURE_ONSET) / PRESSURE_RANGE, 0, 1);
    const conductorIntensity = clamp((sigs.compositeIntensity * COMPOSITE_WEIGHT + densityPressure * DENSITY_PRESSURE_WEIGHT + tensionPressure * TENSION_PRESSURE_WEIGHT) * earlySectionDamp, 0, 1);

    const heatLevel = clamp(interactionHeatMap.getDensity(), 0, 1);

    const intent = sectionIntentCurves.getLastIntent();
    const intentPressure = (intent.densityTarget + intent.interactionTarget) / 2;

    // Composite climax signal
    const raw = (sectionArc * ARC_WEIGHT + conductorIntensity * CONDUCTOR_WEIGHT + heatLevel * HEAT_WEIGHT + intentPressure * INTENT_WEIGHT) * preClimaxHold;
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
    const entropyRegimeScale = CLIMAX_ENTROPY_REGIME_SCALE[climaxRegime] || 1.0;

    return {
      playProbScale: 1.0 + intensity * MAX_PLAY_BOOST * climaxPlayAllowance,
      velocityScale: 1.0 + intensity * MAX_VELOCITY_BOOST,
      registerBias: intensity * MAX_REGISTER_WIDEN,
      entropyTarget: ENTROPY_BASE + intensity * ENTROPY_BOOST * entropyRegimeScale
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
  }

  return { tick, getModifiers, isApproaching, isPeak, getClimaxLevel, getClimaxCount, reset };
})();
crossLayerRegistry.register('crossLayerClimaxEngine', crossLayerClimaxEngine, ['all', 'section']);
