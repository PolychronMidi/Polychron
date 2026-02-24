// src/conductor/DynamicPeakMemory.js - Dynamic peak/trough spacing tracker.
// Remembers the loudest and quietest moments and prevents re-peaking too soon.
// Tension bias spaces dynamic peaks for maximum impact.
// Pure query API â€” no side effects.

DynamicPeakMemory = (() => {
  const V = Validator.create('dynamicPeakMemory');
  const MAX_PEAKS = 12;
  /** @type {Array<{ intensity: number, time: number, type: string }>} */
  const peaks = [];
  let lastIntensity = 0.5;
  let peakCooldown = 0;

  /**
   * Record intensity and detect peaks/troughs.
   * @param {number} intensity - 0-1 composite intensity
   * @param {number} absTime
   */
  function recordIntensity(intensity, absTime) {
    V.requireFinite(intensity, 'intensity');
    V.requireFinite(absTime, 'absTime');
    const clamped = clamp(intensity, 0, 1);

    // Detect peaks (local maxima above 0.75) and troughs (below 0.25)
    if (clamped > 0.75 && lastIntensity <= 0.75 && peakCooldown <= 0) {
      peaks.push({ intensity: clamped, time: absTime, type: 'peak' });
      peakCooldown = 3; // minimum samples between peaks
    } else if (clamped < 0.25 && lastIntensity >= 0.25 && peakCooldown <= 0) {
      peaks.push({ intensity: clamped, time: absTime, type: 'trough' });
      peakCooldown = 3;
    }

    if (peakCooldown > 0) peakCooldown--;
    lastIntensity = clamped;
    if (peaks.length > MAX_PEAKS) peaks.shift();
  }

  /**
   * Get peak spacing signal.
   * @returns {{ tensionBias: number, timeSinceLastPeak: number, peakRecency: string }}
   */
  function _computePeakSignal() {
    if (peaks.length === 0) {
      return { tensionBias: 1, timeSinceLastPeak: Infinity, peakRecency: 'none' };
    }

    const lastPeak = peaks[peaks.length - 1];
    const now = V.requireFinite(beatStartTime, 'beatStartTime');
    const timeSince = now - lastPeak.time;

    let peakRecency = 'distant';
    if (timeSince < 5) peakRecency = 'very-recent';
    else if (timeSince < 15) peakRecency = 'recent';
    else if (timeSince < 30) peakRecency = 'moderate';

    // Tension bias: continuous ramp based on time since last peak/trough.
    // Peak: timeSince 0→8 → 0.92 (suppress), 8→25 → ramp 0.92→1.0, 25+ → ramp to 1.06.
    // Trough: timeSince 0→5 → ramp 1.04→1.0.
    let tensionBias = 1;
    if (lastPeak.type === 'peak') {
      if (timeSince < 8) {
        // Recent peak: ramp 0.92→0.96 over 0→8s
        tensionBias = 0.92 + clamp(timeSince / 8, 0, 1) * 0.04;
      } else {
        // Post-cooldown: ramp 0.96→1.06 over 8→40s
        tensionBias = 0.96 + clamp((timeSince - 8) / 32, 0, 1) * 0.1;
      }
    } else {
      // After trough: ramp 1.04→1.0 over 0→10s
      tensionBias = 1.04 - clamp(timeSince / 10, 0, 1) * 0.04;
    }

    return { tensionBias, timeSinceLastPeak: timeSince, peakRecency };
  }

  const _cache = beatCache.create(_computePeakSignal);

  /**
   * Get peak spacing signal (cached per beat).
   * @returns {{ tensionBias: number, timeSinceLastPeak: number, peakRecency: string }}
   */
  function getPeakSignal() { return _cache.get(); }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getPeakSignal().tensionBias;
  }

  /** Reset tracking. */
  function reset() {
    peaks.length = 0;
    lastIntensity = 0.5;
    peakCooldown = 0;
  }

  ConductorIntelligence.registerTensionBias('DynamicPeakMemory', () => DynamicPeakMemory.getTensionBias(), 0.9, 1.1);
  ConductorIntelligence.registerRecorder('DynamicPeakMemory', (ctx) => { DynamicPeakMemory.recordIntensity(ctx.compositeIntensity, ctx.absTime); });
  ConductorIntelligence.registerStateProvider('DynamicPeakMemory', () => {
    const s = DynamicPeakMemory.getPeakSignal();
    return { dynamicPeakRecency: s ? s.peakRecency : 'none' };
  });
  ConductorIntelligence.registerModule('DynamicPeakMemory', { reset }, ['section']);

  return {
    recordIntensity,
    getPeakSignal,
    getTensionBias,
    reset
  };
})();
