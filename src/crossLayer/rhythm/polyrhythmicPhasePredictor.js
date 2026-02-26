// @ts-check

/**
 * Polyrhythmic Phase Predictor (E7)
 *
 * Uses POLYRHYTHM_PAIRS to forecast when the two metric layers will
 * next converge (LCM-based downbeat alignment). Posts predictions to
 * AbsoluteTimeGrid and registers a cross-layer module that nudges
 * playProb upward near predicted convergence points.
 */

polyrhythmicPhasePredictor = (() => {
  const V = validator.create('polyrhythmicPhasePredictor');

  const CHANNEL        = 'phaseConvergence';
  const BOOST_WINDOW   = 0.15;   // fraction of phrase length
  const PROB_BOOST     = 0.06;

  let predictions    = [];

  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  function lcm(a, b) { return (a / gcd(a, b)) * b; }

  /**
   * On phrase reset, compute convergence points for current pair.
   */
  function predictConvergences() {
    predictions = [];

    const l1 = layerManager.getLayer('1');
    const l2 = layerManager.getLayer('2');
    if (!l1 || !l2) return;

    const d1 = l1.subdivisions || l1.divisions || 4;
    const d2 = l2.subdivisions || l2.divisions || 4;
    const cycle = lcm(d1, d2);

    const phraseLen = V.optionalFinite(
      TimeStream.normalizedProgress('phrase') > 0
        ? TimeStream.getBounds('phrase') * (1000 / 120) // approximate ms from phrase bound
        : 0,
      4000
    );

    const stepMs = phraseLen / cycle;
    const nowMs  = V.optionalFinite(beatStartTime, 0);

    for (let i = 1; i <= cycle; i++) {
      if (i % d1 === 0 && i % d2 === 0) {
        const t = nowMs + i * stepMs;
        predictions.push(t);
        AbsoluteTimeGrid.post(CHANNEL, '0', t, { cycle, step: i });
      }
    }
  }

  /**
   * Per-beat: check proximity to next convergence.
   * Returns a playProb additive modifier (consumed via process()).
   */
  function process(beatCtx) {
    if (predictions.length === 0) { return 0; }

    const nowMs = V.optionalFinite(beatCtx && beatCtx.absoluteTimeMs, 0);
    const phraseLen = V.optionalFinite(
      TimeStream.normalizedProgress('phrase') > 0
        ? TimeStream.getBounds('phrase') * (1000 / 120)
        : 0,
      4000
    );
    const window = phraseLen * BOOST_WINDOW;

    let minDist = Infinity;
    for (const t of predictions) {
      const d = Math.abs(t - nowMs);
      if (d < minDist) minDist = d;
    }

    if (minDist < window) {
      const proximity = 1.0 - minDist / window;
      return PROB_BOOST * proximity;
    }

    return 0;
  }

  function reset() {
    predictions = [];
  }

  // Cross-layer registration
  const mod = { process, reset, predictConvergences };

  CrossLayerRegistry.register('polyrhythmicPhasePredictor', mod, ['all', 'phrase']);

  return mod;
})();
