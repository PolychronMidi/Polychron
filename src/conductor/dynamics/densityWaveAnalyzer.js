// src/conductor/densityWaveAnalyzer.js - Detects periodic density oscillations.
// Distinguishes between intentional density waves and flat/monotone density envelopes.
// Pure query API - amplifies or dampens density flicker for musical shape.

densityWaveAnalyzer = (() => {
  const V = validator.create('densityWaveAnalyzer');
  /** @type {Array<{ time: number, density: number }>} */
  const samples = [];
  const MAX_SAMPLES = 48;

  /**
   * Record a density snapshot.
   * @param {number} density - current density (0-1)
   * @param {number} time - absolute time in seconds
   */
  function recordDensity(density, time) {
    V.requireFinite(density, 'density');
    V.requireFinite(time, 'time');
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

  function densityWaveAnalyzerGetContainmentPressure() {
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const lowPhaseThreshold = /** @type {number} */ (safePreBoot.call(() => phaseFloorController.getLowShareThreshold(), 0.03));
    const phaseRecoveryCredit = clamp((phaseShare - lowPhaseThreshold) / 0.08, 0, 1);
    const couplingPressures = pipelineCouplingManager.getCouplingPressures();
    const signalHealth = safePreBoot.call(() => signalHealthAnalyzer.getHealth(), null);
    const densityHealth = signalHealth && signalHealth.density ? signalHealth.density : null;
    const densityFlickerPressure = clamp((V.optionalFinite(couplingPressures['density-flicker'], 0) - 0.78) / 0.16, 0, 1);
    const densityPhasePressure = clamp((V.optionalFinite(couplingPressures['density-phase'], 0) - 0.68) / 0.16, 0, 1);
    const densitySaturationPressure = densityHealth
      ? clamp((densityHealth.saturated ? 0.45 : 0) + clamp((densityHealth.crushFactor - 0.35) / 0.40, 0, 1) * 0.55, 0, 1)
      : 0;
    const containmentCredit = 0.35 + phaseRecoveryCredit * 0.65;
    return clamp((densityFlickerPressure * 0.55 + densityPhasePressure * 0.20 + densitySaturationPressure * 0.25) * containmentCredit, 0, 1);
  }

  /**
   * Get flicker amplitude modifier based on density wave patterns.
   * Continuous ramp: flat (amplitude 0-0.05) - 1.15-1.0,
   * waving (amplitude 0.15-0.5) - 1.0-0.9.
   * @returns {number} - 0.9 to 1.2
   */
  function getFlickerModifier() {
    const profile = getWaveProfile();
    const containmentPressure = densityWaveAnalyzerGetContainmentPressure();
    if (profile.waveAmplitude < 0.05) {
      // Flat: ramp 1.15-1.0 over amplitude 0-0.05
      const flatBoost = 0.15 - clamp(profile.waveAmplitude / 0.05, 0, 1) * 0.15;
      return 1.0 + flatBoost * (1 - containmentPressure * 0.65);
    }
    if (profile.waveAmplitude > 0.15) {
      // Waving: ramp 1.0-0.9 over amplitude 0.15-0.5
      const waveCut = clamp((profile.waveAmplitude - 0.15) / 0.35, 0, 1) * 0.1;
      return 1.0 - waveCut * (1 + containmentPressure * 0.25);
    }
    return 1.0;
  }

  // R25 E3: Tension bias from density wave patterns. When density is flat
  // (no oscillation), boost tension to inject contrast from a different
  // axis. When density is actively waving, sustain mild tension push.
  // Creates cross-domain energy compensation: flat density -> tension picks
  // up the slack; active density -> tension stays neutral.
  /**
   * Get tension multiplier from density wave amplitude.
   * @returns {number}
   */
  function getTensionBias() {
    const profile = getWaveProfile();
    // E10: When hyperMetaManager signals tension suppression during phrase
    // troughs, reduce or invert the flat-density tension boost. This breaks
    // the vicious cycle where flat density -> tension boost -> more energy
    // consumption -> homeostasis suppresses gain -> flatter density.
    const e10Suppress = /** @type {number} */ (hyperMetaManager.getRateMultiplier('e10TensionSuppress'));
    if (profile.isFlat) {
      // Normal: 1.06. With e10Suppress=0.6: 1.0 + 0.06*0.6 = 1.036
      // During deep trough: tension boost is nearly eliminated
      return 1.0 + 0.06 * e10Suppress;
    }
    if (profile.isWaving) return 1.02;
    return 1.0;
  }

  // R39 E3: Density bias from density wave patterns. When density is flat,
  // boost density to recover coupling headroom. When density is actively
  // waving, leave it alone. Addresses density axis starvation (0.094 share
  // in R38, below floor) by adding a self-correcting density push.
  /**
   * Get density multiplier from density wave amplitude.
   * @returns {number}
   */
  // R74 E5: Alternating flat-density push. When density is flat, instead
  // of a constant 1.06 boost (which raises mean without creating variance),
  // alternate between boost (1.06) and cut (0.97) on a phrase-driven
  // cycle. This structural mechanism creates variance by injecting
  // oscillation when the density signal lacks it. When density is already
  // waving, the cut path engages to deepen troughs.
  function getDensityBias() {
    const profile = getWaveProfile();
    if (profile.isFlat) {
      // timeStream is a registry-declared dep -- guaranteed bound when this
      // runs (composition time, post-boot). Naked access, no defensive wrap.
      const phraseProgress = clamp(timeStream.compoundProgress('phrase'), 0, 1);
      return phraseProgress < 0.5 ? 1.06 : 0.97;
    }
    if (profile.isWaving) return 0.97;
    return 1.0;
  }

  /** Reset tracking. */
  function reset() {
    samples.length = 0;
  }

  conductorIntelligence.registerFlickerModifier('densityWaveAnalyzer', () => densityWaveAnalyzer.getFlickerModifier(), 0.9, 1.2);
  conductorIntelligence.registerTensionBias('densityWaveAnalyzer', () => densityWaveAnalyzer.getTensionBias(), 1.0, 1.06);
  conductorIntelligence.registerDensityBias('densityWaveAnalyzer', () => densityWaveAnalyzer.getDensityBias(), 0.97, 1.06);
  conductorIntelligence.registerRecorder('densityWaveAnalyzer', (ctx) => { if (ctx.layer === 'L2') return; densityWaveAnalyzer.recordDensity(ctx.currentDensity, ctx.absTime); });
  conductorIntelligence.registerModule('densityWaveAnalyzer', { reset }, ['section']);

  return {
    recordDensity,
    getWaveProfile,
    getFlickerModifier,
    getTensionBias,
    getDensityBias,
    reset
  };
})();
