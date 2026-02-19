// src/conductor/EnergyMomentumTracker.js - Tracks the derivative of composite intensity.
// Detects rising, falling, or plateaued energy momentum.
// Pure query API — advises conductor to inject contrast when momentum stalls.

EnergyMomentumTracker = (() => {
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
      throw new Error('EnergyMomentumTracker.recordEnergy: energy must be finite');
    }
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new Error('EnergyMomentumTracker.recordEnergy: time must be finite');
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

    const half = m.floor(samples.length / 2);
    const firstHalf = samples.slice(0, half);
    const secondHalf = samples.slice(half);

    let avgFirst = 0;
    for (let i = 0; i < firstHalf.length; i++) avgFirst += firstHalf[i].energy;
    avgFirst /= firstHalf.length;

    let avgSecond = 0;
    for (let i = 0; i < secondHalf.length; i++) avgSecond += secondHalf[i].energy;
    avgSecond /= secondHalf.length;

    const momentum = avgSecond - avgFirst;

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
   * Plateaued → spike density for contrast; stale → stronger spike.
   * @returns {number} - 0.9 to 1.3
   */
  function getDensityNudge() {
    const mom = getMomentum();
    if (mom.stale) return 1.25;
    if (mom.trend === 'plateaued') return 1.1;
    return 1.0;
  }

  /** Reset tracking. */
  function reset() {
    samples.length = 0;
  }

  return {
    recordEnergy,
    getMomentum,
    suggestAction,
    getDensityNudge,
    reset
  };
})();
