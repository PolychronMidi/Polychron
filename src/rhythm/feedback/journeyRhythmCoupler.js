// src/rhythm/journeyRhythmCoupler.js - Harmonic journey - rhythm complexity coupling
// Bold key moves trigger higher rhythm complexity via eventBus journey-move events

journeyRhythmCoupler = (() => {
  const V = validator.create('journeyRhythmCoupler');

  // Per-layer boldness prevents L1's journey energy from contaminating L2's rhythm bias
  const boldnessByLayer = { L1: 0, L2: 0 };
  const externalBiasByLayer = { L1: 1, L2: 1 };
  let journeyRhythmCouplerBoldness = 0;
  let journeyRhythmCouplerExternalBias = 1;
  const journeyRhythmCouplerDecayRate = 0.85;
  let journeyRhythmCouplerInitialized = false;

  /**
   * Map journey move distance + type to a boldness score (0-1).
   * Distant chromatic moves = high boldness - complex rhythms.
   * Static holds and gentle returns = low boldness - simple rhythms.
   * @param {number} distance - chromatic semitone distance (0-6)
   * @param {string} move - journey move type name
   * @returns {number} boldness 0-1
   */
  function moveToBoldness(distance, move) {
    if (move === 'hold' || move === 'origin') return 0;
    if (move === 'return-home') return 0.1;

    // Distance-based boldness curve - roughly linear with saturation at tritone
    if (distance <= 1) return 0.15;
    if (distance <= 2) return 0.25;
    if (distance <= 3) return 0.4;
    if (distance <= 4) return 0.55;
    if (distance <= 5) return 0.7;
    return 0.85; // distance 6 = tritone - maximum harmonic tension
  }

  /**
   * Initialize: listen for journey-move events via eventBus.
   * @throws {Error} if eventBus not available
   */
  function initialize() {
    if (journeyRhythmCouplerInitialized) return;
    V.requireDefined(eventBus, 'eventBus');
    const EVENTS = V.getEventsOrThrow();

    eventBus.on(EVENTS.JOURNEY_MOVE, (data) => {
      V.assertObject(data, 'journey-move payload');
      const distance = V.requireFinite(data.distance, 'journey-move.distance');
      V.assertNonEmptyString(data.move, 'journey-move.move');
      const move = data.move;
      journeyRhythmCouplerBoldness = moveToBoldness(distance, move);
      const evtLayer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
      boldnessByLayer[evtLayer] = journeyRhythmCouplerBoldness;
    });

    crossLayerRegistry.register('journeyRhythmCoupler', { reset: resetSection }, ['section']);
    journeyRhythmCouplerInitialized = true;
  }

  /**
   * Get current boldness boost (0-1).
   * @returns {number}
   */
  function getBoldness() {
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    const b = boldnessByLayer[layer] !== undefined ? boldnessByLayer[layer] : journeyRhythmCouplerBoldness;
    const e = externalBiasByLayer[layer] !== undefined ? externalBiasByLayer[layer] : journeyRhythmCouplerExternalBias;
    return clamp(b * e, 0, 1);
  }

  function setExternalBias(value) {
    const num = Number(value);
    V.requireFinite(num, 'num');
    journeyRhythmCouplerExternalBias = clamp(num, 0.5, 1.5);
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    externalBiasByLayer[layer] = journeyRhythmCouplerExternalBias;
  }

  /**
   * Bias rhythm weights based on journey boldness.
   * Higher boldness - favor complex rhythm patterns (later weight indices).
   * Designed to chain with FXFeedbackListener.biasRhythmWeights() in getRhythm.js.
   * @param {Object} rhythmsObj - rhythm lookup with weights
   * @returns {Object} copy with boldness-biased weights
   */
  function biasRhythmWeights(rhythmsObj) {
    V.assertObject(rhythmsObj, 'rhythmsObj');

    const boldness = getBoldness();
    if (boldness < 0.05) return rhythmsObj; // No significant bias - pass through

    // R98 E3: Regime-responsive boldness amplification.
    // Exploring amplifies boldness effect, coherent dampens it.
    const regimeSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const regime = regimeSnap && regimeSnap.regime ? regimeSnap.regime : 'evolving';
    const boldnessScale = regime === 'exploring' ? 1.30
      : regime === 'coherent' ? 0.75
      : 1.0;

    const modified = {};
    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) {
        modified[key] = spec;
        continue;
      }

      const newWeights = spec.weights.map((w, idx) => {
        const wN = V.optionalFinite(Number(w), 0.1);
        const complexity = idx / spec.weights.length; // 0 = simple, 1 = complex
        // Bold harmonic moves push weight toward complex end
        const boldnessBoost = (complexity - 0.5) * boldness * 0.3 * boldnessScale;
        return m.max(0.1, wN + boldnessBoost);
      });

      modified[key] = { ...spec, weights: newWeights };
    }

    return modified;
  }

  /**
   * Manual decay (for periodic non-eventBus contexts).
   */
  function decay() {
    journeyRhythmCouplerBoldness *= journeyRhythmCouplerDecayRate;
    const decayLayer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    boldnessByLayer[decayLayer] = journeyRhythmCouplerBoldness;
  }

  /**
   * Partial boldness decay at section boundaries (not full reset - let it linger).
   */
  function resetSection() {
    journeyRhythmCouplerBoldness *= 0.5;
  }

  /**
   * Reset state.
   */
  function reset() {
    journeyRhythmCouplerBoldness = 0;
    journeyRhythmCouplerExternalBias = 1;
    journeyRhythmCouplerInitialized = false;
  }

  moduleLifecycle.registerInitializer('journeyRhythmCoupler', initialize);

  return {
    initialize,
    getBoldness,
    setExternalBias,
    biasRhythmWeights,
    decay,
    reset,
    resetSection
  };
})();
