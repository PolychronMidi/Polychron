// src/conductor/syncopationDensityTracker.js - Measures off-beat onset ratio.
// Detects metric monotony (all on-beat) or excessive syncopation (all off-beat).
// Pure query API - biases rhythm pattern selection weights.

syncopationDensityTracker = (() => {
  const V = validator.create('syncopationDensityTracker');
  const WINDOW_SECONDS = 4;

  /**
   * Compute the ratio of syncopated (off-beat) onsets in recent notes.
   * Uses tpBeat to determine beat-grid alignment.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ syncopationRatio: number, onBeatCount: number, offBeatCount: number, total: number, monotonous: boolean, excessive: boolean }}
   */
  function getSyncopationProfile(opts = {}) {
    const notes = analysisHelpers.getWindowNotes(V, opts, WINDOW_SECONDS);
    if (notes.length < 3) {
      return { syncopationRatio: 0, onBeatCount: 0, offBeatCount: 0, total: 0, monotonous: false, excessive: false };
    }

    // Beat duration in seconds; fallback to 0.5s if unavailable
    const beatDur = beatGridHelpers.getBeatDuration();

    let onBeat = 0;
    let offBeat = 0;

    for (let i = 0; i < notes.length; i++) {
      const t = notes[i].time;
      // Distance from nearest beat grid line
      const beatPhase = t % beatDur;
      const distFromBeat = m.min(beatPhase, beatDur - beatPhase);
      // On-beat if within 15% of beat duration from grid
      if (distFromBeat < beatDur * 0.15) {
        onBeat++;
      } else {
        offBeat++;
      }
    }

    const total = onBeat + offBeat;
    const syncopationRatio = total > 0 ? offBeat / total : 0;

    return {
      syncopationRatio,
      onBeatCount: onBeat,
      offBeatCount: offBeat,
      total,
      monotonous: syncopationRatio < 0.15,
      excessive: syncopationRatio > 0.7
    };
  }

  /**
   * Bias factor for rhythm pattern weights.
   * Monotonous - boost syncopated patterns; excessive - boost straight patterns.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ syncopationBias: number, straightBias: number }}
   */
  function getRhythmBias(opts) {
    const profile = getSyncopationProfile(opts);
    if (profile.monotonous) {
      return { syncopationBias: 1.3, straightBias: 0.8 };
    }
    if (profile.excessive) {
      return { syncopationBias: 0.75, straightBias: 1.25 };
    }
    return { syncopationBias: 1.0, straightBias: 1.0 };
  }

  conductorIntelligence.registerStateProvider('syncopationDensityTracker', () => {
    const b = syncopationDensityTracker.getRhythmBias();
    return { syncopationBias: b ? b.syncopationBias : 1 };
  });
  // Scalar wrapper: monotonous rhythm -> boost density to create variety (1.12),
  // excessive syncopation -> reduce density to allow breathing (0.88).
  conductorIntelligence.registerDensityBias('syncopationDensityTracker', () => {
    const b = syncopationDensityTracker.getRhythmBias();
    return b.syncopationBias > 1.0 ? 1.12 : (b.syncopationBias < 1.0 ? 0.88 : 1.0);
  }, 0.88, 1.12);
  // R13 E3: Flicker bias from syncopation. Syncopated passages (off-beat
  // dominant) inject flicker variation (1.08) -- rhythmic displacement
  // pairs with timbral excitement. Monotonous patterns (all on-beat)
  // get flicker reduction (0.94) -- steady rhythm with simpler timbre.
  // This couples rhythmic character to timbral texture.
  conductorIntelligence.registerFlickerModifier('syncopationDensityTracker', () => {
    const p = syncopationDensityTracker.getSyncopationProfile();
    if (p.excessive) return 1.08;
    if (p.monotonous) return 0.94;
    if (p.syncopationRatio > 0.40) return 1.0 + (p.syncopationRatio - 0.40) * 0.27;
    return 1.0;
  }, 0.92, 1.10);
  // R33 E3: Tension bias from syncopation. Syncopated passages (off-beat
  // dominant) create rhythmic tension via metric displacement. Monotonous
  // (all on-beat) passages are metrically stable -> lower tension.
  // New rhythmic->tension cross-domain pathway.
  conductorIntelligence.registerTensionBias('syncopationDensityTracker', () => {
    const p = syncopationDensityTracker.getSyncopationProfile();
    if (p.excessive) return 1.06;
    if (p.monotonous) return 0.96;
    if (p.syncopationRatio > 0.40) return 1.0 + (p.syncopationRatio - 0.40) * 0.20;
    return 1.0;
  }, 0.96, 1.06);

  return {
    getSyncopationProfile,
    getRhythmBias
  };
})();
