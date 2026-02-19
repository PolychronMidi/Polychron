// src/conductor/SyncopationDensityTracker.js - Measures off-beat onset ratio.
// Detects metric monotony (all on-beat) or excessive syncopation (all off-beat).
// Pure query API — biases rhythm pattern selection weights.

SyncopationDensityTracker = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Compute the ratio of syncopated (off-beat) onsets in recent notes.
   * Uses tpBeat to determine beat-grid alignment.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ syncopationRatio: number, onBeatCount: number, offBeatCount: number, total: number, monotonous: boolean, excessive: boolean }}
   */
  function getSyncopationProfile(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 3) {
      return { syncopationRatio: 0, onBeatCount: 0, offBeatCount: 0, total: 0, monotonous: false, excessive: false };
    }

    // Beat duration in seconds; fallback to 0.5s if unavailable
    const beatDur = (typeof tpSec !== 'undefined' && typeof tpBeat !== 'undefined'
      && Number.isFinite(tpSec) && Number.isFinite(tpBeat) && tpSec > 0)
      ? tpBeat / tpSec
      : 0.5;

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
   * Monotonous → boost syncopated patterns; excessive → boost straight patterns.
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

  return {
    getSyncopationProfile,
    getRhythmBias
  };
})();
