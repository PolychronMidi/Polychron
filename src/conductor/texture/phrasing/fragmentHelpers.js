// src/conductor/texture/fragmentHelpers.js - Shared pitch-class fragment extraction.
// Used by motivicDensityTracker.
// Pure query - reads absoluteTimeWindow.

fragmentHelpers = (() => {
  const V = validator.create('fragmentHelpers');
  /**
   * Extract pitch-class interval fragments of a given length from recent notes.
   * Each fragment is a string key of consecutive PC intervals (e.g., "3,7").
   * @param {number} [length=3] - fragment note count
   * @param {number} [windowSeconds=6] - lookback window
   * @param {Object} [opts]
   * @param {string} [opts.layer] - optional layer filter
   * @param {boolean} [opts.signed] - if true, use signed intervals (-11 to +11) instead of unsigned mod-12 (0-11)
   * @returns {string[]} - array of fragment keys
   */
  function getPCFragments(length, windowSeconds, opts = {}) {
    const fragLen = (typeof length === 'number' && length >= 2) ? length : 3;
    const ws = V.optionalFinite(windowSeconds, 6);
    const { layer, signed } = opts;
    /** @type {any} */
    const query = { windowSeconds: ws };
    if (typeof layer === 'string' && layer.length > 0) query.layer = layer;
    const notes = L0.query('note', query);
    if (notes.length < fragLen) return [];

    /** @type {string[]} */
    const fragments = [];
    for (let i = 0; i <= notes.length - fragLen; i++) {
      const pcs = [];
      let valid = true;
      for (let j = 0; j < fragLen; j++) {
        const midi = notes[i + j].midi;
        if (!Number.isFinite(midi)) { valid = false; break; }
        pcs.push(((midi % 12) + 12) % 12);
      }
      if (!valid) continue;

      // Build interval key - signed preserves direction, unsigned wraps mod-12
      const intervals = [];
      for (let j = 1; j < pcs.length; j++) {
        intervals.push(signed ? pcs[j] - pcs[j - 1] : ((pcs[j] - pcs[j - 1]) + 12) % 12);
      }
      fragments.push(intervals.join(','));
    }
    return fragments;
  }

  return { getPCFragments };
})();
