// src/rhythm/FXFeedbackListener.js - EventBus listener for FX→Rhythm feedback loops
// Enables stutter/FX intensity to modulate future rhythm pattern selection

FXFeedbackListener = (() => {
  const V = Validator.create('FXFeedbackListener');

  let accumulator = null;
  let initialized = false;

  function ensureAccumulator() {
    if (accumulator) return accumulator;
    if (!FeedbackAccumulator || typeof FeedbackAccumulator.create !== 'function') {
      throw new Error('FXFeedbackListener: FeedbackAccumulator.create is required');
    }
    const EVENTS = V.getEventsOrThrow();

    accumulator = FeedbackAccumulator.create({
      name: 'fx-feedback',
      decayRate: 0.9,
      inputs: [
        {
          eventName: EVENTS.BEAT_FX_APPLIED,
          project(data) {
            const stereoPan = V.requireFinite(data.stereoPan, 'beat-fx-applied.stereoPan');
            const velocityShift = V.requireFinite(data.velocityShift, 'beat-fx-applied.velocityShift');
            const intensity = stereoPan * velocityShift;
            if (!Number.isFinite(intensity)) {
              throw new Error(`FXFeedbackListener: invalid intensity ${intensity}`);
            }
            return clamp(intensity, 0, 1);
          }
        },
        {
          eventName: EVENTS.TEXTURE_CONTRAST,
          project(data) {
            V.assertObject(data, 'texture-contrast payload');
            V.assertNonEmptyString(data.mode, 'texture-contrast.mode');
            const mode = data.mode;
            const composite = V.requireFinite(data.composite, 'texture-contrast.composite');
            const modeWeight = mode === 'chordBurst' ? 0.5 : mode === 'flurry' ? 0.3 : 0.1;
            const textureIntensity = modeWeight * composite;
            V.requireFinite(textureIntensity, 'texture-contrast.intensity');
            return clamp(textureIntensity, 0, 1);
          }
        }
      ]
    });

    return accumulator;
  }

  /**
   * Initialize feedback loop: wire EventBus to listen for FX events
   * @throws {Error} if EventBus undefined
   */
  function initialize() {
    if (initialized) return;
    ensureAccumulator().initialize();

    initialized = true;
  }

  /**
   * Get current FX intensity influence (0-1)
   * Used to bias rhythm pattern selection toward complexity
   * @returns {number}
   */
  function getIntensity() {
    if (!initialized || !accumulator) {
      throw new Error('FXFeedbackListener.getIntensity: listener not initialized');
    }
    return accumulator.getIntensity();
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

    // Base complexity mapping (0 = simple, 1 = complex). Tweak these values to tune method affinities.
    const complexityMap = {
      random: 0.2,
      binary: 0.25,
      hex: 0.3,
      prob: 0.3,
      rotate: 0.35,
      closestDivisor: 0.4,
      morph: 0.55,
      onsets: 0.75,
      euclid: 0.9
    };

    // Compute a per-method preference score in [0,1].
    // - intensity === 1 => score === baseComplexity (favor complex methods)
    // - intensity === 0 => score === 1 - baseComplexity (favor simple methods)
    // - intensity === 0.5 => score === 0.5 (neutral)
    for (const [name, method] of Object.entries(rhythmMethodsObj)) {
      if (typeof method !== 'function') {
        throw new Error(`FXFeedbackListener.biasRhythmMethods: method "${name}" is not a function`);
      }

      const baseComplexity = (complexityMap[name] !== undefined) ? complexityMap[name] : 0.5;
      const score = clamp(baseComplexity * intensity + (1 - baseComplexity) * (1 - intensity), 0, 1);

      // Attach non-enumerable metadata so callers can inspect bias without changing method behavior.
      Object.defineProperty(method, '_fxIntensityScore', {
        value: score,
        writable: true,
        configurable: true,
        enumerable: false
      });

      biased[name] = method;
    }

    return biased;
  }

  /**
   * Adjust rhythm weights directly (when rhythms patterns are dynamic)
   * This now factors in per-method `_fxIntensityScore` (from `biasRhythmMethods`) so
   * methods like `euclid`/`onsets` are favored at high FX intensity while `random`/`binary`
   * are favored at low intensity. The original complexity-based tweak is preserved and
   * combined with the method multiplier for predictable, low-risk behavior changes.
   * @param {Object} rhythmsObj - the rhythms lookup with weights
   * @returns {Object} modified with intensity-based bias
   */
  function biasRhythmWeights(rhythmsObj) {
    if (!rhythmsObj || typeof rhythmsObj !== 'object') {
      throw new Error('FXFeedbackListener.biasRhythmWeights: invalid rhythms object');
    }

    const intensity = getIntensity();
    const modified = {};

    // Build a small map of method -> _fxIntensityScore (defaults to 0.5 neutral)
    const methodScores = {};
    const allMethods = RhythmRegistry.getAll();
    const biasedMethods = biasRhythmMethods(allMethods);
    for (const [mName, fn] of Object.entries(biasedMethods)) {
      methodScores[mName] = (fn && typeof fn._fxIntensityScore === 'number') ? fn._fxIntensityScore : 0.5;
    }

    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) {
        modified[key] = spec;
        continue;
      }

      const methodName = spec.method;
      const methodScore = (methodName && methodScores[methodName] !== undefined) ? methodScores[methodName] : 0.5;
      // method multiplier: at intensity=1 this gives up to +/-25% weighting swing
      const methodMultiplier = 1 + (methodScore - 0.5) * intensity * 0.5;

      const newWeights = spec.weights.map((w, idx) => {
        const wN = Number.isFinite(Number(w)) ? Number(w) : 0.1;
        const complexity = idx / spec.weights.length; // 0=simple, 1=complex
        const complexityBoost = (complexity - 0.5) * intensity * 0.4; // preserve previous behavior
        const adjusted = (wN + complexityBoost) * methodMultiplier;
        return m.max(0.1, adjusted);
      });

      modified[key] = { ...spec, weights: newWeights };
    }

    return modified;
  }

  /**
   * Decay FX influence (call periodically if not using EventBus pulse)
   */
  function decay() {
    if (!accumulator) return;
    accumulator.decay();
  }

  function reset() {
    if (!accumulator) return;
    accumulator.reset();
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
