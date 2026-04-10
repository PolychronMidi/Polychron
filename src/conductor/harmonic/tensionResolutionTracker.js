// src/conductor/tensionResolutionTracker.js - Tracks dissonance->consonance resolution.
// Detects dangling unresolved tension (dissonant intervals not followed by resolution).
// Pure query API - modifies derivedTension to penalize sustained unresolved dissonance.

tensionResolutionTracker = (() => {
  const V = validator.create('tensionResolutionTracker');
  const WINDOW_SECONDS = 4;
  const CONSONANT = pitchClassHelpers.CONSONANT_INTERVALS;

  /**
   * Analyze tension-resolution patterns in recent melodic intervals.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ resolvedRatio: number, unresolvedCount: number, total: number, danglingTension: boolean }}
   */
  function getResolutionProfile(opts = {}) {
    const notes = analysisHelpers.getWindowNotes(V, opts, WINDOW_SECONDS);
    if (notes.length < 4) {
      return { resolvedRatio: 1, unresolvedCount: 0, total: 0, danglingTension: false };
    }
    const midis = analysisHelpers.extractMidiArray(notes, 60);

    let resolved = 0;
    let unresolved = 0;

    for (let i = 1; i < midis.length - 1; i++) {
      const prev = midis[i - 1];
      const curr = midis[i];
      const next = midis[i + 1];

      const intervalIn = m.abs(curr - prev) % 12;
      const intervalOut = m.abs(next - curr) % 12;

      // Dissonant interval followed by consonant = resolved
      if (!CONSONANT.has(intervalIn)) {
        if (CONSONANT.has(intervalOut)) {
          resolved++;
        } else {
          unresolved++;
        }
      }
    }

    // Check last interval pair - if dissonant, it's dangling
    if (midis.length >= 2) {
      const lastInterval = m.abs(
        midis[midis.length - 1] -
        midis[midis.length - 2]
      ) % 12;
      if (!CONSONANT.has(lastInterval)) unresolved++;
    }

    const total = resolved + unresolved;
    const resolvedRatio = total > 0 ? resolved / total : 1;

    return {
      resolvedRatio,
      unresolvedCount: unresolved,
      total,
      danglingTension: unresolved > 2 && resolvedRatio < 0.4
    };
  }

  /**
   * Get a tension bias based on resolution patterns.
   * Continuous ramp: resolvedRatio 0-1 maps to 1.25-1.0.
   * Low resolution (many unresolved dissonances) - higher tension.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.9 to 1.25
   */
  function getTensionBias(opts) {
    const profile = getResolutionProfile(opts);
    // Continuous ramp: resolvedRatio 0-1.0 maps to 1.25-1.0
    let bias = 1.0 + (1.0 - profile.resolvedRatio) * 0.25;
    if (bias > 1.0) {
      const tensionProduct = conductorState.getField('tension');
      const saturationPressure = clamp((tensionProduct - 1.08) / 0.18, 0, 1);
      if (saturationPressure > 0) {
        bias = 1.0 + (bias - 1.0) * (1 - saturationPressure * 0.75);
      }
    }
    return bias;
  }

  conductorIntelligence.registerTensionBias('tensionResolutionTracker', () => tensionResolutionTracker.getTensionBias(), 0.9, 1.25);
  // R33 E4: Density bias from resolution patterns. Unresolved dissonance
  // (low resolvedRatio) -> slightly denser texture to explore/resolve
  // the harmonic tension. High resolution -> neutral. New harmonic->density
  // cross-domain pathway.
  conductorIntelligence.registerDensityBias('tensionResolutionTracker', () => {
    const p = tensionResolutionTracker.getResolutionProfile();
    if (p.danglingTension) return 1.04;
    if (p.resolvedRatio < 0.5) return 1.0 + (0.5 - p.resolvedRatio) * 0.08;
    return 1.0;
  }, 0.96, 1.04);

  function reset() {}
  conductorIntelligence.registerModule('tensionResolutionTracker', { reset }, ['section']);

  return {
    getResolutionProfile,
    getTensionBias
  };
})();
