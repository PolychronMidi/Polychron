
/**
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 */

LM = layerManager ={
  layers: {},

  /**
   * Register a layer with buffer and initial timing state.
   * @param {string} name
   * @param {CSVBuffer|string|Array} buffer
   * @param {object} [initialState]
   * @param {Function} [setupFn]
   * @returns {{state: TimingContext, buffer: CSVBuffer|Array}}
   */
  register: (name, buffer, initialState = {}, setupFn = null) => {
    const state = new TimingContext(initialState);

    // Accept a CSVBuffer instance, array, or string name
    let buf;
    if (typeof CSVBuffer !== 'undefined' && buffer instanceof CSVBuffer) {
      buf = buffer;
      state.bufferName = buffer.name;
    } else if (typeof buffer === 'string') {
      state.bufferName = buffer;
      try { buf = (typeof CSVBuffer !== 'undefined') ? new CSVBuffer(buffer) : []; } catch (e) { buf = []; }
    } else {
      buf = Array.isArray(buffer) ? buffer : [];
    }
    // attach buffer onto both LM entry and the returned state
    // Initialize per-layer composer cache early to avoid cache-unavailable races
    state._composerCache = state._composerCache || {};
    LM.layers[name] = { buffer: buf, state };
    state.buffer = buf;

    // If a per-layer setup function was provided, call it with `c` set
    // to the layer buffer so existing setup functions that rely on
    // the active buffer continue to work.
    const prevC = typeof c !== 'undefined' ? c : undefined;
    try {
      c = buf;
      if (typeof setupFn === 'function') setupFn(state, buf);
    } catch (e) { /* swallow */ }
    // restore previous `c`
    if (prevC === undefined) c = undefined; else c = prevC;
    // return both the state and direct buffer reference so callers can
    // destructure in one line and avoid separate buffer assignment lines
    return { state, buffer: buf };
  },

  /**
   * Activate a layer; restores timing globals and sets meter.
   * @param {string} name - Layer name.
   * @param {boolean} [isPoly=false] - Whether this is a polyrhythmic layer.
   * @returns {{numerator: number, denominator: number, tpSec: number, tpMeasure: number}} Snapshot of key timing values.
   */
  activate: (name, isPoly = false) => {
    // no need to pass meter info here, as it stays consitent until the next layer switch
    const layer = LM.layers[name];
    c = layer.buffer;
    LM.activeLayer = name;

    // Store meter into layer state (set externally before activation)
    layer.state.numerator = numerator;
    layer.state.denominator = denominator;
    layer.state.meterRatio = numerator / denominator;
    layer.state.tpSec = tpSec;
    layer.state.tpMeasure = tpMeasure;

    // Restore layer timing state to globals (avoid circular init issues by requiring local module)
    try { require('./restoreLayerToGlobals')(layer.state); } catch (e) { /* swallow */ }

    // Reset only derived composer counts to avoid carry-over; preserve caller-set indices (measureIndex etc.) so callers can activate and then set indices as needed
    divsPerBeat = subdivsPerDiv = subsubsPerSub = undefined;

    // If activating poly layer, ensure polyrhythm parameters are calculated
    // but only if they have not been manually set by tests or callers
    if (isPoly) {
      // Only calculate polyrhythm automatically when both poly values are absent.
      // If a test or caller sets one or both values, prefer those explicit values
      // (avoids silently overwriting test-provided polyNumerator alone when polyDenominator
      // is omitted due to legacy test assignment patterns).
      if (typeof polyNumerator === 'undefined' && typeof polyDenominator === 'undefined') {
        try { getPolyrhythm(); } catch (e) { /* swallow polyrhythm failures */ }
      }
    }

    // Determine measures per phrase: prefer global setting unless the restored layer has an explicit (>1) value
    if (typeof layer.state.measuresPerPhrase === 'number' && Number.isFinite(layer.state.measuresPerPhrase) && layer.state.measuresPerPhrase > 1) {
      measuresPerPhrase = layer.state.measuresPerPhrase;
    } else {
      measuresPerPhrase = (isPoly ? measuresPerPhrase2 : measuresPerPhrase1);
      if (!Number.isFinite(measuresPerPhrase) || measuresPerPhrase <= 0) measuresPerPhrase = 1;
    }

    // If activating poly layer and polyrhythm was calculated, use poly meter
    if (isPoly) {
      numerator = polyNumerator;
      denominator = polyDenominator;
    }

    spPhrase = spMeasure * measuresPerPhrase;
    tpPhrase = tpMeasure * measuresPerPhrase;

    return {
      phraseStart: layer.state.phraseStart,
      phraseStartTime: layer.state.phraseStartTime,
      sectionStart: layer.state.sectionStart,
      sectionStartTime: layer.state.sectionStartTime,
      sectionEnd: layer.state.sectionEnd,
      tpSec: layer.state.tpSec,
      tpSection: layer.state.tpSection,
      spSection: layer.state.spSection,
      state: layer.state
    };
  },

  /**
   * Advance a layer's timing state.
   * @param {string} name - Layer name.
   * @param {'phrase'|'section'} [advancementType='phrase'] - Type of advancement.
   * @returns {void}
   */
  advance: (name, advancementType = 'phrase') => {
    const layer = LM.layers[name];
    if (!layer) return;
    c = layer.buffer;

    beatRhythm = divRhythm = subdivRhythm = subsubdivRhythm = 0;

    // Advance using layer's own state values
    if (advancementType === 'phrase') {
      // Save current globals for phrase timing (layer was just active)
      layer.state.saveFrom({
        numerator, denominator, measuresPerPhrase,
        tpPhrase, spPhrase, measureStart, measureStartTime,
        tpMeasure, spMeasure, phraseStart, phraseStartTime,
        sectionStart, sectionStartTime, sectionEnd,
        tpSec, tpSection, spSection
      });
      layer.state.advancePhrase(layer.state.tpPhrase, layer.state.spPhrase);

    } else if (advancementType === 'section') {
      // For section advancement, use layer's own accumulated tpSection/spSection
      // Don't pull from globals - they may be from a different layer!
      layer.state.advanceSection();
    }

    // Restore advanced state back to naked globals so they stay in sync
    restoreLayerToGlobals(layer.state);
  },

};
// LM is intentionally a naked global (set via LM = layerManager above) so other modules can access it without global qualifiers
// layer manager is initialized in play.js after buffers are created
// This ensures c1 and c2 are available when registering layers
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
      try { getMidiTiming(); } catch (e) { console.warn('restoreLayerToGlobals: getMidiTiming failed after meter change', e);}
    }
  } catch (e) { console.warn('restoreLayerToGlobals: failed to restore meter from layer state', e); }
}
try { module.exports = LM; } catch (e) { /* swallow */ }
