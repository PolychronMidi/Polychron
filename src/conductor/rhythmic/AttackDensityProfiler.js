// src/conductor/AttackDensityProfiler.js - Attack vs. sustain note ratio tracker.
// Measures the ratio of short/percussive (attack-heavy) notes to long/legato
// (sustain-heavy) notes. Density bias for articulation balance.
// Pure query API — no side effects.

AttackDensityProfiler = (() => {
  const WINDOW_SECONDS = 6;
  const SHORT_THRESHOLD = 0.15; // seconds — notes shorter than this are "attacks"

  /**
   * Analyze attack/sustain ratio from recent notes.
   * @returns {{ attackRatio: number, sustainRatio: number, densityBias: number, suggestion: string }}
   */
  function getAttackSignal() {
    const notes = (typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.getNotes === 'function')
      ? AbsoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS })
      : [];

    if (notes.length < 4) {
      return { attackRatio: 0.5, sustainRatio: 0.5, densityBias: 1, suggestion: 'balanced' };
    }

    let attacks = 0;
    let sustains = 0;

    for (let i = 0; i < notes.length; i++) {
      const dur = (typeof notes[i].duration === 'number') ? notes[i].duration : 0.3;
      if (dur <= SHORT_THRESHOLD) attacks++;
      else sustains++;
    }

    const total = attacks + sustains;
    if (total === 0) {
      return { attackRatio: 0.5, sustainRatio: 0.5, densityBias: 1, suggestion: 'balanced' };
    }

    const attackRatio = attacks / total;
    const sustainRatio = sustains / total;

    // Density bias: too many attacks → slight reduction (let notes breathe);
    // too many sustains → slight increase (add rhythmic interest)
    let densityBias = 1;
    if (attackRatio > 0.75) {
      densityBias = 0.94; // very percussive → thin out
    } else if (sustainRatio > 0.8) {
      densityBias = 1.05; // all sustained → add some attacks
    }

    let suggestion = 'balanced';
    if (attackRatio > 0.7) suggestion = 'attack-heavy';
    else if (sustainRatio > 0.7) suggestion = 'sustain-heavy';

    return { attackRatio, sustainRatio, densityBias, suggestion };
  }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getAttackSignal().densityBias;
  }

  return {
    getAttackSignal,
    getDensityBias
  };
})();
