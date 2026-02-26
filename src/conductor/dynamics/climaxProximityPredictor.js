// src/conductor/climaxProximityPredictor.js - Multi-signal climax prediction.
// Combines energy momentum, register pressure, density, and tension trends
// to predict when a climax is approaching, occurring, or spent.
// Pure query API — prepares density/register/dynamics ramp before peaks.

climaxProximityPredictor = (() => {
  // Beat-level cache: predict() queries 4 external modules but is called twice
  // per beat (via getDensityRampBias + getTensionBias).
  const _cache = beatCache.create(() => _predict());

  /**
   * Predict climax proximity from multiple conductor signals (cached per beat).
   * @returns {{ proximity: number, phase: string, premature: boolean, density: number, tension: number }}
   */
  function predict() { return _cache.get(); }

  /** @private */
  function _predict() {
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
   * Continuous ramp from proximity 0→1.0:
   *   0→0.3 = normal (1.0), 0.3→0.5 = building (ramp to 1.08),
   *   0.5→0.75 = approaching (ramp to 1.15), 0.75→1.0 = climax (ramp to 1.2).
   * Receding (falling energy) pulls back proportionally.
   * @returns {number} - 0.85 to 1.25
   */
  function getDensityRampBias() {
    const pred = predict();
    if (pred.premature) return 0.9;
    if (pred.phase === 'receding') {
      // Pull back proportional to how far proximity has dropped
      return 1.0 - clamp((1.0 - pred.proximity) * 0.24, 0, 0.12);
    }
    // Continuous ramp: proximity 0.3→1.0 maps to bias 1.0→1.2
    if (pred.proximity <= 0.3) return 1.0;
    return 1.0 + clamp((pred.proximity - 0.3) / 0.7, 0, 1) * 0.2;
  }

  /**
   * Get a tension bias based on climax proximity.
   * Continuous ramp: proximity 0.5→1.0 maps to 1.0→1.15.
   * Premature climax suppresses to 0.8.
   * @returns {number} - 0.8 to 1.2
   */
  function getTensionBias() {
    const pred = predict();
    if (pred.premature) return 0.8;
    // Ramp: proximity 0.5→1.0 → bias 1.0→1.15
    if (pred.proximity <= 0.5) return 1.0;
    return 1.0 + clamp((pred.proximity - 0.5) / 0.5, 0, 1) * 0.15;
  }

  conductorIntelligence.registerDensityBias('climaxProximityPredictor', () => climaxProximityPredictor.getDensityRampBias(), 0.85, 1.25);
  conductorIntelligence.registerTensionBias('climaxProximityPredictor', () => climaxProximityPredictor.getTensionBias(), 0.8, 1.2);

  return {
    predict,
    getDensityRampBias,
    getTensionBias
  };
})();
