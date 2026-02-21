// CoherenceMonitor.js — Closed-loop feedback that regulates density based on actual output.
// Subscribes to NOTES_EMITTED events, compares actual note counts against the
// conductor's intended density, and feeds a correction bias back into the
// ConductorIntelligence density pipeline. This closes the open loop:
// the system now listens to its own song.

CoherenceMonitor = (() => {
  const V = Validator.create('CoherenceMonitor');

  let initialized = false;

  // ── Tracking state ──
  const WINDOW_SIZE = 16;    // rolling window of beat-level observations
  const window = [];         // { actual, intended, tick }
  let cumulativeActual = 0;
  let cumulativeIntended = 0;

  // ── Feedback signal ──
  let coherenceBias = 1.0;   // multiplier fed into density pipeline
  const BIAS_FLOOR = 0.75;
  const BIAS_CEILING = 1.3;
  const SMOOTHING = 0.88;    // exponential smoothing factor (higher = slower response)

  // ── Entropy tracking ──
  let entropySignal = 0;     // -1 (stagnation) to +1 (chaos)
  const ENTROPY_DECAY = 0.92;

  /**
   * Deferred initialization — called from main.js after EventBus is available.
   * Subscribes to NOTES_EMITTED and SECTION_BOUNDARY events.
   */
  function initialize() {
    if (initialized) return;
    V.requireDefined(EventBus, 'EventBus');
    const EVENTS = V.getEventsOrThrow();

    EventBus.on(EVENTS.NOTES_EMITTED, (data) => {
      V.assertObject(data, 'notes-emitted payload');
      const actual = V.requireFinite(data.actual, 'actual');
      const intended = V.requireFinite(data.intended, 'intended');
      if (intended < 0 || actual < 0) {
        throw new Error('CoherenceMonitor: actual/intended must be non-negative');
      }

      // Push into rolling window
      window.push({ actual, intended });
      if (window.length > WINDOW_SIZE) window.shift();
      cumulativeActual += actual;
      cumulativeIntended += m.max(1, intended);

      _updateBias();
    });

    EventBus.on(EVENTS.SECTION_BOUNDARY, () => {
      reset();
    });

    initialized = true;
  }

  /** Recompute coherence bias from the rolling window. */
  function _updateBias() {
    if (window.length === 0) return;

    // Window-level emission ratio
    let windowActual = 0;
    let windowIntended = 0;
    for (let i = 0; i < window.length; i++) {
      windowActual += window[i].actual;
      windowIntended += m.max(1, window[i].intended);
    }
    const windowRatio = windowIntended > 0 ? windowActual / windowIntended : 1;

    // Deviation from 1.0 (perfect coherence)
    const deviation = windowRatio - 1.0;

    // Phase-aware correction strength: boundaries are tolerant, mid-phrase enforces tighter.
    // Uses a bell curve centered at phrase midpoint: sin(progress * π) peaks at 0.5.
    const phraseProgress = TimeStream.normalizedProgress('phrase');
    const phaseGain = 0.25 + 0.3 * m.sin(phraseProgress * m.PI); // 0.25 at edges, 0.55 at center

    // If emitting too many notes (deviation > 0) → dampen (bias < 1)
    // If emitting too few notes (deviation < 0) → boost (bias > 1)
    const correction = 1.0 - deviation * phaseGain;

    // Smooth the bias to avoid jitter
    coherenceBias = clamp(
      coherenceBias * SMOOTHING + correction * (1 - SMOOTHING),
      BIAS_FLOOR,
      BIAS_CEILING
    );

    // Update entropy signal: measures variance in recent ratios
    if (window.length >= 4) {
      let mean = 0;
      for (let i = 0; i < window.length; i++) {
        const r = window[i].intended > 0 ? window[i].actual / m.max(1, window[i].intended) : 1;
        mean += r;
      }
      mean /= window.length;
      let variance = 0;
      for (let i = 0; i < window.length; i++) {
        const r = window[i].intended > 0 ? window[i].actual / m.max(1, window[i].intended) : 1;
        variance += (r - mean) * (r - mean);
      }
      variance /= window.length;

      // High variance → chaos, low variance → stagnation
      const rawEntropy = clamp(variance - 0.04, -0.5, 0.5) * 2;
      entropySignal = entropySignal * ENTROPY_DECAY + rawEntropy * (1 - ENTROPY_DECAY);
    }
  }

  /** @returns {number} Density bias multiplier for ConductorIntelligence. */
  function getDensityBias() {
    return clamp(coherenceBias, BIAS_FLOOR, BIAS_CEILING);
  }

  /** @returns {number} Entropy signal: negative = stagnation, positive = chaos. */
  function getEntropySignal() {
    return clamp(entropySignal, -1, 1);
  }

  /** @returns {{ bias: number, entropy: number, windowSize: number, cumActual: number, cumIntended: number }} */
  function getMetrics() {
    return {
      bias: clamp(coherenceBias, BIAS_FLOOR, BIAS_CEILING),
      entropy: clamp(entropySignal, -1, 1),
      windowSize: window.length,
      cumActual: cumulativeActual,
      cumIntended: cumulativeIntended
    };
  }

  function reset() {
    window.length = 0;
    cumulativeActual = 0;
    cumulativeIntended = 0;
    coherenceBias = 1.0;
    entropySignal = 0;
  }

  // ── Self-register into ConductorIntelligence ──
  // getDensityBias is called each beat by the conductor pipeline.
  ConductorIntelligence.registerDensityBias('CoherenceMonitor', getDensityBias, BIAS_FLOOR, BIAS_CEILING);

  // metrics to ConductorState via the state provider registry.
  ConductorIntelligence.registerStateProvider('CoherenceMonitor', () => ({
    coherenceBias: getDensityBias(),
    coherenceEntropy: getEntropySignal(),
    coherenceWindowSize: window.length
  }));

  return {
    initialize,
    getDensityBias,
    getEntropySignal,
    getMetrics,
    reset
  };
})();
