// src/conductor/energyMomentumTracker.js - Tracks the derivative of composite intensity.
// Detects rising, falling, or plateaued energy momentum.
// Pure query API - advises conductor to inject contrast when momentum stalls.

moduleLifecycle.declare({
  name: 'energyMomentumTracker',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'signalReader'],
  provides: ['energyMomentumTracker'],
  init: (deps) => {
  const signalReader = deps.signalReader;
  const conductorIntelligence = deps.conductorIntelligence;
  /** @type {Array<{ time: number, energy: number }>} */
  const samples = [];
  const MAX_SAMPLES = 64;
  // R24 E3: Rolling variance replaces walk-back plateau detection.
  // Window of 16 samples (~8-16 seconds depending on beat rate).
  // R25 E1: Variance threshold widened 0.0004->0.002 (std dev 0.045).
  // Module dormant 4 consecutive rounds. Std dev 0.02 was too tight;
  // at 0.045 the module should detect energy bands narrower than ~0.09.
  const PLATEAU_WINDOW = 16;
  const PLATEAU_VARIANCE_THRESHOLD = 0.002;
  const STALE_SECONDS = 15;

  /**
   * Record a composite intensity sample at the current time.
   * @param {number} energy - composite intensity (0-1)
   * @param {number} time - absolute time in seconds
   */
  function recordEnergy(energy, time) {
    if (typeof energy !== 'number' || !Number.isFinite(energy)) {
      throw new Error('energyMomentumTracker.recordEnergy: energy must be finite');
    }
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new Error('energyMomentumTracker.recordEnergy: time must be finite');
    }
    samples.push({ time, energy: clamp(energy, 0, 1) });
    if (samples.length > MAX_SAMPLES) samples.shift();
  }

  /**
   * Compute the energy momentum (derivative of intensity over time).
   * @returns {{ momentum: number, trend: string, plateauDuration: number, stale: boolean }}
   */
  function getMomentum() {
    if (samples.length < 4) {
      return { momentum: 0, trend: 'insufficient', plateauDuration: 0, stale: false };
    }

    /** @type {number[]} */
    const energies = [];
    for (let i = 0; i < samples.length; i++) energies.push(samples[i].energy);
    const { slope: momentum } = analysisHelpers.halfSplitSlope(energies);

    // R24 E3: Rolling variance plateau detection. The old approach walked
    // backward counting samples within PLATEAU_THRESHOLD of the latest
    // value -- but energy is naturally noisy enough that consecutive
    // samples rarely look "flat" even during true plateaus. Instead,
    // compute the variance of the most recent PLATEAU_WINDOW samples.
    // Low variance (< PLATEAU_VARIANCE_THRESHOLD) means the signal is
    // stuck in a narrow band even if individual samples fluctuate.
    const windowSize = m.min(samples.length, PLATEAU_WINDOW);
    const windowStart = samples.length - windowSize;
    let sumE = 0;
    for (let i = windowStart; i < samples.length; i++) sumE += samples[i].energy;
    const meanE = sumE / windowSize;
    let sumSqDev = 0;
    for (let i = windowStart; i < samples.length; i++) {
      const d = samples[i].energy - meanE;
      sumSqDev += d * d;
    }
    const variance = sumSqDev / windowSize;
    const isLowVariance = variance < PLATEAU_VARIANCE_THRESHOLD;

    const lastSample = samples[samples.length - 1];
    const windowStartSample = samples[windowStart];
    const windowDuration = lastSample.time - windowStartSample.time;

    let trend = 'steady';
    if (momentum > 0.05) trend = 'rising';
    else if (momentum < -0.05) trend = 'falling';
    else if (isLowVariance && windowDuration > 4) trend = 'plateaued';

    return {
      momentum,
      trend,
      plateauDuration: isLowVariance ? windowDuration : 0,
      stale: isLowVariance && windowDuration > STALE_SECONDS
    };
  }

  /**
   * Suggest a conductor action based on momentum state.
   * @returns {{ action: string, urgency: number }}
   */
  function suggestAction() {
    const mom = getMomentum();

    if (mom.stale) {
      return { action: 'inject-contrast', urgency: 0.9 };
    }
    if (mom.trend === 'plateaued') {
      return { action: 'nudge-change', urgency: 0.5 };
    }
    if (mom.trend === 'rising' && mom.momentum > 0.15) {
      return { action: 'sustain-build', urgency: 0.2 };
    }
    if (mom.trend === 'falling' && mom.momentum < -0.15) {
      return { action: 'allow-release', urgency: 0.1 };
    }
    return { action: 'maintain', urgency: 0 };
  }

  /**
   * Get a density adjustment based on momentum.
   * Plateaued - spike density for contrast; stale - stronger spike.
   * Dampened when tension is already high (prevents runaway energy escalation).
   * @returns {number} - 0.9 to 1.3
   */
  function getDensityNudge() {
    const mom = getMomentum();
    let nudge = 1.0;
    if (mom.stale) nudge = 1.25;
    else if (mom.trend === 'plateaued') nudge = 1.1;

    // Peer-aware: if tension product is already elevated, dampen our push
    // to avoid compounding energy escalation across the pipeline.
    if (nudge > 1.0) {
      const tensionProduct = signalReader.tension();
      if (tensionProduct > 1.15) {
        nudge = 1.0 + (nudge - 1.0) * 0.4; // heavy dampen
      } else if (tensionProduct > 1.05) {
        nudge = 1.0 + (nudge - 1.0) * 0.7; // light dampen
      }
    }

    return nudge;
  }

  // R11 E3: Tension bias from energy momentum. When momentum is stale or
  // plateaued, inject tension contrast -- stale gets stronger push (1.12)
  // to break monotony, plateau gets mild push (1.06). Rising momentum
  // sustains mild elevation (1.04). Falling/steady returns 1.0 (neutral).
  // This creates a new tension signal pathway from a module that previously
  // only contributed density bias -- diversifying the tension signal surface.
  // R12 E2: Phase-aware dampening. When phase share is above fair share
  // (0.167), reduce the tension nudge proportionally to decorrelate
  // tension-phase (was 0.560 increasing in R11). Prevents tension from
  // tracking phase-correlated activity patterns.
  function getTensionNudge() {
    const mom = getMomentum();
    let nudge = 1.0;
    if (mom.stale) nudge = 1.12;
    else if (mom.trend === 'plateaued') nudge = 1.06;
    else if (mom.trend === 'rising' && mom.momentum > 0.10) nudge = 1.04;
    if (nudge > 1.0) {
      const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
      const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
        ? axisEnergy.shares.phase : 1.0 / 6.0;
      const tensionShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.tension === 'number'
        ? axisEnergy.shares.tension : 1.0 / 6.0;
      if (phaseShare > 1.0 / 6.0) {
        const phaseExcess = clamp((phaseShare - 1.0 / 6.0) / 0.05, 0, 1);
        nudge = 1.0 + (nudge - 1.0) * (1.0 - phaseExcess * 0.5);
      }
      const tensionProduct = conductorState.getField('tension');
      const saturationPressure = clamp((tensionProduct - 1.10) / 0.20, 0, 1);
      const tensionOvershare = clamp((tensionShare - 0.19) / 0.06, 0, 1);
      if (saturationPressure > 0 || tensionOvershare > 0) {
        const reliefScale = 1.0 - clamp(saturationPressure * 0.70 + tensionOvershare * 0.35, 0, 0.80);
        nudge = 1.0 + (nudge - 1.0) * reliefScale;
      }
    }
    return nudge;
  }

  /** Reset tracking. */
  function reset() {
    samples.length = 0;
  }

  conductorIntelligence.registerDensityBias('energyMomentumTracker', () => energyMomentumTracker.getDensityNudge(), 0.9, 1.3);
  conductorIntelligence.registerTensionBias('energyMomentumTracker', () => energyMomentumTracker.getTensionNudge(), 0.95, 1.15);
  conductorIntelligence.registerRecorder('energyMomentumTracker', (ctx) => { if (ctx.layer === 'L2') return; energyMomentumTracker.recordEnergy(ctx.compositeIntensity, ctx.absTime); });
  conductorIntelligence.registerModule('energyMomentumTracker', { reset }, ['section']);

  return {
    recordEnergy,
    getMomentum,
    suggestAction,
    getDensityNudge,
    getTensionNudge,
    reset
  };
  },
});
