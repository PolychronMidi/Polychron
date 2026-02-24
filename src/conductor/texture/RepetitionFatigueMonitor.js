// src/conductor/RepetitionFatigueMonitor.js - Detects exact pitch-sequence repetition.
// Flags melodic loops/ruts at short timescales (2-6 note patterns recurring within 4s).
// Pure query API â€” penalty weight for VoiceLeadingScore or composer note selection.

RepetitionFatigueMonitor = (() => {
  const V = Validator.create('repetitionFatigueMonitor');
  const WINDOW_SECONDS = 4;
  const MIN_PATTERN = 2;
  const MAX_PATTERN = 6;

  /**
   * Detect repeating pitch-class sequences in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ fatigueLevel: number, repeatedPatterns: number, totalPatterns: number, fatigued: boolean }}
   */
  function getRepetitionProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < MIN_PATTERN * 2) {
      return { fatigueLevel: 0, repeatedPatterns: 0, totalPatterns: 0, fatigued: false };
    }

    const pitches = [];
    for (let i = 0; i < notes.length; i++) {
      pitches.push((typeof notes[i].midi === 'number') ? notes[i].midi % 12 : 0);
    }

    // Check for exact n-gram repetitions
    let repeatedCount = 0;
    let checkedCount = 0;

    for (let len = MIN_PATTERN; len <= m.min(MAX_PATTERN, m.floor(pitches.length / 2)); len++) {
      const seen = /** @type {Object.<string, number>} */ ({});
      for (let i = 0; i <= pitches.length - len; i++) {
        const key = pitches.slice(i, i + len).join(',');
        seen[key] = (seen[key] || 0) + 1;
        checkedCount++;
      }
      const keys = Object.keys(seen);
      for (let k = 0; k < keys.length; k++) {
        const count = seen[keys[k]];
        if (typeof count === 'number' && count > 1) {
          repeatedCount += count - 1;
        }
      }
    }

    const fatigueLevel = checkedCount > 0 ? clamp(repeatedCount / checkedCount, 0, 1) : 0;

    return {
      fatigueLevel,
      repeatedPatterns: repeatedCount,
      totalPatterns: checkedCount,
      fatigued: fatigueLevel > 0.3
    };
  }

  /**
   * Get a repetition penalty multiplier for note selection.
   * High fatigue → stronger penalty against repeated pitches.
   * Continuous interpolation avoids chronic ceiling-lock.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 1.0 (no penalty) to 1.3 (strong penalty)
   */
  function getRepetitionPenalty(opts) {
    const profile = getRepetitionProfile(opts);
    // Continuous ramp: onset at 0.20, full at 1.0 — wider range and lower max avoids
    // chronic ceiling-lock in small pitch-class spaces where mod-12 n-gram
    // repetition is naturally high.
    if (profile.fatigueLevel <= 0.20) return 1.0;
    const ramp = clamp((profile.fatigueLevel - 0.20) / 0.80, 0, 1);
    return 1.0 + ramp * 0.3;
  }

  ConductorIntelligence.registerTensionBias('RepetitionFatigueMonitor', () => RepetitionFatigueMonitor.getRepetitionPenalty(), 1, 1.3);

  return {
    getRepetitionProfile,
    getRepetitionPenalty
  };
})();
