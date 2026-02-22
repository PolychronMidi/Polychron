// src/conductor/DynamicPeakMemory.js - Dynamic peak/trough spacing tracker.
// Remembers the loudest and quietest moments and prevents re-peaking too soon.
// Tension bias spaces dynamic peaks for maximum impact.
// Pure query API — no side effects.

DynamicPeakMemory = (() => {
  const V = Validator.create('DynamicPeakMemory');
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
    const now = (Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : lastPeak.time;
    const timeSince = now - lastPeak.time;

    let peakRecency = 'distant';
    if (timeSince < 5) peakRecency = 'very-recent';
    else if (timeSince < 15) peakRecency = 'recent';
    else if (timeSince < 30) peakRecency = 'moderate';

    // Tension bias: if peak was very recent → suppress tension to prevent
    // another peak too soon; if distant → allow tension buildup
    let tensionBias = 1;
    if (lastPeak.type === 'peak') {
      if (timeSince < 8) {
        tensionBias = 0.92; // just peaked → pull back
      } else if (timeSince > 25) {
        tensionBias = 1.06; // long since peak → allow buildup
      }
    } else {
      // After a trough, allow gentle recovery
      if (timeSince < 5) {
        tensionBias = 1.04;
      }
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
