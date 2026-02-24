// src/rhythm/RhythmHistoryTracker.js - Tracks recent rhythm method selections.
// Provides novelty bias by penalizing recently-used rhythm patterns.
// Integrates into getRhythm() as an additional bias stage.

RhythmHistoryTracker = (() => {
  const V = Validator.create('rhythmHistoryTracker');
  const WINDOW = 12; // track last 12 rhythm selections
  /** @type {Array<{ method: string, length: number, layer: string }>} */
  const history = [];

  /**
   * Record a rhythm method selection.
   * @param {string} method - rhythm method key (e.g. 'euclid', 'binary')
   * @param {number} length - pattern length
   * @param {string} layer - layer identifier
   */
  function record(method, length, layer) {
    V.assertNonEmptyString(method, 'record.method');
    V.assertFinite(length, 'record.length');
    V.assertNonEmptyString(layer, 'record.layer');
    history.push({ method, length: Number(length), layer });
    if (history.length > WINDOW * 3) history.splice(0, history.length - WINDOW);
  }

  /**
   * Apply repetition penalty to a candidate rhythm weight map.
   * Recently-used methods get lower weights, encouraging novelty.
   * @param {Object} candidates - rhythm candidates keyed by name with { weights } shape
   * @returns {Object} - same structure with adjusted weights
   */
  function penalizeRepetition(candidates) {
    V.assertObject(candidates, 'penalizeRepetition.candidates');
    const recent = history.slice(-WINDOW);
    if (recent.length === 0) return candidates;

    // Count recent method frequencies
    const counts = {};
    for (let i = 0; i < recent.length; i++) {
      const key = recent[i].method;
      const existing = counts[key];
      if (typeof existing === 'undefined') {
        counts[key] = 1;
      } else {
        counts[key] = V.requireFinite(existing, `penalizeRepetition.counts.${key}`) + 1;
      }
    }

    const result = {};
    const keys = Object.keys(candidates);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const entry = candidates[key];
      if (!entry || !Array.isArray(entry.weights)) {
        result[key] = entry;
        continue;
      }
      const penalty = counts[key] ? 1 / (1 + counts[key] * 0.25) : 1;
      result[key] = {
        ...entry,
        weights: entry.weights.map(w => w * penalty)
      };
    }
    return result;
  }

  /**
   * Get the most recently used method name (or null).
   * @returns {string|null}
   */
  function getLastMethod() {
    return history.length > 0 ? history[history.length - 1].method : null;
  }

  /**
   * Get the count of distinct methods used in the recent window.
   * @returns {number}
   */
  function getVariety() {
    const recent = history.slice(-WINDOW);
    return new Set(recent.map(r => r.method)).size;
  }

  /** Reset history. */
  function reset() {
    history.length = 0;
  }

  return {
    record,
    penalizeRepetition,
    getLastMethod,
    getVariety,
    reset
  };
})();

