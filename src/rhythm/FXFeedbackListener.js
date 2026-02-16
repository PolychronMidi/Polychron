// src/rhythm/FXFeedbackListener.js - EventBus listener for FX→Rhythm feedback loops
// Enables stutter/FX intensity to modulate future rhythm pattern selection

FXFeedbackListener = (() => {
  let fxAccumulator = 0;      // Cumulative FX intensity
  const decayRate = 0.9;        // Decay per cycle
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
        if (!data || typeof data !== 'object') throw new Error('FXFeedbackListener: event payload must be an object');
        const stereoPan = Number.isFinite(Number(data.stereoPan)) ? Number(data.stereoPan) : 0;
        const velocityShift = Number.isFinite(Number(data.velocityShift)) ? Number(data.velocityShift) : 0;
        const intensity = stereoPan * velocityShift;
        if (!Number.isFinite(intensity)) {
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
      try {
        Object.defineProperty(method, '_fxIntensityScore', {
          value: score,
          writable: true,
          configurable: true,
          enumerable: false
        });
      } catch {
        /* ignore environments that forbid property definition */
      }

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
    const allMethods = (typeof RhythmRegistry !== 'undefined' && RhythmRegistry && typeof RhythmRegistry.getAll === 'function')
      ? RhythmRegistry.getAll()
      : {};
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
