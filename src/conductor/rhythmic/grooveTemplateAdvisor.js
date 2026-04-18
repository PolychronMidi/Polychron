// src/conductor/grooveTemplateAdvisor.js - Tracks micro-timing deviations from the grid.
// Detects mechanical rigidity vs. human-like swing feel.
// Pure query API - advises velocity humanization and swing feel per section phase.

grooveTemplateAdvisor = (() => {
  const { V, query } = analysisHelpers.createTrackerQuery('grooveTemplateAdvisor', 4, { minNotes: 4 });

  /**
   * Analyze micro-timing deviation of recent onsets from the beat grid.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgDeviation: number, maxDeviation: number, swingRatio: number, rigid: boolean, loose: boolean }}
   */
  function getGrooveProfile(opts = {}) {
    const notes = query(opts);
    if (!notes) return { avgDeviation: 0, maxDeviation: 0, swingRatio: 0.5, rigid: true, loose: false };

    // Subdivision duration in seconds
    const subdivDur = V.requireFinite(spSubdiv, 'spSubdiv');

    let sumDev = 0;
    let maxDev = 0;
    let earlyCount = 0;
    let lateCount = 0;

    for (let i = 0; i < notes.length; i++) {
      const t = notes[i].time;
      const phase = t % subdivDur;
      const dev = m.min(phase, subdivDur - phase);
      sumDev += dev;
      if (dev > maxDev) maxDev = dev;
      // Track early/late tendency relative to subdivision midpoint
      if (phase < subdivDur * 0.5) {
        earlyCount++;
      } else {
        lateCount++;
      }
    }

    const avgDeviation = sumDev / notes.length;
    const total = earlyCount + lateCount;
    const swingRatio = total > 0 ? lateCount / total : 0.5;

    return {
      avgDeviation,
      maxDeviation: maxDev,
      swingRatio,
      // R24 E5: Widened bands from 0.05/0.30 to 0.08/0.22. Module dormant
      // for 2+ rounds (tension always 1.0). Most algorithmic output falls
      // between 5-30% deviation, so neither threshold triggers. Wider
      // bands should activate the tension bias more frequently.
      rigid: avgDeviation < subdivDur * 0.08,
      loose: avgDeviation > subdivDur * 0.22
    };
  }

  /**
   * Suggest a groove feel adjustment.
   * Rigid - add swing/humanize; loose - tighten toward grid.
   * @returns {{ suggestion: string, swingAmount: number }}
   */
  function suggestGrooveFeel() {
    const profile = getGrooveProfile();
    if (profile.rigid) {
      return { suggestion: 'humanize', swingAmount: 0.15 };
    }
    if (profile.loose) {
      return { suggestion: 'tighten', swingAmount: -0.1 };
    }
    return { suggestion: 'maintain', swingAmount: 0 };
  }

  /**
   * Get a velocity humanization bias.
   * Continuous ramp based on avgDeviation relative to subdivDur:
   *   rigid (low deviation) - 1.25, loose (high deviation) - 0.85,
   *   intermediate - smooth interpolation.
   * @returns {number} - 0.8 to 1.3
   */
  function getVelocityHumanizeBias() {
    const profile = getGrooveProfile();
    // rigid: avgDeviation is very low - more humanization needed (bias up)
    // loose: avgDeviation is very high - less humanization needed (bias down)
    // Map avgDeviation 0-0.1 to bias 1.25-1.0, then 0.1-0.5 to 1.0-0.85
    if (profile.rigid) {
      // Already flagged as rigid - ramp: deviation 0-threshold maps to 1.25-1.0
      return 1.25;
    }
    if (profile.loose) {
      // R73 E3: 0.85->0.90. Loosest flicker suppression was too aggressive,
      // crushing timbral variety. Moderated for richer texture.
      return 0.90;
    }
    // In between: avgDeviation relative to subdivDur range.
    // Use swingRatio as a proxy for how human the timing feels.
    // Balanced swing (0.5) - 1.0; skewed - slight humanization
    const skew = m.abs(profile.swingRatio - 0.5) * 2; // 0-1: how asymmetric
    return 1.0 + clamp(skew, 0, 1) * 0.1;
  }

  // R22 E4: Tension bias from groove feel. Rigid mechanical timing stunts
  // musical momentum - reduce tension to encourage evolution. Loose human-like
  // grooves carry natural forward motion - boost tension to build on that energy.
  /**
   * Get tension multiplier from groove rigidity.
   * @returns {number}
   */
  function getGrooveTensionBias() {
    const profile = getGrooveProfile();
    if (profile.rigid) return 0.95;
    if (profile.loose) return 1.06;
    return 1.0;
  }

  conductorIntelligence.registerFlickerModifier('grooveTemplateAdvisor', () => grooveTemplateAdvisor.getVelocityHumanizeBias(), 0.8, 1.3);
  conductorIntelligence.registerTensionBias('grooveTemplateAdvisor', () => grooveTemplateAdvisor.getGrooveTensionBias(), 0.95, 1.06);

  function reset() {}
  conductorIntelligence.registerModule('grooveTemplateAdvisor', { reset }, ['section']);

  return {
    getGrooveProfile,
    suggestGrooveFeel,
    getVelocityHumanizeBias,
    getGrooveTensionBias
  };
})();
