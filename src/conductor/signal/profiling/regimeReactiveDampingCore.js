// regimeReactiveDampingCore.js -- Pure computation functions extracted for testability.
// No globals, no side effects. Input -> output only.
// Tests can call these directly without loading the entire conductor subsystem.

regimeReactiveDampingCore = (() => {

  /**
   * Compute the tension shape curve value for a given section progress.
   * @param {string} shape - 'flat', 'ascending', 'arch', 'sawtooth', 'erratic'
   * @param {number} progress - 0..1 section progress
   * @returns {number} 0..1 tension curve value
   */
  function tensionShapeCurve(shape, progress) {
    switch (shape) {
      case 'flat':      return 0.5;
      case 'ascending': return progress;
      case 'sawtooth':  return (progress * 3) % 1.0;
      case 'erratic':   return 0.5 + m.sin(progress * 17.3) * 0.4 + m.cos(progress * 7.1) * 0.3;
      default:          return m.sin(progress * m.PI); // arch
    }
  }

  /**
   * Compute the regime budget equilibrator correction.
   * @param {Record<string, number>} ringShares - current regime share per regime
   * @param {Record<string, number>} budget - target regime share per regime
   * @param {number} strength - equilibrator strength multiplier
   * @returns {{ corrD: number, corrT: number, corrF: number }}
   */
  function equilibratorCorrection(ringShares, budget, strength) {
    let corrD = 0, corrT = 0, corrF = 0;
    for (const regime of Object.keys(budget)) {
      const actual = ringShares[regime] ?? 0;
      const target = budget[regime] ?? 0;
      const excess = actual - target;
      if (m.abs(excess) < 0.02) continue;
      // Exploring excess -> suppress density+flicker, boost tension (dampen chaos)
      // Coherent excess -> boost density+flicker, suppress tension (inject variety)
      const sign = regime === 'exploring' ? 1 : regime === 'coherent' ? -1 : 0;
      const correction = excess * strength * sign;
      corrD -= correction;
      corrT += correction * 0.5;
      corrF -= correction * 0.8;
    }
    return { corrD, corrT, corrF };
  }

  /**
   * Scale a base max value by a metaprofile target.
   * @param {number} base - hardcoded base max (e.g. 0.12)
   * @param {number} target - metaprofile target value
   * @param {number} referenceTarget - default target (scaling neutral point)
   * @returns {number} scaled max value
   */
  function scaleByTarget(base, target, referenceTarget) {
    if (!Number.isFinite(target) || !Number.isFinite(referenceTarget) || referenceTarget === 0) return base;
    return base * (target / referenceTarget);
  }

  return {
    tensionShapeCurve,
    equilibratorCorrection,
    scaleByTarget,
  };
})();
