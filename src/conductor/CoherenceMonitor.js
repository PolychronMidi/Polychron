// CoherenceMonitor.js â€” Closed-loop feedback that regulates density based on actual output.
// Subscribes to NOTES_EMITTED events, compares actual note counts against the
// conductor's intended density, and feeds a correction bias back into the
// ConductorIntelligence density pipeline. This closes the open loop:
// the system now listens to its own song.

CoherenceMonitor = (() => {
  const V = Validator.create('coherenceMonitor');

  let initialized = false;

  // â”€â”€ Tracking state â”€â”€
  const WINDOW_SIZE = 16;    // rolling window of beat-level observations
  const window = [];         // { actual, intended, tick }
  let cumulativeActual = 0;
  let cumulativeIntended = 0;

  // â”€â”€ Feedback signal â”€â”€
  let coherenceBias = 1.0;   // multiplier fed into density pipeline
  const BIAS_FLOOR = 0.70;
  const BIAS_CEILING = 1.3;
  const SMOOTHING = 0.55;    // exponential smoothing factor (higher = slower response)

  // â”€â”€ Entropy tracking â”€â”€
  let entropySignal = 0;     // -1 (stagnation) to +1 (chaos)
  const ENTROPY_DECAY = 0.92;

  /**
   * Deferred initialization â€” called from main.js after EventBus is available.
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

    // Stutter notes contribute to actual density but bypass the normal note path.
    // Count them so the coherence window reflects the true output density.
    EventBus.on(EVENTS.STUTTER_APPLIED, () => {
      cumulativeActual += 1;
      cumulativeIntended += 1;
      if (window.length > 0) {
        window[window.length - 1].actual += 1;
        window[window.length - 1].intended += 1;
        _updateBias();
      }
    });

    // Motif chain expansions also add notes the window wouldn't otherwise see.
    EventBus.on(EVENTS.MOTIF_CHAIN_APPLIED, (data) => {
      const extra = V.requireFinite(data.resultNoteCount, 'resultNoteCount');
      cumulativeActual += extra;
      cumulativeIntended += extra;
      if (window.length > 0) {
        window[window.length - 1].actual += extra;
        window[window.length - 1].intended += extra;
        _updateBias();
      }
    });

    // Phrase boundaries trigger partial decay â€” keep recent history but attenuate
    // older observations so the new phrase starts with a fresh-ish baseline.
    EventBus.on(EVENTS.PHRASE_BOUNDARY, () => {
      const decayFactor = 0.5;
      for (let i = 0; i < window.length; i++) {
        window[i].actual *= decayFactor;
        window[i].intended *= decayFactor;
      }
      entropySignal *= decayFactor;
    });

    // Cross-check: if the conductor is regulating heavily and we're also
    // pushing a strong bias, detect the feedback loop and dampen.
    EventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
      const regBias = V.requireFinite(data.densityBias, 'densityBias');
      // Both biases pushing in the same direction â†’ dampen ours
      const sameDirection = (regBias > 0 && coherenceBias > 1.0) || (regBias < 0 && coherenceBias < 1.0);
      if (sameDirection) {
        coherenceBias = clamp(
          1.0 + (coherenceBias - 1.0) * 0.6,
          BIAS_FLOOR,
          BIAS_CEILING
        );
      }
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
    // Uses a bell curve centered at phrase midpoint: sin(progress * Ï€) peaks at 0.5.
    const phraseProgress = TimeStream.normalizedProgress('phrase');
    let phaseGain = 0.35 + 0.4 * m.sin(phraseProgress * m.PI); // 0.35 at edges, 0.75 at center

    // Peer-aware: if a single density contributor is dominating the product,
    // strengthen our correction â€” the pipeline is unbalanced and needs tighter coherence.
    const attr = signalReader.densityAttribution();
    if (attr.contributions.length > 1) {
      let minC = Infinity;
      let maxC = -Infinity;
      for (let i = 0; i < attr.contributions.length; i++) {
        const c = attr.contributions[i].clamped;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
      const spread = maxC - minC;
      if (spread > 0.25) {
        phaseGain *= 1.0 + clamp(spread - 0.25, 0, 0.5); // up to 50% stronger correction
      }
    }

    // If emitting too many notes (deviation > 0) â†’ dampen (bias < 1)
    // If emitting too few notes (deviation < 0) â†’ boost (bias > 1)
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

      // High variance â†’ chaos, low variance â†’ stagnation
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

  // â”€â”€ Self-register into ConductorIntelligence â”€â”€
  // getDensityBias is called each beat by the conductor pipeline.
  ConductorIntelligence.registerDensityBias('CoherenceMonitor', getDensityBias, BIAS_FLOOR, BIAS_CEILING); // floor=0.70, ceiling=1.3

  // metrics to ConductorState via the state provider registry.
  ConductorIntelligence.registerStateProvider('CoherenceMonitor', () => ({
    coherenceBias: getDensityBias(),
    coherenceEntropy: getEntropySignal(),
    coherenceWindowSize: window.length
  }));
  ConductorIntelligence.registerModule('CoherenceMonitor', { reset }, ['section']);

  return {
    initialize,
    getDensityBias,
    getEntropySignal,
    getMetrics,
    reset
  };
})();
