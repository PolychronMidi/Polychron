// src/conductor/RegisterMigrationTracker.js - Tracks directional pitch-center drift.
// Detects ascending, descending, or static register migration over time.
// Pure query API â€” nudges pitch gravity toward underexplored registers.

RegisterMigrationTracker = (() => {
  const V = Validator.create('registerMigrationTracker');
  const WINDOW_SECONDS = 6;

  /**
   * Measure the average pitch center across time slices and detect drift direction.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ avgPitch: number, slope: number, direction: string, static: boolean }}
   */
  function getMigrationProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { avgPitch: 60, slope: 0, direction: 'insufficient', static: true };
    }

    // Extract MIDI pitches and use shared half-split slope
    /** @type {number[]} */
    const midis = [];
    for (let i = 0; i < notes.length; i++) {
      midis.push((typeof notes[i].midi === 'number') ? notes[i].midi : 60);
    }
    const { slope, avgFirst, avgSecond } = analysisHelpers.halfSplitSlope(midis);
    const avgPitch = (avgFirst + avgSecond) / 2;

    let direction = 'static';
    if (slope > 2) direction = 'ascending';
    else if (slope < -2) direction = 'descending';

    return {
      avgPitch,
      slope,
      direction,
      static: m.abs(slope) < 1.5
    };
  }

  /**
   * Suggest a register correction to counteract drift or monotony.
   * Ascending â†’ bias downward; descending â†’ bias upward; static â†’ encourage movement.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ registerBias: number, suggestion: string }}
   */
  function getRegisterBias(opts) {
    const profile = getMigrationProfile(opts);
    if (profile.direction === 'ascending') {
      return { registerBias: -3, suggestion: 'lower-register' };
    }
    if (profile.direction === 'descending') {
      return { registerBias: 3, suggestion: 'higher-register' };
    }
    if (profile.static) {
      // Static: suggest exploring opposite of current center
      const bias = profile.avgPitch > 66 ? -4 : 4;
      return { registerBias: bias, suggestion: 'explore-range' };
    }
    return { registerBias: 0, suggestion: 'maintain' };
  }

  ConductorIntelligence.registerStateProvider('RegisterMigrationTracker', () => {
    const b = RegisterMigrationTracker.getRegisterBias();
    return {
      registerMigrationBias: b ? b.registerBias : 0,
      registerSuggestion: b ? b.suggestion : 'maintain'
    };
  });

  return {
    getMigrationProfile,
    getRegisterBias
  };
})();

