// src/conductor/rhythmicInertiaTracker.js - Rhythmic pattern persistence tracker.
// Measures how long rhythmic patterns persist (inertia) vs. change frequently.
// Biases density to break rhythmic ruts or sustain good grooves.
// Pure query API - no side effects.

rhythmicInertiaTracker = (() => {
  const V = validator.create('rhythmicInertiaTracker');
  const MAX_SNAPSHOTS = 20;
  /** @type {Array<string>} */
  const patternFingerprints = [];

  /**
   * Record a rhythmic fingerprint for the current beat/phrase.
   * @param {number[]} onsetPattern - array of onset positions (0-1 within beat)
   */
  function recordPattern(onsetPattern) {
    V.assertArray(onsetPattern, 'onsetPattern');
    const fp = onsetPattern.map(v => m.round(v * 8) / 8).join(',');
    patternFingerprints.push(fp);
    if (patternFingerprints.length > MAX_SNAPSHOTS) patternFingerprints.shift();
  }

  /**
   * Compute inertia: high = patterns repeating, low = high variability.
   * @returns {{ inertia: number, densityBias: number, suggestion: string }}
   */
  function _computeInertiaSignal() {
    if (patternFingerprints.length < 4) {
      return { inertia: 0.5, densityBias: 1, suggestion: 'maintain' };
    }

    // Count consecutive repetitions at tail
    let streak = 1;
    const last = patternFingerprints[patternFingerprints.length - 1];
    for (let i = patternFingerprints.length - 2; i >= 0; i--) {
      if (patternFingerprints[i] === last) streak++;
      else break;
    }

    // Also measure overall diversity
    /** @type {Object.<string, boolean>} */
    const unique = {};
    let uniqueCount = 0;
    for (let i = 0; i < patternFingerprints.length; i++) {
      if (!unique[patternFingerprints[i]]) {
        unique[patternFingerprints[i]] = true;
        uniqueCount++;
      }
    }
    const diversity = uniqueCount / patternFingerprints.length;

    // Inertia: 0 = constantly changing, 1 = completely stuck
    const streakInertia = clamp((streak - 1) / 6, 0, 1);
    const diversityInertia = clamp(1 - diversity, 0, 1);
    const inertia = streakInertia * 0.6 + diversityInertia * 0.4;

    // Density bias: high inertia (rut) - nudge density to destabilize;
    // very low inertia (chaos) - slight reduction to stabilize.
    // Peer-aware: when flicker is strong (high texture variation),
    // relax the inertia-break nudge - the texture layer is already providing variety.
    let densityBias = 1;
    if (inertia > 0.7) {
      densityBias = 1.06; // stuck in a rut - add density to force change
      const flickerProduct = signalReader.flicker();
      if (flickerProduct > 1.15) {
        densityBias = 1.02; // flicker already pushing variation - soften our nudge
      }
    } else if (inertia < 0.15) {
      densityBias = 0.95; // too chaotic - pull back
    }

    let suggestion = 'maintain';
    if (inertia > 0.7) suggestion = 'break-pattern';
    else if (inertia > 0.5) suggestion = 'groove-sustained';
    else if (inertia < 0.15) suggestion = 'too-variable';

    return { inertia, densityBias, suggestion };
  }

  const _cache = beatCache.create(_computeInertiaSignal);

  /**
   * Get latest inertia signal (cached per beat).
   * @returns {{ inertia: number, densityBias: number, suggestion: string }}
   */
  function getInertiaSignal() { return _cache.get(); }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getInertiaSignal().densityBias;
  }

  /** Reset tracking. */
  function reset() {
    patternFingerprints.length = 0;
  }

  conductorIntelligence.registerDensityBias('rhythmicInertiaTracker', () => rhythmicInertiaTracker.getDensityBias(), 0.9, 1.1);
  conductorIntelligence.registerStateProvider('rhythmicInertiaTracker', () => {
    const s = rhythmicInertiaTracker.getInertiaSignal();
    return { rhythmicInertiaSuggestion: s ? s.suggestion : 'maintain' };
  });
  conductorIntelligence.registerModule('rhythmicInertiaTracker', { reset }, ['section']);

  return {
    recordPattern,
    getInertiaSignal,
    getDensityBias,
    reset
  };
})();
