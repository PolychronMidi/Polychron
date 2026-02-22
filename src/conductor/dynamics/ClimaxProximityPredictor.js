// src/conductor/ClimaxProximityPredictor.js - Multi-signal climax prediction.
// Combines energy momentum, register pressure, density, and tension trends
// to predict when a climax is approaching, occurring, or spent.
// Pure query API — prepares density/register/dynamics ramp before peaks.

ClimaxProximityPredictor = (() => {
  // Beat-stamp cache: predict() queries 4 external modules but is called twice
  // per beat (via getDensityRampBias + getTensionBias). Cache on beatCount.
  let _cachedBeat = -1;
  let _cachedPrediction = null;

  /**
   * Predict climax proximity from multiple conductor signals.
   * @returns {{ proximity: number, phase: string, premature: boolean, density: number, tension: number }}
   */
  function predict() {
    const currentBeat = typeof beatCount === 'number' ? beatCount : -1;
    if (currentBeat >= 0 && currentBeat === _cachedBeat && _cachedPrediction) {
      return _cachedPrediction;
    }
    // Gather signals with safe fallbacks
    const energyMomentum = EnergyMomentumTracker.getMomentum();

    const registerProfile = RegisterPressureMonitor.getPressureSignal();

    const onsetProfile = OnsetDensityProfiler.getDensityBias();

    const currentTension = HarmonicContext.getField('tension');

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

    const result = {
      proximity,
      phase,
      premature,
      density: clamp(onsetProfile, 0, 2),
      tension: currentTension
    };
    _cachedBeat = currentBeat;
    _cachedPrediction = result;
    return result;
  }

  /**
   * Get a density ramp bias based on climax proximity.
   * Approaching → boost density for buildup; climax → sustain; receding → pull back.
   * @returns {number} - 0.85 to 1.25
   */
  function getDensityRampBias() {
    const pred = predict();
    if (pred.phase === 'approaching') return 1.15;
    if (pred.phase === 'building') return 1.08;
    if (pred.phase === 'climax') return 1.2;
    if (pred.phase === 'receding') return 0.88;
    if (pred.premature) return 0.9; // Pull back if premature
    return 1.0;
  }

  /**
   * Get a tension bias to prevent premature climax.
   * @returns {number} - 0.8 to 1.2
   */
  function getTensionBias() {
    const pred = predict();
    if (pred.premature) return 0.8; // Suppress premature peak
    if (pred.phase === 'approaching') return 1.1;
    if (pred.phase === 'climax') return 1.15;
    return 1.0;
  }

  ConductorIntelligence.registerDensityBias('ClimaxProximityPredictor', () => ClimaxProximityPredictor.getDensityRampBias(), 0.85, 1.25);
  ConductorIntelligence.registerTensionBias('ClimaxProximityPredictor', () => ClimaxProximityPredictor.getTensionBias(), 0.8, 1.2);

  return {
    predict,
    getDensityRampBias,
    getTensionBias
  };
})();
