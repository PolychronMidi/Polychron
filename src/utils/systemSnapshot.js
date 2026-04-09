// systemSnapshot.js - Captures full system state for diagnostic enrichment on errors.
// When a validator throw fires, the snapshot is attached so the crash
// carries the exact harmonic, rhythmic, timing, and layer context of that tick.

systemSnapshot = (() => {

  /**
   * Capture current system state. Safe to call at any point in the lifecycle -
   * returns partial data if globals have not yet loaded.
   * @returns {Object} frozen diagnostic snapshot
   */
  function capture() {
    const snap = { capturedAt: Date.now() };

    // -- Timing context (globals boot-validated; try/catch guards pre-boot calls) --
    try {
      snap.timing = {
        sectionIndex, phraseIndex, measureIndex, beatIndex,
        divIndex, subdivIndex, subsubdivIndex,
        beatStartTime
      };
    } catch { snap.timing = null; }

    // -- timeStream --
    try {
      snap.timeStream = timeStream.snapshot();
    } catch { snap.timeStream = null; }

    // -- Harmonic context --
    try {
      snap.harmonic = harmonicContext.get();
    } catch { snap.harmonic = null; }

    // -- Conductor state --
    try {
      snap.conductor = conductorState.getSnapshot();
    } catch { snap.conductor = null; }

    // -- Layer state --
    try {
      snap.activeLayer = LM.activeLayer;
      const layerKeys = Object.keys(LM.layers);
      snap.layers = {};
      for (const key of layerKeys) {
        const layer = LM.layers[key];
        if (layer && typeof layer === 'object') {
          snap.layers[key] = {
            sectionStartTime: layer.sectionStartTime,
            phraseFamily: layer.phraseFamily
          };
        }
      }
    } catch { snap.layers = null; }

    // -- Density / intensity --
    try {
      snap.density = { currentDensity };
    } catch { snap.density = null; }

    // -- coherenceMonitor feedback metrics --
    try {
      snap.coherence = coherenceMonitor.getMetrics();
    } catch { snap.coherence = null; }

    // -- Cross-layer interaction heat --
    try {
      snap.systemHeat = interactionHeatMap.getSystemHeat();
    } catch { snap.systemHeat = null; }

    // -- Adaptive trust scores --
    try {
      snap.trustScores = adaptiveTrustScores.getSnapshot();
    } catch { snap.trustScores = null; }

    // -- Entropy regulation state --
    try {
      snap.entropy = entropyRegulator.getRegulation();
    } catch { snap.entropy = null; }

    // -- Human-readable position --
    try {
      snap.position = timeStream.positionString();
    } catch { snap.position = null; }

    // -- Last explainability emission --
    try {
      const recent = explainabilityBus.getRecent(1);
      snap.lastExplain = recent.length > 0 ? recent[0] : null;
    } catch { snap.lastExplain = null; }

    return Object.freeze(snap);
  }

  /**
   * Attach a snapshot to an Error object as a non-enumerable `.snapshot` property.
   * @param {Error} err
   * @returns {Error} same error, enriched
   */
  function enrichError(err) {
    if (!err || typeof err !== 'object') return err;
    try {
      Object.defineProperty(err, 'snapshot', {
        value: capture(),
        writable: false,
        enumerable: false,
        configurable: true
      });
    } catch (_enrichErr) { console.warn('Acceptable warning: systemSnapshot: enrichError failed:', _enrichErr && _enrichErr.message ? _enrichErr.message : _enrichErr); }
    return err;
  }

  return { capture, enrichError };
})();
