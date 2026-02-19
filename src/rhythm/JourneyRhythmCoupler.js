// src/rhythm/JourneyRhythmCoupler.js - Harmonic journey → rhythm complexity coupling
// Bold key moves trigger higher rhythm complexity via EventBus journey-move events

JourneyRhythmCoupler = (() => {
  function getEventsOrThrow() {
    if (typeof EventCatalog === 'undefined' || !EventCatalog || !EventCatalog.names) {
      throw new Error('JourneyRhythmCoupler: EventCatalog.names is required');
    }
    return EventCatalog.names;
  }

  let _boldness = 0;
  let _externalBias = 1;
  const _decayRate = 0.85;
  let _initialized = false;

  /**
   * Map journey move distance + type to a boldness score (0-1).
   * Distant chromatic moves = high boldness → complex rhythms.
   * Static holds and gentle returns = low boldness → simple rhythms.
   * @param {number} distance - chromatic semitone distance (0-6)
   * @param {string} move - journey move type name
   * @returns {number} boldness 0-1
   */
  function moveToBoldness(distance, move) {
    if (move === 'hold' || move === 'origin') return 0;
    if (move === 'return-home') return 0.1;

    // Distance-based boldness curve — roughly linear with saturation at tritone
    if (distance <= 1) return 0.15;
    if (distance <= 2) return 0.25;
    if (distance <= 3) return 0.4;
    if (distance <= 4) return 0.55;
    if (distance <= 5) return 0.7;
    return 0.85; // distance 6 = tritone — maximum harmonic tension
  }

  /**
   * Initialize: listen for journey-move events via EventBus.
   * @throws {Error} if EventBus not available
   */
  function initialize() {
    if (_initialized) return;
    if (typeof EventBus === 'undefined') {
      throw new Error('JourneyRhythmCoupler.initialize: EventBus not available');
    }
    const EVENTS = getEventsOrThrow();

    EventBus.on(EVENTS.JOURNEY_MOVE, (data) => {
      if (!data || typeof data !== 'object') {
        throw new Error('JourneyRhythmCoupler: invalid journey-move payload');
      }
      const distance = Number(data.distance);
      if (!Number.isFinite(distance)) {
        throw new Error('JourneyRhythmCoupler: journey-move.distance must be finite');
      }
      if (typeof data.move !== 'string' || data.move.length === 0) {
        throw new Error('JourneyRhythmCoupler: journey-move.move must be a non-empty string');
      }
      const move = data.move;
      _boldness = moveToBoldness(distance, move);
    });

    // Partial boldness decay at section boundaries (not full reset — let it linger)
    EventBus.on(EVENTS.SECTION_BOUNDARY, () => {
      _boldness *= 0.5;
    });

    _initialized = true;
  }

  /**
   * Get current boldness boost (0-1).
   * @returns {number}
   */
  function getBoldness() {
    return clamp(_boldness * _externalBias, 0, 1);
  }

  function setExternalBias(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error('JourneyRhythmCoupler.setExternalBias: value must be finite');
    }
    _externalBias = clamp(num, 0.5, 1.5);
  }

  /**
   * Bias rhythm weights based on journey boldness.
   * Higher boldness → favor complex rhythm patterns (later weight indices).
   * Designed to chain with FXFeedbackListener.biasRhythmWeights() in getRhythm.js.
   * @param {Object} rhythmsObj - rhythm lookup with weights
   * @returns {Object} copy with boldness-biased weights
   */
  function biasRhythmWeights(rhythmsObj) {
    if (!rhythmsObj || typeof rhythmsObj !== 'object') {
      throw new Error('JourneyRhythmCoupler.biasRhythmWeights: invalid rhythms object');
    }

    const boldness = getBoldness();
    if (boldness < 0.05) return rhythmsObj; // No significant bias — pass through

    const modified = {};
    for (const [key, spec] of Object.entries(rhythmsObj)) {
      if (!spec || !Array.isArray(spec.weights)) {
        modified[key] = spec;
        continue;
      }

      const newWeights = spec.weights.map((w, idx) => {
        const wN = Number.isFinite(Number(w)) ? Number(w) : 0.1;
        const complexity = idx / spec.weights.length; // 0 = simple, 1 = complex
        // Bold harmonic moves push weight toward complex end
        const boldnessBoost = (complexity - 0.5) * boldness * 0.3;
        return m.max(0.1, wN + boldnessBoost);
      });

      modified[key] = { ...spec, weights: newWeights };
    }

    return modified;
  }

  /**
   * Manual decay (for periodic non-EventBus contexts).
   */
  function decay() {
    _boldness *= _decayRate;
  }

  /**
   * Reset state.
   */
  function reset() {
    _boldness = 0;
    _externalBias = 1;
    _initialized = false;
  }

  return {
    initialize,
    getBoldness,
    setExternalBias,
    biasRhythmWeights,
    decay,
    reset
  };
})();
