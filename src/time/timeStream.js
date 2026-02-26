// timeStream.js - Navigable metric hierarchy abstraction.
// Tracks current position and bounds at every structural level.
// Allows composers and cross-layer modules to query where they are,
// look ahead/behind, compute progress, and detect boundaries -
// without coupling to the imperative loop structure in layerPass.

timeStream = (() => {
  const V = validator.create('timeStream');

  const LEVELS = Object.freeze(['section', 'phrase', 'measure', 'beat', 'div', 'subdiv', 'subsubdiv']);
  const LEVEL_SET = new Set(LEVELS);
  const DEPTH = Object.freeze({ section: 0, phrase: 1, measure: 2, beat: 3, div: 4, subdiv: 5, subsubdiv: 6 });

  // Current index at each level (updated by the loop driver)
  const pos = { section: 0, phrase: 0, measure: 0, beat: 0, div: 0, subdiv: 0, subsubdiv: 0 };

  // Units-per-parent at each level (set when structure is determined)
  const bounds = { section: 1, phrase: 1, measure: 1, beat: 1, div: 1, subdiv: 1, subsubdiv: 1 };

  // Position updates

  /** Set current index at a structural level. Called by main/layerPass as loops iterate. */
  function setPosition(level, index) {
    V.assertInSet(level, LEVEL_SET, 'level');
    pos[level] = V.requireFinite(index, 'index');
  }

  /** Set units-per-parent count for a structural level. */
  function setBounds(level, count) {
    V.assertInSet(level, LEVEL_SET, 'level');
    const n = V.requireFinite(count, 'count');
    if (n <= 0) throw new Error('timeStream.setBounds: count must be > 0');
    bounds[level] = n;
  }

  /** @returns {number} Current index at the given level. */
  function getPosition(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return pos[level];
  }

  /** @returns {number} Total units at the given level. */
  function getBounds(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return bounds[level];
  }

  /** @returns {number} 0..1 progress within the current parent at this level (reaches 1 at last index). */
  function progress(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return bounds[level] > 1 ? pos[level] / (bounds[level] - 1) : 0;
  }

  /** @returns {number} 0..1 normalized progress: pos / bounds (matches existing codebase convention). */
  function normalizedProgress(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return bounds[level] > 0 ? pos[level] / bounds[level] : 0;
  }

  /**
   * Overall progress through the composition as a single 0..1 value.
   * Computed as a weighted nested fraction: section + phrase/sections + measure/(sections*phrases) + ...
   */
  function globalProgress() {
    if (bounds.section <= 0) return 0;
    let p = pos.section / bounds.section;
    let divisor = bounds.section;

    const pairs = [
      ['phrase', 'phrase'], ['measure', 'measure'], ['beat', 'beat'],
      ['div', 'div'], ['subdiv', 'subdiv'], ['subsubdiv', 'subsubdiv']
    ];

    for (const [level] of pairs) {
      if (bounds[level] <= 0) break;
      divisor *= bounds[level];
      p += pos[level] / divisor;
    }
    return clamp(p, 0, 1);
  }

  /** @returns {number} How many units remain at this level (including current). */
  function remaining(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return m.max(0, bounds[level] - pos[level] - 1);
  }

  /** @returns {boolean} True if at the first unit of this level. */
  function isFirst(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return pos[level] === 0;
  }

  /** @returns {boolean} True if at the last unit of this level. */
  function isLast(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return pos[level] >= bounds[level] - 1;
  }

  /**
   * Hypothetical index n steps ahead at this level (clamped to bounds).
   * @param {string} level
   * @param {number} n - positive integer
   * @returns {number} clamped future index
   */
  function lookAhead(level, n) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return m.min(pos[level] + V.requireFinite(n, 'n'), bounds[level] - 1);
  }

  /**
   * Hypothetical index n steps behind at this level (clamped to 0).
   * @param {string} level
   * @param {number} n - positive integer
   * @returns {number} clamped past index
   */
  function lookBehind(level, n) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return m.max(pos[level] - V.requireFinite(n, 'n'), 0);
  }

  /** @returns {number} Depth index (0=section, 6=subsubdiv) of the given level. */
  function depth(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    return DEPTH[level];
  }

  /**
   * Frozen snapshot of current position and bounds.
   * Useful for diagnostic logging or state capture.
   */
  function snapshot() {
    return Object.freeze({
      pos: Object.assign({}, pos),
      bounds: Object.assign({}, bounds),
      globalProgress: globalProgress()
    });
  }

  /**
   * Generator that yields indices from start to end-1.
   * Forward-looking API for non-linear or speculative iteration.
   * @param {number} start
   * @param {number} end
   * @yields {number}
   */
  function* range(start, end) {
    const s = V.requireFinite(start, 'start');
    const e = V.requireFinite(end, 'end');
    for (let i = s; i < e; i++) yield i;
  }

  /** Ordered level names. */
  function getLevels() { return LEVELS; }

  /** Reset all positions to 0 (bounds unchanged). */
  function resetPositions() {
    for (const level of LEVELS) pos[level] = 0;
  }

  /**
   * Compound progress within the current parent at the given level,
   * rolling up all sub-level positions into a single 0..1 value.
   * E.g. compoundProgress('phrase') yields a fraction that includes
   * measure, beat, div, subdiv, and subsubdiv contributions.
   * @param {string} level
   * @returns {number} 0..1
   */
  function compoundProgress(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    const d = DEPTH[level];
    if (bounds[level] <= 0) return 0;
    let p = pos[level] / bounds[level];
    let divisor = bounds[level];
    for (let i = d + 1; i < LEVELS.length; i++) {
      const sub = LEVELS[i];
      if (bounds[sub] <= 0) break;
      divisor *= bounds[sub];
      p += pos[sub] / divisor;
    }
    return clamp(p, 0, 1);
  }

  /**
   * Reset all positions strictly below the given level to 0.
   * Called when a parent level advances (e.g. new phrase â†’ reset measure, beat, ...).
   * @param {string} level
   */
  function resetSubLevels(level) {
    V.assertInSet(level, LEVEL_SET, 'level');
    const d = DEPTH[level];
    for (let i = d + 1; i < LEVELS.length; i++) {
      pos[LEVELS[i]] = 0;
    }
  }

  /**
   * Human-readable hierarchical position string.
   * E.g. "S2:P3:M1:B4" (section 2, phrase 3, measure 1, beat 4).
   * @returns {string}
   */
  function positionString() {
    return `S${pos.section}:P${pos.phrase}:M${pos.measure}:B${pos.beat}`;
  }

  return {
    setPosition,
    setBounds,
    getPosition,
    getBounds,
    progress,
    normalizedProgress,
    globalProgress,
    remaining,
    isFirst,
    isLast,
    lookAhead,
    lookBehind,
    depth,
    snapshot,
    range,
    getLevels,
    resetPositions,
    compoundProgress,
    resetSubLevels,
    positionString
  };
})();
