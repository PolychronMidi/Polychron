// src/crossLayer/crossLayerClimaxEngine.js — Multi-parameter climax coordination.
// Detects and orchestrates climax moments across both layers.
// When section progress, interaction heat, and conductor intensity all converge
// above thresholds, coordinates a unified climactic build:
// increases density, widens register, boosts velocity, raises entropy target.

CrossLayerClimaxEngine = (() => {
  const V = Validator.create('CrossLayerClimaxEngine');
  const APPROACH_THRESHOLD = 0.65;
  const PEAK_THRESHOLD = 0.82;
  const SMOOTHING = 0.25;

  let smoothedClimax = 0;
  let peakReached = false;
  let climaxCount = 0;

  /**
   * Tick the climax detector each beat.
   * @param {number} absTimeMs
   */
  function tick(absTimeMs) {
    V.requireFinite(absTimeMs, 'absTimeMs');

    // Gather signals
    const sectionArc = Math.sin(clamp(TimeStream.compoundProgress('section'), 0, 1) * Math.PI); // peaks mid-section

    const sigs = conductorSignalBridge.getSignals();
    // Blend compositeIntensity with elevated density/tension products for richer peak detection
    const densityPressure = clamp((sigs.density - 0.9) / 0.6, 0, 1);
    const tensionPressure = clamp((sigs.tension - 0.9) / 0.6, 0, 1);
    const conductorIntensity = clamp(sigs.compositeIntensity * 0.6 + densityPressure * 0.2 + tensionPressure * 0.2, 0, 1);

    const heatLevel = clamp(InteractionHeatMap.getDensity(), 0, 1);

    const intent = SectionIntentCurves.getLastIntent();
    const intentPressure = (intent.densityTarget + intent.interactionTarget) / 2;

    // Composite climax signal
    const raw = sectionArc * 0.25 + conductorIntensity * 0.3 + heatLevel * 0.2 + intentPressure * 0.25;
    smoothedClimax = smoothedClimax * (1 - SMOOTHING) + raw * SMOOTHING;

    // Detect peak crossing
    if (smoothedClimax >= PEAK_THRESHOLD && !peakReached) {
      peakReached = true;
      climaxCount++;
    } else if (smoothedClimax < APPROACH_THRESHOLD) {
      peakReached = false;
    }
  }

  /**
   * Get climax modifiers for a specific layer.
   * @returns {{ playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }}
   */
  function getModifiers(/* layer */) {
    if (smoothedClimax < APPROACH_THRESHOLD) {
      return { playProbScale: 1.0, velocityScale: 1.0, registerBias: 0, entropyTarget: -1 };
    }

    // Approaching or at climax: scale parameters
    const intensity = clamp((smoothedClimax - APPROACH_THRESHOLD) / (1 - APPROACH_THRESHOLD), 0, 1);

    return {
      playProbScale: 1.0 + intensity * 0.35,     // up to +35% density
      velocityScale: 1.0 + intensity * 0.25,      // up to +25% velocity
      registerBias: intensity * 6,                 // widen register by up to 6 semitones
      entropyTarget: 0.5 + intensity * 0.4         // push entropy toward 0.9
    };
  }

  /**
   * Whether the system is currently approaching or at a climax.
   * @returns {boolean}
   */
  function isApproaching() {
    return smoothedClimax >= APPROACH_THRESHOLD;
  }

  /** @returns {boolean} */
  function isPeak() { return peakReached; }

  /** @returns {number} */
  function getClimaxLevel() { return smoothedClimax; }

  /** @returns {number} */
  function getClimaxCount() { return climaxCount; }

  function reset() {
    smoothedClimax = 0;
    peakReached = false;
    climaxCount = 0;
  }

  return { tick, getModifiers, isApproaching, isPeak, getClimaxLevel, getClimaxCount, reset };
})();
CrossLayerRegistry.register('CrossLayerClimaxEngine', CrossLayerClimaxEngine, ['all', 'section']);
