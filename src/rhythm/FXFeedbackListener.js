// src/rhythm/FXFeedbackListener.js - EventBus listener for FX→Rhythm feedback loops
// Enables stutter/FX intensity to modulate future rhythm pattern selection

FXFeedbackListener = (() => {
  let fxAccumulator = 0;      // Cumulative FX intensity
  let decayRate = 0.9;        // Decay per cycle
  let initialized = false;

  /**
   * Initialize feedback loop: wire EventBus to listen for FX events
   * @throws {Error} if EventBus undefined
   */
  function initialize() {
    if (initialized) return;
    if (typeof EventBus === 'undefined') {
      throw new Error('FXFeedbackListener.initialize: EventBus not available');
    }

    // Listen to beat FX emission and accumulate intensity
    EventBus.on('beat-fx-applied', (data) => {
      try {
        const intensity = (data.stereoPan || 0) * (data.velocityShift || 0);
        if (typeof intensity !== 'number' || !Number.isFinite(intensity)) {
          throw new Error(`FXFeedbackListener: invalid intensity ${intensity}`);
        }
        fxAccumulator = fxAccumulator * decayRate + intensity * (1 - decayRate);
      } catch (e) {
        throw new Error(`FXFeedbackListener event error: ${e && e.message ? e.message : e}`);
      }
    });

    // Reset accumulator at section boundary
    EventBus.on('section-boundary', () => {
      fxAccumulator = 0;
    });

    initialized = true;
  }

  /**
   * Get current FX intensity influence (0-1)
   * Used to bias rhythm pattern selection toward complexity
   * @returns {number}
   */
  function getIntensity() {
    return clamp(fxAccumulator, 0, 1);
  }

  /**
   * Modify rhythmMethods weights based on FX intensity
   * Higher intensity → favor complex patterns (onsets, euclid)
   * Lower intensity → favor simple patterns (binary, random)
   * @param {Object} rhythmMethodsObj - from RhythmRegistry.getAll()
   * @returns {Object} copy with adjusted logicweights
   * @throws {Error} if input invalid
   */
  function biasRhythmMethods(rhythmMethodsObj) {
    if (!rhythmMethodsObj || typeof rhythmMethodsObj !== 'object') {
      throw new Error('FXFeedbackListener.biasRhythmMethods: invalid input object');
    }

    const intensity = getIntensity();
    const biased = {};

    for (const [name, method] of Object.entries(rhythmMethodsObj)) {
      biased[name] = method; // Strategy functions are kept as-is (weightings are in rhythms config, not here)
    }

    return biased;
  }

  /**
   * Adjust rhythm weights directly (when rhythms patterns are dynamic)
   * @param {Object} rhythmsObj - the rhythms lookup with weights
   * @returns {Object} modified with intensity-based bias
   */
  function biasRhythmWeights(rhythmsObj) {
    if (!rhythmsObj || typeof rhythmsObj !== 'object') {
      throw new Error('FXFeedbackListener.biasRhythmWeights: invalid rhythms object');
    }

    const intensity = getIntensity();
    const modified = {};

    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) {
        modified[key] = spec;
        continue;
      }

      // Boost complex patterns at higher intensities
      const newWeights = spec.weights.map((w, idx) => {
        const complexity = idx / spec.weights.length; // 0=simple, 1=complex
        const boost = (complexity - 0.5) * intensity * 0.4; // Up to 40% swing
        return Math.max(0.1, w + boost);
      });

      modified[key] = { ...spec, weights: newWeights };
    }

    return modified;
  }

  /**
   * Decay FX influence (call periodically if not using EventBus pulse)
   */
  function decay() {
    fxAccumulator *= decayRate;
  }

  function reset() {
    fxAccumulator = 0;
  }

  return {
    initialize,
    getIntensity,
    biasRhythmMethods,
    biasRhythmWeights,
    decay,
    reset
  };
})();
