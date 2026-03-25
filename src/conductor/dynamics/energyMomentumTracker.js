// src/conductor/energyMomentumTracker.js - Tracks the derivative of composite intensity.
// Detects rising, falling, or plateaued energy momentum.
// Pure query API - advises conductor to inject contrast when momentum stalls.

energyMomentumTracker = (() => {
  /** @type {Array<{ time: number, energy: number }>} */
  const samples = [];
  const MAX_SAMPLES = 64;
  const PLATEAU_THRESHOLD = 0.04; // < 4% change = plateau
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

    // Detect plateau: count consecutive samples with minimal change
    let plateauStart = samples.length - 1;
    for (let i = samples.length - 2; i >= 0; i--) {
      if (m.abs(samples[i].energy - samples[samples.length - 1].energy) > PLATEAU_THRESHOLD) {
        break;
      }
      plateauStart = i;
    }
    const lastSample = samples[samples.length - 1];
    const plateauSample = samples[plateauStart];
    const plateauDuration = (lastSample && plateauSample) ? lastSample.time - plateauSample.time : 0;

    let trend = 'steady';
    if (momentum > 0.05) trend = 'rising';
    else if (momentum < -0.05) trend = 'falling';
    else if (plateauDuration > 4) trend = 'plateaued';

    return {
      momentum,
      trend,
      plateauDuration,
      stale: plateauDuration > STALE_SECONDS
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
      const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
      const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
        ? axisEnergy.shares.phase : 1.0 / 6.0;
      if (phaseShare > 1.0 / 6.0) {
        const phaseExcess = clamp((phaseShare - 1.0 / 6.0) / 0.05, 0, 1);
        nudge = 1.0 + (nudge - 1.0) * (1.0 - phaseExcess * 0.5);
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
  conductorIntelligence.registerRecorder('energyMomentumTracker', (ctx) => { energyMomentumTracker.recordEnergy(ctx.compositeIntensity, ctx.absTime); });
  conductorIntelligence.registerModule('energyMomentumTracker', { reset }, ['section']);

  return {
    recordEnergy,
    getMomentum,
    suggestAction,
    getDensityNudge,
    getTensionNudge,
    reset
  };
})();
