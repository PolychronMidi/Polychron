// src/conductor/attackDensityProfiler.js - Attack vs. sustain note ratio tracker.
// Measures the ratio of short/percussive (attack-heavy) notes to long/legato
// (sustain-heavy) notes. Density bias for articulation balance.
// Pure query API - no side effects.

attackDensityProfiler = (() => {
  const WINDOW_SECONDS = 6;
  const SHORT_THRESHOLD = 0.15; // seconds - notes shorter than this are "attacks"

  // Beat-level cache: getAttackSignal is called 2x per beat (densityBias + stateProvider)
  const attackDensityProfilerCache = beatCache.create(() => attackDensityProfilerGetAttackSignal());

  /**
   * Analyze attack/sustain ratio from recent notes.
   * @returns {{ attackRatio: number, sustainRatio: number, densityBias: number, suggestion: string }}
   */
  function getAttackSignal() { return attackDensityProfilerCache.get(); }

  /** @private */
  function attackDensityProfilerGetAttackSignal() {
    const notes = L0.query('note', { windowSeconds: WINDOW_SECONDS });

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

    // Continuous ramp: sustain-heavy - boost density; attack-heavy - reduce.
    // attackRatio 0-0.3 maps to 1.05-1.0; attackRatio 0.5-1.0 maps to 1.0-0.94.
    let densityBias = 1;
    if (attackRatio < 0.3) {
      densityBias = 1.0 + clamp((0.3 - attackRatio) / 0.3, 0, 1) * 0.05;
    } else if (attackRatio > 0.5) {
      densityBias = 1.0 - clamp((attackRatio - 0.5) / 0.5, 0, 1) * 0.06;
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

  conductorIntelligence.registerDensityBias('attackDensityProfiler', () => attackDensityProfiler.getDensityBias(), 0.9, 1.1);
  conductorIntelligence.registerStateProvider('attackDensityProfiler', () => {
    const s = attackDensityProfiler.getAttackSignal();
    return { attackSuggestion: s ? s.suggestion : 'balanced' };
  });

  return {
    getAttackSignal,
    getDensityBias
  };
})();
