// src/conductor/registralVelocityCorrelator.js - Register-velocity correlation tracker.
// Analyzes correlation between pitch height and velocity (dynamics).
// Signals when correlation is too rigid (always loud=high) or too random.
// Flicker modifier to encourage natural but varied register-dynamic mapping.
// Pure query API - no side effects.

registralVelocityCorrelator = (() => {
  const WINDOW_SECONDS = 8;

  /**
   * Compute Pearson-style correlation between MIDI pitch and velocity.
   * @returns {{ correlation: number, flickerMod: number, tensionBias: number, suggestion: string }}
   */
  function getCorrelationSignal() {
    const notes = absoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS });

    if (notes.length < 6) {
      return { correlation: 0, flickerMod: 1, tensionBias: 1, suggestion: 'maintain' };
    }
    const noteMidis = analysisHelpers.extractMidiArray(notes, -1);
    const noteVelocities = analysisHelpers.extractVelocityArray(notes, -1);

    // Collect paired data
    /** @type {number[]} */
    const pitches = [];
    /** @type {number[]} */
    const velocities = [];

    for (let i = 0; i < notes.length; i++) {
      const midi = noteMidis[i];
      const vel = noteVelocities[i];
      if (midi < 0 || vel < 0) continue;
      pitches.push(midi);
      velocities.push(vel);
    }

    const n = pitches.length;
    if (n < 5) {
      return { correlation: 0, flickerMod: 1, tensionBias: 1, suggestion: 'maintain' };
    }

    // Compute means
    let sumP = 0;
    let sumV = 0;
    for (let i = 0; i < n; i++) {
      sumP += pitches[i];
      sumV += velocities[i];
    }
    const meanP = sumP / n;
    const meanV = sumV / n;

    // Compute correlation
    let cov = 0;
    let varP = 0;
    let varV = 0;
    for (let i = 0; i < n; i++) {
      const dp = pitches[i] - meanP;
      const dv = velocities[i] - meanV;
      cov += dp * dv;
      varP += dp * dp;
      varV += dv * dv;
    }

    const denom = m.sqrt(varP * varV);
    const correlation = denom > 0 ? cov / denom : 0;

    // Absolute correlation: how rigid is the mapping?
    const absCorr = m.abs(correlation);

    // Flicker modifier: continuous ramp based on absolute correlation.
    // High correlation (0.4-1.0) - ramp 1.0-1.1 (break rigid pattern)
    // Low correlation (0-0.2) - ramp 0.94-1.0 (tighten for coherence)
    // Mid (0.2-0.4) - neutral
    let flickerMod = 1;
    if (absCorr > 0.4) {
      flickerMod = 1.0 + clamp((absCorr - 0.4) / 0.6, 0, 1) * 0.1;
    } else if (absCorr < 0.2) {
      flickerMod = 0.94 + clamp(absCorr / 0.2, 0, 1) * 0.06;
    }

    // R36 E5: Tension bias (cross-domain: melodic->tension).
    // Rigid pitch-velocity mapping signals musical monotony -- push tension
    // to encourage change. Disconnected mapping suggests evolving texture --
    // mild tension reinforcement for natural connection.
    let tensionBias = 1;
    if (absCorr > 0.4) {
      tensionBias = 1.0 + clamp((absCorr - 0.4) / 0.5, 0, 1) * 0.06;
    } else if (absCorr < 0.15) {
      tensionBias = 0.97 + clamp(absCorr / 0.15, 0, 1) * 0.03;
    }

    let suggestion = 'maintain';
    if (absCorr > 0.75) suggestion = 'too-correlated';
    else if (absCorr > 0.4) suggestion = 'natural';
    else if (absCorr < 0.1) suggestion = 'disconnected';

    return { correlation, flickerMod, tensionBias, suggestion };
  }

  /**
   * Get flicker modifier for the flickerAmplitude chain.
   * @returns {number}
   */
  function getFlickerModifier() {
    return getCorrelationSignal().flickerMod;
  }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getCorrelationSignal().tensionBias;
  }

  conductorIntelligence.registerFlickerModifier('registralVelocityCorrelator', () => registralVelocityCorrelator.getFlickerModifier(), 0.85, 1.20);
  conductorIntelligence.registerTensionBias('registralVelocityCorrelator', () => registralVelocityCorrelator.getTensionBias(), 0.97, 1.06);

  return {
    getCorrelationSignal,
    getFlickerModifier,
    getTensionBias
  };
})();
