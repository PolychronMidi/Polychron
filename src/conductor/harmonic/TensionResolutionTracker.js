// src/conductor/TensionResolutionTracker.js - Tracks dissonance→consonance resolution.
// Detects dangling unresolved tension (dissonant intervals not followed by resolution).
// Pure query API — modifies derivedTension to penalize sustained unresolved dissonance.

TensionResolutionTracker = (() => {
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
    const { layer, windowSeconds } = opts;
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { resolvedRatio: 1, unresolvedCount: 0, total: 0, danglingTension: false };
    }

    let resolved = 0;
    let unresolved = 0;

    for (let i = 1; i < notes.length - 1; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : 60;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : 60;
      const next = (typeof notes[i + 1].midi === 'number') ? notes[i + 1].midi : 60;

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

    // Check last interval pair — if dissonant, it's dangling
    if (notes.length >= 2) {
      const lastInterval = m.abs(
        ((typeof notes[notes.length - 1].midi === 'number') ? notes[notes.length - 1].midi : 60) -
        ((typeof notes[notes.length - 2].midi === 'number') ? notes[notes.length - 2].midi : 60)
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
   * Dangling unresolved → boost tension to signal need for resolution.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.9 to 1.25
   */
  function getTensionBias(opts) {
    const profile = getResolutionProfile(opts);
    if (profile.danglingTension) return 1.2;
    if (profile.resolvedRatio < 0.5) return 1.1;
    return 1.0;
  }

  ConductorIntelligence.registerTensionBias('TensionResolutionTracker', () => TensionResolutionTracker.getTensionBias(), 0.9, 1.25);

  return {
    getResolutionProfile,
    getTensionBias
  };
})();
