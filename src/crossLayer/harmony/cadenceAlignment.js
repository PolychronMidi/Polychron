// src/crossLayer/cadenceAlignment.js - Cross-layer cadence synchronization.
// Posts harmonic tension values to ATG 'tension' channel. When both layers
// independently approach high tension within the same ms window, forces
// simultaneous resolution - syncing cadence points to the same ms-derived tick.

cadenceAlignment = (() => {
  const V = validator.create('cadenceAlignment');
  const CHANNEL = 'tension';
  const SYNC_TOLERANCE_MS = 400;
  const HIGH_TENSION_THRESHOLD = 0.55;
  const STRONG_TENSION_THRESHOLD = 0.72;
  const EVENTS = eventCatalog.names;

  /**
   * Post a tension sample from the active layer.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} tension - normalized 0-1 harmonic tension
   * @param {boolean} cadenceSuggested - whether cadenceAdvisor suggests a cadence
   */
  function postTension(absTimeMs, layer, tension, cadenceSuggested) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    absoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
      tension: clamp(tension, 0, 1),
      cadenceSuggested
    });
  }

  /**
   * Check if both layers are approaching high tension simultaneously.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} ourTension - this layer's current tension
   * @param {boolean} [ourCadenceSuggested]
   * @returns {{ aligned: boolean, syncTick: number, combinedTension: number, otherCadenceSuggested: boolean, sharedCadenceIntent: boolean, consensus: boolean } | null}
   */
  function checkAlignment(absTimeMs, activeLayer, ourTension, ourCadenceSuggested) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(ourTension, 'ourTension');

    if (ourTension < HIGH_TENSION_THRESHOLD) return null;

    const other = absoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, SYNC_TOLERANCE_MS, activeLayer
    );
    if (!other || !Number.isFinite(other.tension)) return null;
    if (other.tension < HIGH_TENSION_THRESHOLD) return null;
    const localCadenceSuggested = Boolean(ourCadenceSuggested);
    const otherCadenceSuggested = Boolean(other.cadenceSuggested);
    const sharedCadenceIntent = localCadenceSuggested || otherCadenceSuggested;
    const consensus = localCadenceSuggested && otherCadenceSuggested;
    if (!sharedCadenceIntent && (ourTension < STRONG_TENSION_THRESHOLD || other.tension < STRONG_TENSION_THRESHOLD)) return null;

    // Both layers are at high tension within the same time window
    const syncTick = crossLayerHelpers.msToSyncTick(other.timeMs);

    return {
      aligned: true,
      syncTick,
      combinedTension: (ourTension + other.tension) / 2,
      otherCadenceSuggested,
      sharedCadenceIntent,
      consensus
    };
  }

  /**
   * Apply cadence alignment: when both layers at high tension, bias toward resolution.
   * Returns a cadence bias modifier that can be fed to cadenceAdvisor or chord selection.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} ourTension - this layer's current tension
   * @param {boolean} [ourCadenceSuggested]
   * @returns {{ shouldResolve: boolean, tonicBias: number, dominantBias: number, syncTick: number, consensus: boolean, sharedCadenceIntent: boolean } | null}
   */
  function applyAlignment(absTimeMs, activeLayer, ourTension, ourCadenceSuggested) {
    const alignment = checkAlignment(absTimeMs, activeLayer, ourTension, ourCadenceSuggested);
    if (!alignment) return null;

    // Both layers at high tension - strongly bias toward cadential resolution
    const intensityBoost = alignment.combinedTension;
    const supportScale = alignment.consensus ? 1.0 : 0.72;

    // No active listeners - emitted for eventCatalog completeness and future extensibility
    eventBus.emit(EVENTS.CROSS_LAYER_CADENCE_ALIGN, {
      layer: activeLayer,
      combinedTension: alignment.combinedTension,
      syncTick: alignment.syncTick,
      otherCadenceSuggested: alignment.otherCadenceSuggested,
      absTimeMs
    });

    return {
      shouldResolve: alignment.consensus || alignment.combinedTension > 0.88,
      tonicBias: 0.5 + intensityBoost * 0.4 * supportScale,
      dominantBias: 0.3 + intensityBoost * 0.5 * supportScale,
      syncTick: alignment.syncTick,
      consensus: alignment.consensus,
      sharedCadenceIntent: alignment.sharedCadenceIntent
    };
  }

  return { postTension, checkAlignment, applyAlignment, reset() { /* stateless - no per-scope state to clear */ } };
})();
crossLayerRegistry.register('cadenceAlignment', cadenceAlignment, ['all']);
