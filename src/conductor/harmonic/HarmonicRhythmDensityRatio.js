// src/conductor/HarmonicRhythmDensityRatio.js - Ratio of harmonic change rate to onset rate.
// Detects imbalance: fast harmony + sparse notes, or slow harmony + dense notes.
// Pure query API — corrects density when harmonic and melodic activity diverge.

HarmonicRhythmDensityRatio = (() => {
  const WINDOW_SECONDS = 6;

  /**
   * Compute the ratio of harmonic rhythm to note onset density.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ ratio: number, harmonicRate: number, onsetRate: number, imbalanced: boolean, suggestion: string }}
   */
  function getRatioProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;

    // Harmonic rhythm from HarmonicRhythmTracker (0-1 normalized)
    const harmonicRate = (HarmonicRhythmTracker && typeof HarmonicRhythmTracker.getHarmonicRhythm === 'function')
      ? clamp(Number(HarmonicRhythmTracker.getHarmonicRhythm()), 0, 1)
      : 0.5;

    // Onset density from notes in window
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    const onsetRate = notes.length > 1 && ws > 0
      ? clamp(notes.length / (ws * 4), 0, 1) // normalize: ~4 notes/sec = 1.0
      : 0.3;

    // Ratio: harmonic activity / onset activity
    const ratio = onsetRate > 0.01 ? harmonicRate / onsetRate : 1;

    let suggestion = 'balanced';
    let imbalanced = false;

    if (ratio > 2) {
      // Fast harmony, sparse notes — need more notes to support changes
      suggestion = 'increase-density';
      imbalanced = true;
    } else if (ratio < 0.4) {
      // Slow harmony, dense notes — harmony can't keep up
      suggestion = 'decrease-density';
      imbalanced = true;
    }

    return { ratio, harmonicRate, onsetRate, imbalanced, suggestion };
  }

  /**
   * Get a density correction bias.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.85 to 1.2
   */
  function getDensityBias(opts) {
    const profile = getRatioProfile(opts);
    if (profile.suggestion === 'increase-density') return 1.15;
    if (profile.suggestion === 'decrease-density') return 0.88;
    return 1.0;
  }

  ConductorIntelligence.registerDensityBias('HarmonicRhythmDensityRatio', () => HarmonicRhythmDensityRatio.getDensityBias(), 0.85, 1.2);

  return {
    getRatioProfile,
    getDensityBias
  };
})();
