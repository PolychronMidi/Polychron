// coherenceMonitor.js - Closed-loop feedback that regulates density based on actual output.
// Subscribes to NOTES_EMITTED events, compares actual note counts against the
// conductor's intended density, and feeds a correction bias back into the
// conductorIntelligence density pipeline. This closes the open loop:
// the system now listens to its own song.

coherenceMonitor = (() => {
  const V = validator.create('coherenceMonitor');

  let initialized = false;

  // Tracking state
  const WINDOW_SIZE = 16;    // rolling window of beat-level observations
  const window = [];         // { actual, intended, tick }
  let cumulativeActual = 0;
  let cumulativeIntended = 0;
  const layerWindows = { L1: [], L2: [] };
  const layerBias = { L1: 1.0, L2: 1.0 };

  // Feedback signal
  let coherenceBias = 1.0;   // multiplier fed into density pipeline
  const BIAS_FLOOR = 0.60;
  const BIAS_CEILING = 1.38;  // R29 E3: Raised from 1.3 (max per tuning invariant: 2.5/playScale_max=1.8 -> 1.38)
  const SMOOTHING = 0.55;    // exponential smoothing factor (higher = slower response)

  // Entropy tracking
  let entropySignal = 0;     // -1 (stagnation) to +1 (chaos)
  const ENTROPY_DECAY = 0.92;

  /**
   * Deferred initialization - called from main.js after eventBus is available.
   * Subscribes to NOTES_EMITTED and SECTION_BOUNDARY events.
   */
  function initialize() {
    if (initialized) return;
    V.requireDefined(eventBus, 'eventBus');
    const EVENTS = V.getEventsOrThrow();

    eventBus.on(EVENTS.NOTES_EMITTED, (data) => {
      V.assertObject(data, 'notes-emitted payload');
      const actual = V.requireFinite(data.actual, 'actual');
      const intended = V.requireFinite(data.intended, 'intended');
      if (intended < 0 || actual < 0) {
        throw new Error('coherenceMonitor: actual/intended must be non-negative');
      }

      // Push into rolling window
      window.push({ actual, intended });
      if (window.length > WINDOW_SIZE) window.shift();
      cumulativeActual += actual;
      cumulativeIntended += m.max(1, intended);

      const layer = typeof data.layer === 'string' ? data.layer : null;
      if (layer && layerWindows[layer]) {
        layerWindows[layer].push({ actual, intended });
        if (layerWindows[layer].length > WINDOW_SIZE) layerWindows[layer].shift();
        let lActual = 0, lIntended = 0;
        for (let wi = 0; wi < layerWindows[layer].length; wi++) { lActual += layerWindows[layer][wi].actual; lIntended += layerWindows[layer][wi].intended; }
        const lRatio = lIntended > 0 ? lActual / lIntended : 1;
        layerBias[layer] = clamp(1.0 + (1.0 - lRatio) * 0.3, BIAS_FLOOR, BIAS_CEILING);
      }

      coherenceMonitorUpdateBias();
    });

    // stutter notes contribute to actual density but bypass the normal note path.
    // Count them so the coherence window reflects the true output density.
    eventBus.on(EVENTS.STUTTER_APPLIED, () => {
      cumulativeActual += 1;
      cumulativeIntended += 1;
      if (window.length > 0) {
        window[window.length - 1].actual += 1;
        window[window.length - 1].intended += 1;
        coherenceMonitorUpdateBias();
      }
    });

    // Motif chain expansions also add notes the window wouldn't otherwise see.
    eventBus.on(EVENTS.MOTIF_CHAIN_APPLIED, (data) => {
      const extra = V.requireFinite(data.resultNoteCount, 'resultNoteCount');
      cumulativeActual += extra;
      cumulativeIntended += extra;
      if (window.length > 0) {
        window[window.length - 1].actual += extra;
        window[window.length - 1].intended += extra;
        coherenceMonitorUpdateBias();
      }
    });

    // Phrase boundaries trigger partial decay - keep recent history but attenuate
    // older observations so the new phrase starts with a fresh-ish baseline.
    eventBus.on(EVENTS.PHRASE_BOUNDARY, () => {
      const decayFactor = 0.5;
      for (let i = 0; i < window.length; i++) {
        window[i].actual *= decayFactor;
        window[i].intended *= decayFactor;
      }
      entropySignal *= decayFactor;
    });

    // Cross-check: if the conductor is regulating heavily and we're also
    // pushing a strong bias, detect the feedback loop and dampen.
    eventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
      const regBias = V.requireFinite(data.densityBias, 'densityBias');
      // Both biases pushing in the same direction - dampen ours
      const sameDirection = (regBias > 0 && coherenceBias > 1.0) || (regBias < 0 && coherenceBias < 1.0);
      if (sameDirection) {
        coherenceBias = clamp(
          1.0 + (coherenceBias - 1.0) * 0.6,
          BIAS_FLOOR,
          BIAS_CEILING
        );
      }
    });

    feedbackRegistry.registerLoop(
      'coherenceMonitor',
      'notes_emitted',
      'density',
      () => m.abs(coherenceBias - 1.0) / (BIAS_CEILING - 1.0),
      () => m.sign(coherenceBias - 1.0)
    );

    initialized = true;
  }

  /** Recompute coherence bias from the rolling window. */
  function coherenceMonitorUpdateBias() {
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
    // Uses a bell curve centered at phrase midpoint: sin(progress * pi) peaks at 0.5.
    const phraseProgress = timeStream.normalizedProgress('phrase');
    let phaseGain = 0.35 + 0.4 * m.sin(phraseProgress * m.PI); // 0.35 at edges, 0.75 at center

    // Peer-aware: if a single density contributor is dominating the product,
    // strengthen our correction - the pipeline is unbalanced and needs tighter coherence.
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

    // If emitting too many notes (deviation > 0) - dampen (bias < 1)
    // If emitting too few notes (deviation < 0) - boost (bias > 1)
    const correction = 1.0 - deviation * phaseGain;

    // Density-level awareness: the emission-fidelity check above is blind to
    // upstream suppression (when both intended and actual are equally low).
    // Supplement with a product-level correction when density is structurally
    // depressed. This closes the gap where the system precisely plays its
    // suppressed intentions and sees no deviation.
    const densityProduct = signalReader.density();
    const HEALTHY_DENSITY = 0.78;
    let productCorrection = 1.0;
    if (densityProduct < HEALTHY_DENSITY) {
      const deficit = (HEALTHY_DENSITY - densityProduct) / HEALTHY_DENSITY;
      productCorrection = 1.0 + deficit * 0.50; // up to 1.50 when density at 0
    }
    const blendedCorrection = correction * productCorrection;

    // Smooth the bias to avoid jitter
    let newBias = clamp(
      coherenceBias * SMOOTHING + blendedCorrection * (1 - SMOOTHING),
      BIAS_FLOOR,
      BIAS_CEILING
    );

    const dampening = feedbackRegistry.getResonanceDampening('coherenceMonitor');
    if (dampening < 1.0) {
      newBias = 1.0 + (newBias - 1.0) * dampening;
    }

    coherenceBias = newBias;

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

      // High variance - chaos, low variance - stagnation
      const rawEntropy = clamp(variance - 0.04, -0.5, 0.5) * 2;
      entropySignal = entropySignal * ENTROPY_DECAY + rawEntropy * (1 - ENTROPY_DECAY);
    }
  }

  /** @returns {number} Density bias multiplier for conductorIntelligence. */
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

  // Self-register into conductorIntelligence
  // getDensityBias is called each beat by the conductor pipeline.
  conductorIntelligence.registerDensityBias('coherenceMonitor', getDensityBias, BIAS_FLOOR, BIAS_CEILING); // floor=0.60, ceiling=1.3

  // metrics to conductorState via the state provider registry.
  conductorIntelligence.registerStateProvider('coherenceMonitor', () => ({
    coherenceBias: getDensityBias(),
    coherenceEntropy: getEntropySignal(),
    coherenceWindowSize: window.length
  }));
  conductorIntelligence.registerModule('coherenceMonitor', { reset }, ['section']);

  moduleLifecycle.registerInitializer('coherenceMonitor', initialize);

  return {
    initialize,
    getDensityBias,
    getLayerBias: (layer) => V.optionalFinite(layerBias[layer], 1.0),
    getEntropySignal,
    getMetrics,
    reset
  };
})();
