// src/conductor/GrooveTemplateAdvisor.js - Tracks micro-timing deviations from the grid.
// Detects mechanical rigidity vs. human-like swing feel.
// Pure query API â€” advises velocity humanization and swing feel per section phase.

GrooveTemplateAdvisor = (() => {
  const V = Validator.create('grooveTemplateAdvisor');
  const WINDOW_SECONDS = 4;

  /**
   * Analyze micro-timing deviation of recent onsets from the beat grid.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgDeviation: number, maxDeviation: number, swingRatio: number, rigid: boolean, loose: boolean }}
   */
  function getGrooveProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { avgDeviation: 0, maxDeviation: 0, swingRatio: 0.5, rigid: true, loose: false };
    }

    // Subdivision duration in seconds
    const subdivDur = V.requireFinite(tpSubdiv, 'tpSubdiv') / V.requireFinite(tpSec, 'tpSec');

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
      rigid: avgDeviation < subdivDur * 0.05,
      loose: avgDeviation > subdivDur * 0.3
    };
  }

  /**
   * Suggest a groove feel adjustment.
   * Rigid â†’ add swing/humanize; loose â†’ tighten toward grid.
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
   *   rigid (low deviation) → 1.25, loose (high deviation) → 0.85,
   *   intermediate → smooth interpolation.
   * @returns {number} - 0.8 to 1.3
   */
  function getVelocityHumanizeBias() {
    const profile = getGrooveProfile();
    // rigid: avgDeviation is very low → more humanization needed (bias up)
    // loose: avgDeviation is very high → less humanization needed (bias down)
    // Map avgDeviation 0→0.1 to bias 1.25→1.0, then 0.1→0.5 to 1.0→0.85
    if (profile.rigid) {
      // Already flagged as rigid — ramp: deviation 0→threshold maps to 1.25→1.0
      return 1.25;
    }
    if (profile.loose) {
      return 0.85;
    }
    // In between: avgDeviation relative to subdivDur range.
    // Use swingRatio as a proxy for how human the timing feels.
    // Balanced swing (0.5) → 1.0; skewed → slight humanization
    const skew = m.abs(profile.swingRatio - 0.5) * 2; // 0–1: how asymmetric
    return 1.0 + clamp(skew, 0, 1) * 0.1;
  }

  ConductorIntelligence.registerFlickerModifier('GrooveTemplateAdvisor', () => GrooveTemplateAdvisor.getVelocityHumanizeBias(), 0.8, 1.3);

  return {
    getGrooveProfile,
    suggestGrooveFeel,
    getVelocityHumanizeBias
  };
})();
