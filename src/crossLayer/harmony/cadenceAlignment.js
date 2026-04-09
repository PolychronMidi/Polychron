// src/crossLayer/cadenceAlignment.js - Cross-layer cadence synchronization.
// Posts harmonic tension values to ATG 'tension' channel. When both layers
// independently approach high tension within the same ms window, forces
// simultaneous resolution - syncing cadence points to the same ms-derived tick.

cadenceAlignment = (() => {
  const V = validator.create('cadenceAlignment');
  const CHANNEL = 'tension';
  const BASE_SYNC_TOLERANCE_MS = 400;
  const HIGH_TENSION_THRESHOLD = 0.55;
  const STRONG_TENSION_THRESHOLD = 0.72;
  const EVENTS = eventCatalog.names;

  // Tension-accumulation adaptive threshold (R23 E1, corrected R24/R25).
  // postTension fires per-layer so ~2x per beat pair -- SATURATION_CALLS=60 = ~30 real beats.
  // Relief is exploring=0 (R79 E2 calibrated 0.80 is correct, adding relief creates pump-dump
  // oscillation), evolving=0.03, coherent=0.04 (floor 0.88 -- just enough micro-relief without
  // crossing the sub-0.88 danger zone proven destructive in R19/R23/R24).
  const TENSION_SATURATION_CALLS = 60;
  const THRESHOLD_PRESSURE_RELIEF = { exploring: 0.0, evolving: 0.03, coherent: 0.04 };
  let tensionPressureAccum = 0;

  // R79 E2: Regime-aware sync tolerance and resolution thresholds.
  // In exploring regime, widen the sync window (400->550ms) to create more
  // cross-layer cadence alignment opportunities -- harmonic "anchoring" during
  // adventurous passages. In coherent regime, tighten (400->350ms) for precise
  // alignment. This connects macro regime state to micro harmonic decisions.
  function _getSyncTolerance() {
    const regime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'initializing');
    if (regime === 'exploring') return 550;
    if (regime === 'coherent') return 350;
    return BASE_SYNC_TOLERANCE_MS;
  }

  function _getSupportScale(consensus) {
    if (consensus) return 1.0;
    const regime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'initializing');
    // Exploring: stronger non-consensus support (more cadence resolution)
    // Coherent: weaker non-consensus support (only resolve on strong agreement)
    if (regime === 'exploring') return 0.85;
    if (regime === 'coherent') return 0.62;
    return 0.72;
  }

  /**
   * Post a tension sample from the active layer.
   * @param {number} absoluteSeconds - absolute ms
   * @param {string} layer - source layer
   * @param {number} tension - normalized 0-1 harmonic tension
   * @param {boolean} cadenceSuggested - whether cadenceAdvisor suggests a cadence
   */
  function postTension(absoluteSeconds, layer, tension, cadenceSuggested) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    L0.post(CHANNEL, layer, absoluteSeconds, {
      tension: clamp(tension, 0, 1),
      cadenceSuggested
    });
    // Accumulate pressure when tension is sustained high; slow decay otherwise
    if (tension > HIGH_TENSION_THRESHOLD) {
      tensionPressureAccum = m.min(tensionPressureAccum + 1, TENSION_SATURATION_CALLS);
    } else {
      tensionPressureAccum = m.max(0, tensionPressureAccum - 0.5);
    }
  }

  /**
   * Check if both layers are approaching high tension simultaneously.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} ourTension - this layer's current tension
   * @param {boolean} [ourCadenceSuggested]
   * @returns {{ aligned: boolean, syncOffset: number, combinedTension: number, otherCadenceSuggested: boolean, sharedCadenceIntent: boolean, consensus: boolean } | null}
   */
  function checkAlignment(absoluteSeconds, activeLayer, ourTension, ourCadenceSuggested) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.requireFinite(ourTension, 'ourTension');

    if (ourTension < HIGH_TENSION_THRESHOLD) return null;

    const other = L0.findClosest(
      CHANNEL, absoluteSeconds, _getSyncTolerance() / 1000, activeLayer
    );
    if (!other || V.optionalFinite(other.tension) === undefined) return null;
    if (other.tension < HIGH_TENSION_THRESHOLD) return null;
    const localCadenceSuggested = Boolean(ourCadenceSuggested);
    const otherCadenceSuggested = Boolean(other.cadenceSuggested);
    const sharedCadenceIntent = localCadenceSuggested || otherCadenceSuggested;
    const consensus = localCadenceSuggested && otherCadenceSuggested;
    if (!sharedCadenceIntent && (ourTension < STRONG_TENSION_THRESHOLD || other.tension < STRONG_TENSION_THRESHOLD)) return null;

    // Both layers are at high tension within the same time window
    const syncOffset = crossLayerHelpers.syncOffset(other.timeInSeconds);

    return {
      aligned: true,
      syncOffset,
      combinedTension: (ourTension + other.tension) / 2,
      otherCadenceSuggested,
      sharedCadenceIntent,
      consensus
    };
  }

  /**
   * Apply cadence alignment: when both layers at high tension, bias toward resolution.
   * Returns a cadence bias modifier that can be fed to cadenceAdvisor or chord selection.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} ourTension - this layer's current tension
   * @param {boolean} [ourCadenceSuggested]
   * @returns {{ shouldResolve: boolean, tonicBias: number, dominantBias: number, syncOffset: number, consensus: boolean, sharedCadenceIntent: boolean } | null}
   */
  function applyAlignment(absoluteSeconds, activeLayer, ourTension, ourCadenceSuggested) {
    const alignment = checkAlignment(absoluteSeconds, activeLayer, ourTension, ourCadenceSuggested);
    if (!alignment) return null;

    // Both layers at high tension - strongly bias toward cadential resolution
    const intensityBoost = alignment.combinedTension;
    const supportScale = _getSupportScale(alignment.consensus);

    // No active listeners - emitted for eventCatalog completeness and future extensibility
    eventBus.emit(EVENTS.CROSS_LAYER_CADENCE_ALIGN, {
      layer: activeLayer,
      combinedTension: alignment.combinedTension,
      syncOffset: alignment.syncOffset,
      otherCadenceSuggested: alignment.otherCadenceSuggested,
      absoluteSeconds
    });

    // Tension-accumulation adaptive threshold. Base is regime-aware; pressure
    // (sustained tension beats) reduces it. Relief is regime-capped to protect
    // coherent stability floor (min ~0.89) while allowing more relief in exploring.
    const resolveThreshold = (function() {
      const reg = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'initializing');
      const base = reg === 'exploring' ? 0.80 : reg === 'coherent' ? 0.92 : 0.88;
      const relief = V.optionalFinite(THRESHOLD_PRESSURE_RELIEF[reg], 0.03);
      const pressure = clamp(tensionPressureAccum / TENSION_SATURATION_CALLS, 0, 1);
      return base - pressure * relief;
    })();
    // Melodic coupling: ascendRatio shifts the resolve threshold.
    // High ascendRatio (phrase building) -> raise threshold -> hold resolution.
    // Low ascendRatio (phrase descending) -> lower threshold -> invite resolution.
    const melodicCtxCA = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const ascendRatio = melodicCtxCA ? V.optionalFinite(melodicCtxCA.ascendRatio, 0.5) : 0.5;
    // Rhythmic coupling: strong rhythmic bias at cadence invites resolution (rhythm drives harmonic landing).
    const rhythmEntryCA = L0.getLast('emergentRhythm', { layer: 'both' });
    const rhythmBiasCA = rhythmEntryCA && Number.isFinite(rhythmEntryCA.biasStrength) ? rhythmEntryCA.biasStrength : 0;
    const adjustedResolveThreshold = resolveThreshold + (ascendRatio - 0.5) * 0.04 - rhythmBiasCA * 0.03;
    const shouldResolve = alignment.consensus || alignment.combinedTension > adjustedResolveThreshold;
    if (shouldResolve) tensionPressureAccum = 0; // resolution fired, reset accumulator
    return {
      shouldResolve,
      tonicBias: 0.5 + intensityBoost * 0.4 * supportScale,
      dominantBias: 0.3 + intensityBoost * 0.5 * supportScale,
      syncOffset: alignment.syncOffset,
      consensus: alignment.consensus,
      sharedCadenceIntent: alignment.sharedCadenceIntent
    };
  }

  return { postTension, checkAlignment, applyAlignment, reset() { tensionPressureAccum = 0; } };
})();
crossLayerRegistry.register('cadenceAlignment', cadenceAlignment, ['all']);
