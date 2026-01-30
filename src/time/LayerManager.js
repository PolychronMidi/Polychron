/* global writeIndexTrace, restoreLayerToGlobals, TEST, getPolyrhythm, c */
/**
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 */
const { writeIndexTrace } = require('../debug/logGate');
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
    // Emit a trace indicating the per-layer composer cache was initialized for diagnostics
    writeIndexTrace({ tag: 'composer:cache:init', when: new Date().toISOString(), layer: name, value: state._composerCache });
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
      try { if (TEST && TEST.DEBUG) console.log('LM.activate: poly before', { polyNumerator, polyDenominator, numerator, denominator, measuresPerPhrase1, measuresPerPhrase2 }); } catch (e) { /* swallow */ }
      // Respect explicit test-provided overrides when present
      try {
        if (TEST && typeof TEST.polyNumerator !== 'undefined') {
          polyNumerator = TEST.polyNumerator;
          polyDenominator = TEST.polyDenominator;
        }
      } catch (_e) { /* swallow */ }
      // Use module-scope poly values if present (tests may set them directly)
      // Be permissive: allow tests to set only `polyNumerator` and default the
      // missing `polyDenominator` to the current `denominator` so legacy test
      // assignment patterns (which may fail to set both) still work as intended.
      if (typeof polyNumerator !== 'undefined') {
        if (typeof polyDenominator === 'undefined') polyDenominator = denominator;
        numerator = polyNumerator;
        denominator = polyDenominator;
      }
      try { if (TEST && TEST.DEBUG) console.log('LM.activate: poly after', { polyNumerator, polyDenominator, numerator, denominator, measuresPerPhrase }); } catch (e) { /* swallow */ }
    }

    spPhrase = spMeasure * measuresPerPhrase;
    tpPhrase = tpMeasure * measuresPerPhrase;
    try {
      if (process.env.DEBUG_TRACES || (TEST && TEST.DEBUG)) {
        writeIndexTrace({ tag: 'lm:activate:timing', when: new Date().toISOString(), layer: name, tpMeasure, measuresPerPhrase, tpPhrase, tpSection, sectionStart });
      }
    } catch (e) { /* swallow */ }
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
      // Instrumentation: capture post-advance timing snapshot for diagnostic tracing
      try {
        if (process.env.DEBUG_TRACES || (TEST && TEST.DEBUG)) {
          writeIndexTrace({
            tag: 'lm:advance:phrase',
            when: new Date().toISOString(),
            layer: name,
            tpMeasure,
            measuresPerPhrase,
            tpPhrase: layer.state.tpPhrase,
            tpSection: layer.state.tpSection,
            sectionStart: layer.state.sectionStart
          });
        }
      } catch (e) { /* swallow */ }
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

// REMOVED: ANTI-PATTERN - these are all defined globally, just import the file(s) that define them!
// Test compatibility mapping: allow tests to inject runtime dependencies via TEST (preferred over global mutation)
try {
  if (TEST) {
    if (typeof TEST.LM !== 'undefined') LM = TEST.LM;
    if (typeof TEST.composer !== 'undefined') composer = TEST.composer;
    if (typeof TEST.fs !== 'undefined') fs = TEST.fs;
    if (typeof TEST.allNotesOff !== 'undefined') allNotesOff = TEST.allNotesOff;
    if (typeof TEST.muteAll !== 'undefined') muteAll = TEST.muteAll;
    if (typeof TEST.PPQ !== 'undefined') PPQ = TEST.PPQ;
  }
} catch (_e) { /* swallow */ }

// Export LM for programmatic imports in addition to the naked global
try { module.exports = LM; } catch (e) { /* swallow */ }
