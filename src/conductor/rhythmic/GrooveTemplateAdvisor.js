// src/conductor/GrooveTemplateAdvisor.js - Tracks micro-timing deviations from the grid.
// Detects mechanical rigidity vs. human-like swing feel.
// Pure query API — advises velocity humanization and swing feel per section phase.

GrooveTemplateAdvisor = (() => {
  const V = Validator.create('GrooveTemplateAdvisor');
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

    // Subdivision duration in seconds; fallback to 0.125s
    const subdivDur = (Number.isFinite(tpSec) && Number.isFinite(tpSubdiv) && tpSec > 0)
      ? tpSubdiv / tpSec
      : 0.125;

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
   * Rigid → add swing/humanize; loose → tighten toward grid.
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
   * Rigid timing → more velocity variation; loose → less.
   * @returns {number} - 0.8 to 1.3
   */
  function getVelocityHumanizeBias() {
    const profile = getGrooveProfile();
    if (profile.rigid) return 1.25;
    if (profile.loose) return 0.85;
    return 1.0;
  }

  ConductorIntelligence.registerFlickerModifier('GrooveTemplateAdvisor', () => GrooveTemplateAdvisor.getVelocityHumanizeBias(), 0.8, 1.3);

  return {
    getGrooveProfile,
    suggestGrooveFeel,
    getVelocityHumanizeBias
  };
})();
