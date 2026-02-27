// src/conductor/tessituraPressureMonitor.js - Extreme-register duration tracker.
// Monitors how long voices stay in extreme high or low registers and biases
// density toward relief when tessitural pressure is sustained too long.
// Pure query API - no side effects.

tessituraPressureMonitor = (() => {
  const WINDOW_SECONDS = 8;
  const EXTREME_LOW = 48;   // C3 and below
  const EXTREME_HIGH = 84;  // C6 and above

  /**
   * Analyze tessitural pressure from recent notes.
   * @returns {{ extremeRatio: number, region: string, densityBias: number }}
   */
  function _computePressureSignal() {
    const notes = absoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS });

    if (notes.length < 3) {
      return { extremeRatio: 0, region: 'comfortable', densityBias: 1 };
    }

    let extremeLowCount = 0;
    let extremeHighCount = 0;
    let totalValid = 0;

    for (let i = 0; i < notes.length; i++) {
      const midi = (typeof notes[i].midi === 'number') ? notes[i].midi : -1;
      if (midi < 0) continue;
      totalValid++;
      if (midi <= EXTREME_LOW) extremeLowCount++;
      else if (midi >= EXTREME_HIGH) extremeHighCount++;
    }

    if (totalValid === 0) {
      return { extremeRatio: 0, region: 'comfortable', densityBias: 1 };
    }

    const lowRatio = extremeLowCount / totalValid;
    const highRatio = extremeHighCount / totalValid;
    const extremeRatio = lowRatio + highRatio;

    // Determine which extreme dominates
    let region = 'comfortable';
    if (lowRatio > 0.3 && highRatio > 0.3) region = 'both-extremes';
    else if (lowRatio > 0.3) region = 'low-pressure';
    else if (highRatio > 0.3) region = 'high-pressure';
    else if (extremeRatio > 0.15) region = 'mild-pressure';

    // Continuous ramp: comfortable register - slight boost; extreme - pull-back.
    // extremeRatio 0→0.1 maps to 1.03→1.0; extremeRatio 0.1→0.6 maps to 1.0→0.88.
    let densityBias = 1;
    if (extremeRatio < 0.1) {
      densityBias = 1.0 + clamp((0.1 - extremeRatio) / 0.1, 0, 1) * 0.03;
    } else {
      const rawSuppression = clamp((extremeRatio - 0.1) / 0.5, 0, 1) * 0.12;
      // Density-aware attenuation: reduce suppression when density is already
      // below healthy threshold - avoids compounding structural deficit.
      // At currentDensity 0.90+ - full suppression; at 0.50 - half suppression.
      const attenuate = currentDensity < 0.90
        ? clamp((currentDensity - 0.50) / 0.40, 0.5, 1.0)
        : 1.0;
      densityBias = 1.0 - rawSuppression * attenuate;
    }

    return { extremeRatio, region, densityBias };
  }

  const _cache = beatCache.create(_computePressureSignal);

  /**
   * Analyze tessitural pressure from recent notes (cached per beat).
   * @returns {{ extremeRatio: number, region: string, densityBias: number }}
   */
  function getPressureSignal() { return _cache.get(); }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getPressureSignal().densityBias;
  }

  conductorIntelligence.registerDensityBias('tessituraPressureMonitor', () => tessituraPressureMonitor.getDensityBias(), 0.85, 1.1);
  conductorIntelligence.registerStateProvider('tessituraPressureMonitor', () => {
    const s = tessituraPressureMonitor.getPressureSignal();
    return { tessituraRegion: s ? s.region : 'comfortable' };
  });

  return {
    getPressureSignal,
    getDensityBias
  };
})();
