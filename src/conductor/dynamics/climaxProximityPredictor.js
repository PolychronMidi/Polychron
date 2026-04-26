// src/conductor/climaxProximityPredictor.js - Multi-signal climax prediction.
// Combines energy momentum, register pressure, density, and tension trends
// to predict when a climax is approaching, occurring, or spent.
// Pure query API - prepares density/register/dynamics ramp before peaks.

moduleLifecycle.declare({
  name: 'climaxProximityPredictor',
  subsystem: 'conductor',
  deps: [],
  provides: ['climaxProximityPredictor'],
  init: () => {
  // Beat-level cache: predict() queries 4 external modules but is called twice
  // per beat (via getDensityRampBias + getTensionBias).
  const climaxProximityPredictorCache = beatCache.create(() => climaxProximityPredictorPredict());

  /**
   * Predict climax proximity from multiple conductor signals (cached per beat).
   * @returns {{ proximity: number, phase: string, premature: boolean, density: number, tension: number }}
   */
  function predict() { return climaxProximityPredictorCache.get(); }

  /** @private */
  function climaxProximityPredictorPredict() {
    // Gather signals with safe fallbacks
    const energyMomentum = energyMomentumTracker.getMomentum();

    const registerProfile = registerPressureMonitor.getPressureSignal();

    const onsetProfile = onsetDensityProfiler.getDensityBias();

    const currentTension = harmonicContext.getField('tension');

    // Compute composite climax proximity (0-1)
    let climaxSignal = 0;

    // Rising energy momentum contributes strongly
    if (energyMomentum.trend === 'rising') climaxSignal += 0.3 + clamp(energyMomentum.momentum * 2, 0, 0.2);
    // High register pressure = nearing ceiling
    if (registerProfile.highPressure) climaxSignal += 0.15;
    // High density = buildup
    if (onsetProfile > 1.1) climaxSignal += 0.1;
    // High tension
    climaxSignal += currentTension * 0.25;
    // R67 E3: Section-progress awareness. Add a section position component
    // so climax prediction engages earlier in later sections (where musical
    // peaks are more likely). This activates the density ramp (up to 1.3x)
    // and tension ramp (up to 1.25x) that are currently dormant because
    // proximity rarely exceeds 0.3. Section progress * 0.12 max contribution.
    const sectionProg = clamp(timeStream.compoundProgress('section'), 0, 1);
    climaxSignal += sectionProg * 0.12;

    const proximity = clamp(climaxSignal, 0, 1);

    // Determine phase
    let phase = 'normal';
    if (proximity > 0.75) phase = 'climax';
    else if (proximity > 0.5) phase = 'approaching';
    else if (proximity > 0.3) phase = 'building';
    else if (energyMomentum.trend === 'falling') phase = 'receding';

    // Premature climax: high proximity early in energy arc without sustained build
    const premature = phase === 'climax' && energyMomentum.plateauDuration < 2;

    return {
      proximity,
      phase,
      premature,
      density: clamp(onsetProfile, 0, 2),
      tension: currentTension
    };
  }

  /**
   * Get a density ramp bias based on climax proximity.
   * Continuous ramp from proximity 0-1.0:
   *   0-0.3 = normal (1.0), 0.3-0.5 = building (ramp to 1.08),
   *   0.5-0.75 = approaching (ramp to 1.15), 0.75-1.0 = climax (ramp to 1.2).
   * Receding (falling energy) pulls back proportionally.
   * @returns {number} - 0.82 to 1.35
   */
  function getDensityRampBias() {
    const pred = predict();
    if (pred.premature) return 0.9;
    if (pred.phase === 'receding') {
      // R68 E4: Moderate the pullback from R26 E4's deep values (0.36/0.18)
      // back toward the original (0.24/0.12). R67 showed S4 tension
      // collapsing to 0.35. The receding pullback over-suppresses density
      // in late sections, which starves the tension signal chain.
      // New min density: 0.88 (was 0.82).
      return 1.0 - clamp((1.0 - pred.proximity) * 0.24, 0, 0.12);
    }
    // R27 E3: Boosted climax ceiling from 1.2 to 1.3 for more dramatic peaks
    if (pred.proximity <= 0.3) return 1.0;
    return 1.0 + clamp((pred.proximity - 0.3) / 0.7, 0, 1) * 0.3;
  }

  /**
   * Get a tension bias based on climax proximity.
   * R26 E1: Widened from 15% to 25% swing with earlier onset (0.4 vs 0.5)
   * for more dramatic climax tension arc.
   * Continuous ramp: proximity 0.4-1.0 maps to 1.0-1.25.
   * Premature climax suppresses to 0.8.
   * @returns {number} - 0.8 to 1.3
   */
  function getTensionBias() {
    const pred = predict();
    if (pred.premature) return 0.8;
    // R17 E4: Post-climax tension receding. When energy is falling, pull
    // tension back to create valleys after peaks. Previously only density
    // had receding handling; tension stayed elevated after peaks, driving
    // TF/TE exceedance (32+30 beats in R16).
    // R32 E4: Reduce max pullback 0.10->0.06. R74 E3: Section-position-aware
    // receding. In the back half of sections (Q3/Q4 territory), suppress
    // the receding pullback so tension sustains through late passages.
    // Multiple peaks per section compound the pullback, creating the
    // Q3 0.765->0.643 collapse. Structural gating replaces constant tweaking.
    if (pred.phase === 'receding') {
      const secProg = clamp(timeStream.compoundProgress('section'), 0, 1);
      const lateProtection = clamp((secProg - 0.50) / 0.30, 0, 1);
      const recedingMax = 0.06 * (1 - lateProtection * 0.75);
      return 1.0 - clamp((1.0 - pred.proximity) * 0.20, 0, recedingMax);
    }
    // R9 E3: Lowered onset from 0.4 to 0.25 to engage tension boost 60%
    // earlier in the buildup. Opening tension arc dropped 0.736 to 0.648 in
    // R8. Earlier engagement creates steeper opening arcs by ramping tension
    // bias during the building phase instead of waiting for approaching.
    // R19 E3: Raised ceiling from 0.25 to 0.30 multiplier (max 1.30).
    // Fills the gap between the 1.25 ceiling and 1.30 registration bound.
    // Combined with E1 (higher building target) creates more dramatic peaks.
    if (pred.proximity <= 0.25) return 1.0;
    return 1.0 + clamp((pred.proximity - 0.25) / 0.75, 0, 1) * 0.30;
  }

  conductorIntelligence.registerDensityBias('climaxProximityPredictor', () => climaxProximityPredictor.getDensityRampBias(), 0.82, 1.35);
  conductorIntelligence.registerTensionBias('climaxProximityPredictor', () => climaxProximityPredictor.getTensionBias(), 0.8, 1.3);

  function reset() {}
  conductorIntelligence.registerModule('climaxProximityPredictor', { reset }, ['section']);

  return {
    predict,
    getDensityRampBias,
    getTensionBias
  };
  },
});
