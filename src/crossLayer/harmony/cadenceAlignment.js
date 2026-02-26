// src/crossLayer/cadenceAlignment.js — Cross-layer cadence synchronization.
// Posts harmonic tension values to ATG 'tension' channel. When both layers
// independently approach high tension within the same ms window, forces
// simultaneous resolution — syncing cadence points to the same ms-derived tick.

cadenceAlignment = (() => {
  const V = validator.create('cadenceAlignment');
  const CHANNEL = 'tension';
  const SYNC_TOLERANCE_MS = 400;
  const HIGH_TENSION_THRESHOLD = 0.7;
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
   * @returns {{ aligned: boolean, syncTick: number, combinedTension: number, otherCadenceSuggested: boolean } | null}
   */
  function checkAlignment(absTimeMs, activeLayer, ourTension) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(ourTension, 'ourTension');

    if (ourTension < HIGH_TENSION_THRESHOLD) return null;

    const other = absoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, SYNC_TOLERANCE_MS, activeLayer
    );
    if (!other || !Number.isFinite(other.tension)) return null;
    if (other.tension < HIGH_TENSION_THRESHOLD) return null;

    // Both layers are at high tension within the same time window
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const syncTickRaw = Math.round(measureStart + ((other.timeMs / 1000) - measureStartTime) * tpSec);
    const syncTick = Math.max(0, syncTickRaw);

    return {
      aligned: true,
      syncTick,
      combinedTension: (ourTension + other.tension) / 2,
      otherCadenceSuggested: Boolean(other.cadenceSuggested)
    };
  }

  /**
   * Apply cadence alignment: when both layers at high tension, bias toward resolution.
   * Returns a cadence bias modifier that can be fed to cadenceAdvisor or chord selection.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} ourTension - this layer's current tension
   * @returns {{ shouldResolve: boolean, tonicBias: number, dominantBias: number, syncTick: number } | null}
   */
  function applyAlignment(absTimeMs, activeLayer, ourTension) {
    const alignment = checkAlignment(absTimeMs, activeLayer, ourTension);
    if (!alignment) return null;

    // Both layers at high tension → strongly bias toward cadential resolution
    const intensityBoost = alignment.combinedTension;

    // No active listeners — emitted for eventCatalog completeness and future extensibility
    eventBus.emit(EVENTS.CROSS_LAYER_CADENCE_ALIGN, {
      layer: activeLayer,
      combinedTension: alignment.combinedTension,
      syncTick: alignment.syncTick,
      otherCadenceSuggested: alignment.otherCadenceSuggested,
      absTimeMs
    });

    return {
      shouldResolve: alignment.otherCadenceSuggested || alignment.combinedTension > 0.85,
      tonicBias: 0.5 + intensityBoost * 0.4,
      dominantBias: 0.3 + intensityBoost * 0.5,
      syncTick: alignment.syncTick
    };
  }

  return { postTension, checkAlignment, applyAlignment, reset() { /* stateless — no per-scope state to clear */ } };
})();
crossLayerRegistry.register('cadenceAlignment', cadenceAlignment, ['all']);
