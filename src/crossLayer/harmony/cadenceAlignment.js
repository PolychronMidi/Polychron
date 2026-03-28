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
    if (!other || !Number.isFinite(other.tension)) return null;
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

    // R79 E2: Regime-aware resolve threshold. Exploring: lower (0.80) for
    // more harmonic anchoring. Coherent: higher (0.92) for fewer forced resolutions.
    const resolveThreshold = (function() {
      const reg = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'initializing');
      if (reg === 'exploring') return 0.80;
      if (reg === 'coherent') return 0.92;
      return 0.88;
    })();
    return {
      shouldResolve: alignment.consensus || alignment.combinedTension > resolveThreshold,
      tonicBias: 0.5 + intensityBoost * 0.4 * supportScale,
      dominantBias: 0.3 + intensityBoost * 0.5 * supportScale,
      syncOffset: alignment.syncOffset,
      consensus: alignment.consensus,
      sharedCadenceIntent: alignment.sharedCadenceIntent
    };
  }

  return { postTension, checkAlignment, applyAlignment, reset() { /* stateless - no per-scope state to clear */ } };
})();
crossLayerRegistry.register('cadenceAlignment', cadenceAlignment, ['all']);
