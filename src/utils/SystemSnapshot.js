// SystemSnapshot.js — Captures full system state for diagnostic enrichment on errors.
// When a Validator throw fires, the snapshot is attached so the crash
// carries the exact harmonic, rhythmic, timing, and layer context of that tick.

SystemSnapshot = (() => {

  /**
   * Capture current system state. Safe to call at any point in the lifecycle —
   * returns partial data if globals have not yet loaded.
   * @returns {Object} frozen diagnostic snapshot
   */
  function capture() {
    const snap = { capturedAt: Date.now() };

    // ── Timing context (globals boot-validated; try/catch guards pre-boot calls) ──
    try {
      snap.timing = {
        sectionIndex, phraseIndex, measureIndex, beatIndex,
        divIndex, subdivIndex, subsubdivIndex,
        beatStartTime, beatStart
      };
    } catch { snap.timing = null; }

    // ── TimeStream ──
    try {
      snap.timeStream = TimeStream.snapshot();
    } catch { snap.timeStream = null; }

    // ── Harmonic context ──
    try {
      snap.harmonic = HarmonicContext.get();
    } catch { snap.harmonic = null; }

    // ── Conductor state ──
    try {
      snap.conductor = ConductorState.getSnapshot();
    } catch { snap.conductor = null; }

    // ── Layer state ──
    try {
      snap.activeLayer = LM.activeLayer;
      const layerKeys = Object.keys(LM.layers);
      snap.layers = {};
      for (const key of layerKeys) {
        const layer = LM.layers[key];
        if (layer && typeof layer === 'object') {
          snap.layers[key] = {
            tick: layer.tick,
            sectionStart: layer.sectionStart,
            phraseFamily: layer.phraseFamily
          };
        }
      }
    } catch { snap.layers = null; }

    // ── Density / intensity ──
    try {
      snap.density = { currentDensity };
    } catch { snap.density = null; }

    // ── CoherenceMonitor feedback metrics ──
    try {
      snap.coherence = CoherenceMonitor.getMetrics();
    } catch { snap.coherence = null; }

    // ── Cross-layer interaction heat ──
    try {
      snap.systemHeat = InteractionHeatMap.getSystemHeat();
    } catch { snap.systemHeat = null; }

    // ── Adaptive trust scores ──
    try {
      snap.trustScores = AdaptiveTrustScores.getSnapshot();
    } catch { snap.trustScores = null; }

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
    } catch { /* cannot enrich — move on */ }
    return err;
  }

  return { capture, enrichError };
})();
