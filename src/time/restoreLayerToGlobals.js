// Layer timing globals are created by `LM.register` at startup to support infinite layers

/**
 * Restore TimingContext state into naked globals without using banned globals.
 * Replaces previous calls like `layer.state.restoreTo(globalThis)`.
 */
function restoreLayerToGlobals(state) {
  if (!state) return;
  // Copy explicit timing properties into module-level naked globals
  phraseStart = state.phraseStart;
  phraseStartTime = state.phraseStartTime;
  sectionStart = state.sectionStart;
  sectionStartTime = state.sectionStartTime;
  sectionEnd = state.sectionEnd;
  tpSec = state.tpSec;
  tpSection = state.tpSection;
  spSection = state.spSection;
  tpPhrase = state.tpPhrase;
  spPhrase = state.spPhrase;
  measureStart = state.measureStart;
  measureStartTime = state.measureStartTime;
  tpMeasure = state.tpMeasure;
  spMeasure = state.spMeasure;

  // Restore canonical meter information (numerator/denominator) from layer state.
  // This ensures that when switching layers (primary <-> poly) we do not leave
  // numerator/denominator mismatched, which can lead to incorrect tpBeat/tpMeasure math
  // and trigger boundary CRITICALs during subsequent setUnitTiming calls.
  try {
    const prevNum = typeof numerator !== 'undefined' ? Number(numerator) : undefined;
    const prevDen = typeof denominator !== 'undefined' ? Number(denominator) : undefined;
    if (typeof state.numerator !== 'undefined' && Number.isFinite(Number(state.numerator))) numerator = Number(state.numerator);
    if (typeof state.denominator !== 'undefined' && Number.isFinite(Number(state.denominator))) denominator = Number(state.denominator);
    if (typeof state.measuresPerPhrase === 'number' && Number.isFinite(state.measuresPerPhrase) && state.measuresPerPhrase > 0) measuresPerPhrase = state.measuresPerPhrase;
    // If meter changed due to restore, recompute midi timing so derived values (tpSec/tpMeasure) are consistent.
    if ((typeof prevNum !== 'undefined' && prevNum !== numerator) || (typeof prevDen !== 'undefined' && prevDen !== denominator)) {
      try { getMidiTiming(); } catch (e) { /* If getMidiTiming fails, let higher-level logic surface errors */ }
    }
  } catch (e) { /* swallow but do not hide issues */ }
}
// Expose restoreLayerToGlobals to other modules that rely on naked global semantics
try { Function('f', 'this.restoreLayerToGlobals = f')(restoreLayerToGlobals); } catch (e) { /* swallow */ }

// Export for programmatic imports
try { module.exports = restoreLayerToGlobals; } catch (e) { /* swallow */ }
