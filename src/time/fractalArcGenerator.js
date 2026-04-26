

/**
 * Fractal Arc Generator - Multi-Scale Arc Embedding (E8)
 *
 * Generates self-similar sub-arcs within each section/phrase using
 * a simple fractal subdivision. Provides normalised arc intensity at
 * any time-scale level, consumed by conductor modules that want
 * multi-scale envelope shaping.
 *
 * API:
 *   fractalArcGenerator.intensity(level)  - 0..1  (level = 0 section, 1 phrase, 2 measure)
 *   fractalArcGenerator.composite()       - blended 0..1 across all scales
 *   fractalArcGenerator.reset()
 */

moduleLifecycle.declare({
  name: 'fractalArcGenerator',
  subsystem: 'time',
  deps: ['validator'],
  provides: ['fractalArcGenerator'],
  init: (deps) => {
  const V = deps.validator.create('fractalArcGenerator');

  /** @type {TimeStreamLevel[]} */
  const LEVELS  = ['section', 'phrase', 'measure'];
  const WEIGHTS = [0.50, 0.35, 0.15];

  /**
   * Single-scale arc: simple raised-cosine (0-1-0).
   * progress  [0,1]
   */
  function arcShape(progress) {
    const p = m.max(0, m.min(1, progress));
    return 0.5 * (1 - m.cos(2 * m.PI * p));
  }

  /**
   * Return intensity for a given time-scale level index.
   * @param {number} levelIdx  0 = section, 1 = phrase, 2 = measure
   * @returns {number} 0..1
   */
  function intensity(levelIdx) {
    const lvl = LEVELS[levelIdx];
    if (!lvl) return 0.5;
    const p = timeStream.normalizedProgress(lvl);
    return arcShape(V.optionalFinite(p, 0.5));
  }

  /**
   * Weighted blend across all scales - single 0..1 value.
   */
  function composite() {
    let sum = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      sum += WEIGHTS[i] * intensity(i);
    }
    return sum;
  }

  function reset() { /* stateless - nothing to clear */ }

  return { intensity, composite, arcShape, reset };
  },
});
