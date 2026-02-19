// src/conductor/DensityWaveAnalyzer.js - Detects periodic density oscillations.
// Distinguishes between intentional density waves and flat/monotone density envelopes.
// Pure query API — amplifies or dampens density flicker for musical shape.

DensityWaveAnalyzer = (() => {
  /** @type {Array<{ time: number, density: number }>} */
  const samples = [];
  const MAX_SAMPLES = 48;

  /**
   * Record a density snapshot.
   * @param {number} density - current density (0-1)
   * @param {number} time - absolute time in seconds
   */
  function recordDensity(density, time) {
    if (typeof density !== 'number' || !Number.isFinite(density)) {
      throw new Error('DensityWaveAnalyzer.recordDensity: density must be finite');
    }
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new Error('DensityWaveAnalyzer.recordDensity: time must be finite');
    }
    samples.push({ time, density: clamp(density, 0, 1) });
    if (samples.length > MAX_SAMPLES) samples.shift();
  }

  /**
   * Analyze density oscillation patterns.
   * @returns {{ waveAmplitude: number, waveFrequency: number, isWaving: boolean, isFlat: boolean }}
   */
  function getWaveProfile() {
    if (samples.length < 8) {
      return { waveAmplitude: 0, waveFrequency: 0, isWaving: false, isFlat: true };
    }

    // Find peaks and troughs
    let peaks = 0;
    let troughs = 0;
    let maxDensity = 0;
    let minDensity = 1;

    for (let i = 1; i < samples.length - 1; i++) {
      const prev = samples[i - 1].density;
      const curr = samples[i].density;
      const next = samples[i + 1].density;

      if (curr > prev && curr > next) peaks++;
      if (curr < prev && curr < next) troughs++;
      if (curr > maxDensity) maxDensity = curr;
      if (curr < minDensity) minDensity = curr;
    }

    const waveAmplitude = maxDensity - minDensity;
    // Approximate frequency: number of complete cycles
    const cycles = m.min(peaks, troughs);
    const timeSpan = samples.length > 1
      ? samples[samples.length - 1].time - samples[0].time
      : 1;
    const waveFrequency = timeSpan > 0 ? cycles / timeSpan : 0;

    return {
      waveAmplitude,
      waveFrequency,
      isWaving: waveAmplitude > 0.15 && cycles >= 2,
      isFlat: waveAmplitude < 0.05
    };
  }

  /**
   * Get a flicker amplitude modifier based on density wave patterns.
   * Flat → amplify flicker for life; already waving → let it ride.
   * @returns {number} - 0.9 to 1.2
   */
  function getFlickerModifier() {
    const profile = getWaveProfile();
    if (profile.isFlat) return 1.15;
    if (profile.isWaving && profile.waveAmplitude > 0.3) return 0.9;
    return 1.0;
  }

  /** Reset tracking. */
  function reset() {
    samples.length = 0;
  }

  return {
    recordDensity,
    getWaveProfile,
    getFlickerModifier,
    reset
  };
})();
