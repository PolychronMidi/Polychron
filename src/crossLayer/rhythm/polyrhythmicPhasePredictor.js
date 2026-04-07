

/**
 * Polyrhythmic Phase Predictor (E7)
 *
 * Uses POLYRHYTHM_PAIRS to forecast when the two metric layers will
 * next converge (LCM-based downbeat alignment). Posts predictions to
 * absoluteTimeGrid and registers a cross-layer module that nudges
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
      timeStream.normalizedProgress('phrase') > 0
        ? timeStream.getBounds('phrase') * (1000 / 120) // approximate ms from phrase bound
        : 0,
      4000
    );

    const stepMs = phraseLen / cycle;
    const nowMs  = V.optionalFinite(beatStartTime, 0);

    for (let i = 1; i <= cycle; i++) {
      if (i % d1 === 0 && i % d2 === 0) {
        const t = nowMs + i * stepMs;
        predictions.push(t);
        L0.post(CHANNEL, '0', t / 1000, { cycle, step: i });
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
      timeStream.normalizedProgress('phrase') > 0
        ? timeStream.getBounds('phrase') * (1000 / 120)
        : 0,
      4000
    );
    const window = phraseLen * BOOST_WINDOW;

    let minDist = Infinity;
    for (const t of predictions) {
      const d = m.abs(t - nowMs);
      if (d < minDist) minDist = d;
    }

    if (minDist < window) {
      const proximity = 1.0 - minDist / window;
      // Melodic coupling: counterpoint motion scales convergence boost.
      // Contrary motion at convergence creates dramatic cross-voice tension -> amplify.
      // Similar motion amplifies the shared direction -> moderate boost.
      const melodicCtxPPP = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
      const cpMult = melodicCtxPPP
        ? (melodicCtxPPP.counterpoint === 'contrary' ? 1.35
          : melodicCtxPPP.counterpoint === 'similar' ? 1.15 : 1.0)
        : 1.0;
      // R77 E5: emergentRhythm hotspots coupling -- dense moments amplify phase convergence boost
      const rhythmEntryPPP = L0.getLast('emergentRhythm', { layer: 'both' });
      const hotspotsPPP = rhythmEntryPPP && Array.isArray(rhythmEntryPPP.hotspots) ? rhythmEntryPPP.hotspots.length : 0;
      const hotspotMult = 1.0 + clamp(hotspotsPPP / 16, 0, 1) * 0.20;
      return PROB_BOOST * proximity * cpMult * hotspotMult;
    }

    return 0;
  }

  function reset() {
    predictions = [];
  }

  // Cross-layer registration
  const mod = { process, reset, predictConvergences };

  crossLayerRegistry.register('polyrhythmicPhasePredictor', mod, ['all', 'phrase']);

  return mod;
})();
