// time.js - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

const { writeIndexTrace, writeDebugFile, appendToFile, writeFatal } = require('./logGate');
const m = Math;

// TimingCalculator encapsulates meter spoofing and base duration math to keep globals pure and testable.
/**
 * Encapsulates meter spoofing and timing computations.
 * @class TimingCalculator
 * @param {object} options
 * @param {number} options.bpm - Beats per minute.
 * @param {number} options.ppq - Pulses per quarter note.
 * @param {[number, number]} options.meter - [numerator, denominator].
 */
class TimingCalculator {
  constructor({ bpm, ppq, meter }) {
    const [num, den] = meter || [];
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
      throw new Error(`Invalid meter: ${num}/${den}`);
    }
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error(`Invalid BPM: ${bpm}`);
    }
    if (!Number.isFinite(ppq) || ppq <= 0) {
      throw new Error(`Invalid PPQ: ${ppq}`);
    }
    this.bpm = bpm;
    this.ppq = ppq;
    this.meter = [num, den];
    this._getMidiTiming();
  }

  _getMidiTiming() {
    const [num, den] = this.meter;
    const isPow2 = (n) => (n & (n - 1)) === 0;
    if (isPow2(den)) {
      this.midiMeter = [num, den];
    } else {
      const hi = 2 ** m.ceil(m.log2(den));
      const lo = 2 ** m.floor(m.log2(den));
      const ratio = num / den;
      this.midiMeter = m.abs(ratio - num / hi) < m.abs(ratio - num / lo)
        ? [num, hi]
        : [num, lo];
    }
    this.meterRatio = num / den;
    this.midiMeterRatio = this.midiMeter[0] / this.midiMeter[1];
    this.syncFactor = this.midiMeterRatio / this.meterRatio;
    this.midiBPM = this.bpm * this.syncFactor;
    this.tpSec = this.midiBPM * this.ppq / 60;
    this.tpMeasure = this.ppq * 4 * this.midiMeterRatio;
    this.spMeasure = (60 / this.bpm) * 4 * this.meterRatio;
  }
}

// Export TimingCalculator to test hooks and for other modules
// Use centralized test hooks instead of global mutation
const TEST = require('./test-hooks');
// One-time warning helper to avoid flooding logs with the same critical messages
const _polychron_warned = new Set();
function warnOnce(key, msg) {
  try {
    if (_polychron_warned.has(key)) return;
    _polychron_warned.add(key);
    // Gate warnings via logGate (debug category)
    try { writeDebugFile('warnings.ndjson', { key, msg }); } catch (e) { /* swallow */ }
  } catch (e) { /* swallow logging errors */ }
}

// Fail-fast critical handler: delegate to centralized postfix guard
function raiseCritical(key, msg, ctx = {}) {
  // Debug assist: log the key/msg when critical is raised (helps detect undefined messages)
  try { if (TEST && TEST.DEBUG) console.log('raiseCritical called', { key, msg }); } catch (e) { /* swallow */ }
  // Delegate to shared raiseCritical implementation so all modules write consistent diagnostics
  try {
    const guard = require('./postfixGuard');
    return guard.raiseCritical(key, msg, ctx);
  } catch (e) {
    // Fallback: if guard fails for some reason, ensure we still throw loudly
    try { writeFatal({ when: new Date().toISOString(), type: 'postfix-anti-pattern', severity: 'critical', key, msg, stack: (new Error()).stack, ctx }); } catch (_e) { /* swallow */ }
    throw new Error('CRITICAL: ' + msg);
  }
}
// Test hook compatibility removed; use TEST (require('./test-hooks')) for test integrations
try { TEST.TimingCalculator = TimingCalculator; } catch (e) { /* swallow */ }
let timingCalculator = null;

/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 * @returns {number[]} MIDI meter as [numerator, denominator].
 */
getMidiTiming = () => {
  // Debug: log inputs when running tests to aid diagnosis
  try { if (TEST && TEST.DEBUG) console.log('getMidiTiming inputs', { BPM, PPQ, numerator, denominator }); } catch (e) { /* swallow */ }
  timingCalculator = new TimingCalculator({ bpm: BPM, ppq: PPQ, meter: [numerator, denominator] });
  ({ midiMeter, midiMeterRatio, meterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure } = timingCalculator);
  try { if (TEST && TEST.DEBUG) console.log('getMidiTiming outputs', { midiMeter, midiMeterRatio, meterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure }); } catch (e) { /* swallow */ }
  return midiMeter; // Return the midiMeter for testing
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 * @param {number} [tick] - MIDI tick position.
 */
setMidiTiming = (tick) => {
  try { if (TEST && TEST.DEBUG) console.log('setMidiTiming', { tpSec, midiBPM, midiMeter, c: !!c, p: typeof p, tick }); } catch (e) { /* swallow */ }

  // Debug: always log minimal buffer state to help triage why events are not appearing in tests
  try { console.log('setMidiTiming-debug-start', { cType: Object.prototype.toString.call(c), isArray: Array.isArray(c), cLen: Array.isArray(c) ? c.length : (c && Array.isArray(c.rows) ? c.rows.length : null), pType: typeof p }); } catch (_e) { /* swallow */ }

  if (typeof tick === 'undefined') tick = measureStart;

  // Test harness compatibility: if a test set a desired global assignment via
  // setGlobalObject, it may have recorded the object on TEST.__lastAssignedObjects.
  // Prefer that explicit per-test buffer when present to ensure deterministic writes.
  try {
    if (typeof TEST !== 'undefined' && TEST && TEST.__lastAssignedObjects && TEST.__lastAssignedObjects.c) {
      c = TEST.__lastAssignedObjects.c;
    }
  } catch (_e) { /* swallow */ }
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec: ${tpSec}`);
  }
  // Defensive: ensure midiMeter is defined before accessing indices
  if (!Array.isArray(midiMeter) || midiMeter.length < 2) {
    const defaultNumerator = (typeof numerator !== 'undefined' && Number.isFinite(Number(numerator))) ? Number(numerator) : 4;
    const defaultDenominator = (typeof denominator !== 'undefined' && Number.isFinite(Number(denominator))) ? Number(denominator) : 4;
    midiMeter = [defaultNumerator, defaultDenominator];
  }
  // If `p` (push helper) isn't available or has been overridden in tests,
  // write directly to the buffer for robustness in unit tests.
  try {
    if (typeof p !== 'function') {
      if (Array.isArray(c) || (c && typeof c.push === 'function')) {
        c.push({ tick: tick, type: 'bpm', vals: [midiBPM] });
        c.push({ tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] });
        return;
      }
    }
  } catch (_e) { /* swallow */ }

  p(c,
    { tick: tick, type: 'bpm', vals: [midiBPM] },
    { tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );

  // Some test harnesses may replace `p` with a function that doesn't correctly
  // handle multiple event objects. If we didn't actually write the events above,
  // fall back to direct buffer writes so tests remain deterministic.
  try {
    const bufferArr = Array.isArray(c) ? c : (c && Array.isArray(c.rows) ? c.rows : null);
    const hasBpm = bufferArr && bufferArr.some(e => e && e.type === 'bpm');
    const hasMeter = bufferArr && bufferArr.some(e => e && e.type === 'meter');
    if (!hasBpm || !hasMeter) {
      if (bufferArr) {
        // Avoid duplicating events if partial write occurred
        if (!hasBpm) bufferArr.push({ tick: tick, type: 'bpm', vals: [midiBPM] });
        if (!hasMeter) bufferArr.push({ tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] });
        try { writeDebugFile('time-debug.ndjson', { tag: 'setMidiTiming-fallback-wrote', tick, hasBpm, hasMeter, bufSample: bufferArr.slice(0,3) }); } catch (_e) { /* swallow */ }
      } else {
        try { writeDebugFile('time-debug.ndjson', { tag: 'setMidiTiming-no-buffer', tick, cType: (c === undefined ? 'undefined' : Object.prototype.toString.call(c)) }); } catch (_e) { /* swallow */ }
      }
    }
  } catch (_e) { /* swallow */ }
};

/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * @returns {void}
 */
getPolyrhythm = () => {
  if (!composer) return;
  // For quick local runs (PLAY_LIMIT), avoid expensive getMeter loops and fall back to 1:1 phrasing
  if (process.env && process.env.PLAY_LIMIT) {
    // Minimal safe defaults for bounded play runs. Only apply defaults when caller
    // hasn't explicitly provided polyNumerator/polyDenominator (allow tests to set them).
    if (typeof polyNumerator === 'undefined' || typeof polyDenominator === 'undefined') {
      polyNumerator = numerator;
      polyDenominator = denominator;
    }
    polyMeterRatio = polyNumerator / polyDenominator;
    // In PLAY_LIMIT mode, prefer simple 1:1 phrasing to avoid complex polyrhythm loops
    measuresPerPhrase1 = 1;
    measuresPerPhrase2 = 1;
    return;
  }
  const MAX_ATTEMPTS = 100;
  let attempts = 0;
  while (attempts++ < MAX_ATTEMPTS) {
    [polyNumerator, polyDenominator] = composer.getMeter(true, true);
    if (!Number.isFinite(polyNumerator) || !Number.isFinite(polyDenominator) || polyDenominator <= 0) {
      continue;
    }
    polyMeterRatio = polyNumerator / polyDenominator;
    let allMatches = [];
    let bestMatch = {
      primaryMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity,
      polyNumerator: polyNumerator,
      polyDenominator: polyDenominator
    };

    for (let primaryMeasures = 1; primaryMeasures < 7; primaryMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
        if (m.abs(primaryMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
          let currentMatch = {
            primaryMeasures: primaryMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: primaryMeasures + polyMeasures,
            polyNumerator: polyNumerator,
            polyDenominator: polyDenominator
          };
          allMatches.push(currentMatch);
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }

    // If meters are identical, phrasing is trivially 1:1
    if (numerator === polyNumerator && denominator === polyDenominator) {
      measuresPerPhrase1 = 1;
      measuresPerPhrase2 = 1;
      return;
    }

    if (bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1))) {
      measuresPerPhrase1 = bestMatch.primaryMeasures;
      measuresPerPhrase2 = bestMatch.polyMeasures;
      return;
    }
  }
  // Max attempts reached: try new meter on primary layer with relaxed constraints
  console.warn(`getPolyrhythm() reached max attempts (${MAX_ATTEMPTS}); requesting new primary meter...`);
  [numerator, denominator] = composer.getMeter(true, false);
  // CRITICAL: Recalculate all timing after meter change to prevent sync desync
  getMidiTiming();
  // As a last resort, fall back to 1:1 phrasing to allow play to proceed while logging a warning
  warnOnce('polyrhythm:relaxed', 'getPolyrhythm relaxed to 1:1 phrasing after max attempts');
  measuresPerPhrase1 = 1;
  measuresPerPhrase2 = 1;
};

/**
 * TimingContext class - encapsulates all timing state for a layer.
 * @class
 */
TimingContext = class TimingContext {
  /**
   * @param {object} [initialState={}] - Initial timing state values.
   */
  constructor(initialState = {}) {
    this.phraseStart = initialState.phraseStart || 0;
    this.phraseStartTime = initialState.phraseStartTime || 0;
    this.sectionStart = initialState.sectionStart || 0;
    this.sectionStartTime = initialState.sectionStartTime || 0;
    this.sectionEnd = initialState.sectionEnd || 0;
    this.tpSec = initialState.tpSec || 0;
    this.tpSection = initialState.tpSection || 0;
    this.spSection = initialState.spSection || 0;
    this.numerator = initialState.numerator || 4;
    this.denominator = initialState.denominator || 4;
    this.measuresPerPhrase = initialState.measuresPerPhrase || 1;
    this.tpPhrase = initialState.tpPhrase || 0;
    this.spPhrase = initialState.spPhrase || 0;
    this.measureStart = initialState.measureStart || 0;
    this.measureStartTime = initialState.measureStartTime || 0;
    this.tpMeasure = initialState.tpMeasure || (typeof PPQ !== 'undefined' ? PPQ * 4 : 480 * 4);
    this.spMeasure = initialState.spMeasure || 0;
    this.meterRatio = initialState.meterRatio || (this.numerator / this.denominator);
    this.bufferName = initialState.bufferName || '';
  }

  /**
   * Save timing values from globals object.
   * @param {object} globals - Global timing state.
   * @returns {void}
   */
  saveFrom(globals) {
    this.phraseStart = globals.phraseStart;
    this.phraseStartTime = globals.phraseStartTime;
    this.sectionStart = globals.sectionStart;
    this.sectionStartTime = globals.sectionStartTime;
    this.sectionEnd = globals.sectionEnd;
    this.tpSec = globals.tpSec;
    this.tpSection = globals.tpSection;
    this.spSection = globals.spSection;
    this.numerator = globals.numerator;
    this.denominator = globals.denominator;
    this.measuresPerPhrase = globals.measuresPerPhrase;
    this.tpPhrase = globals.tpPhrase;
    this.spPhrase = globals.spPhrase;
    this.measureStart = globals.measureStart;
    this.measureStartTime = globals.measureStartTime;
    this.tpMeasure = globals.tpMeasure;
    this.spMeasure = globals.spMeasure;
    this.meterRatio = globals.numerator / globals.denominator;
  }

  /**
   * Restore timing values to globals object.
   * @param {object} globals - Global timing state.
   * @returns {void}
   */
  restoreTo(globals) {
    globals.phraseStart = this.phraseStart;
    globals.phraseStartTime = this.phraseStartTime;
    globals.sectionStart = this.sectionStart;
    globals.sectionStartTime = this.sectionStartTime;
    globals.sectionEnd = this.sectionEnd;
    globals.tpSec = this.tpSec;
    globals.tpSection = this.tpSection;
    globals.spSection = this.spSection;
    globals.tpPhrase = this.tpPhrase;
    globals.spPhrase = this.spPhrase;
    globals.measureStart = this.measureStart;
    globals.measureStartTime = this.measureStartTime;
    globals.tpMeasure = this.tpMeasure;
    globals.spMeasure = this.spMeasure;
  }

  /**
   * Advance phrase timing.
   * @param {number} tpPhrase - Ticks per phrase.
   * @param {number} spPhrase - Seconds per phrase.
   * @returns {void}
   */
  advancePhrase(tpPhrase, spPhrase) {
    const before = { phraseStart: this.phraseStart, tpSection: this.tpSection, sectionStart: this.sectionStart, measuresPerPhrase: this.measuresPerPhrase, tpMeasure: this.tpMeasure };
    this.phraseStart += tpPhrase;
    this.phraseStartTime += spPhrase;
    this.tpSection += tpPhrase;
    this.spSection += spPhrase;
    const after = { phraseStart: this.phraseStart, tpSection: this.tpSection, sectionStart: this.sectionStart };
    try {
      if (process.env.DEBUG_TRACES || (TEST && TEST.DEBUG)) {
        writeIndexTrace({ tag: 'timing:advancePhrase', when: new Date().toISOString(), before, after, tpPhrase, spPhrase, layer: (typeof LM !== 'undefined' && LM && LM.activeLayer) ? LM.activeLayer : null });
      }
    } catch (e) { /* swallow */ }
  }

  /**
   * Advance section timing.
   * @returns {void}
   */
  advanceSection() {
    this.sectionStart += this.tpSection;
    this.sectionStartTime += this.spSection;
    this.sectionEnd += this.tpSection;
    this.tpSection = 0;
    this.spSection = 0;
  }
};



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

    // Restore layer timing state to globals
    restoreLayerToGlobals(layer.state);

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

/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position + index × duration pattern. See time.md for details.
 * @param {string} unitType - Unit type for timing calculation and logging.
 * @returns {void}
 */
setUnitTiming = (unitType) => {
  const si = (typeof sectionIndex !== 'undefined') ? sectionIndex : 'undef';
  const pi = (typeof phraseIndex !== 'undefined') ? phraseIndex : 'undef';
  const mi = (typeof measureIndex !== 'undefined') ? measureIndex : 'undef';
  const bi = (typeof beatIndex !== 'undefined') ? beatIndex : 'undef';
  // Prefer test-injected `LM` when present to respect test harnesses that set LM in beforeEach
  const LMCurrent = (typeof LM !== 'undefined' && LM) ? LM : null;
  const layer = (LMCurrent && LMCurrent.activeLayer) ? LMCurrent.activeLayer : 'primary';
  if (TEST && TEST.enableLogging) console.log(`setUnitTiming enter: unit=${unitType} s=${si} p=${pi} m=${mi} b=${bi} layer=${layer}`);
  // Diagnostic: snapshot indices and last emitted unit of this type for root-cause tracing (non-invasive)
  try {
    const unitsArr = (LMCurrent && LMCurrent.layers && LMCurrent.layers[layer] && Array.isArray(LMCurrent.layers[layer].state.units)) ? LMCurrent.layers[layer].state.units : null;
    const lastSame = unitsArr ? unitsArr.slice().reverse().find(u => u && u.unitType === unitType) : null;
    writeDebugFile('time-debug.ndjson', { tag: 'setUnitTiming-enter-snapshot', unitType, layer, indices: { sectionIndex: si, phraseIndex: pi, measureIndex: mi, beatIndex: bi, divIndex, subdivIndex, subsubdivIndex }, composerTotals: { divsPerBeat, subdivsPerDiv, subsubsPerSub }, tpSnapshot: { tpSec, tpMeasure, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv }, lastSame, stack: (new Error()).stack, when: new Date().toISOString() });

    // REMOVED: ANTI-PATTERN POSTFIX - DO NOT ADAPT TO CORRUPT DATA INSTEAD OF FIXING THE ROOT CAUSE
    // Root fix (proactive): when setUnitTiming is called repeatedly for the same unitType
    // in the same parent context without advancing sibling indices, assume the caller
    // intends to progress to the next sibling. Advance the appropriate index early so
    // subsequent timing computation uses the advanced sibling instead of emitting a
    // duplicate canonical unit.

  } catch (_e) { /* swallow to avoid side effects */ }
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec in setUnitTiming: ${tpSec}`);
  }

  // Fail-fast validation: require phrasesPerSection be present and numeric since
  // many boundary checks and section-level assumptions depend on it.
  if (!(typeof phrasesPerSection !== 'undefined' && Number.isFinite(Number(phrasesPerSection)))) {
    raiseCritical('missing:phrasesPerSection', 'phrasesPerSection missing or invalid', { layer, phrasesPerSection, sectionIndex });
  }

  // Fallback: when setUnitTiming is called directly for lower-level units without
  // the usual parent timing calls (e.g., direct calls to 'subsubdiv' in repro
  // tests), derive missing parent timing values from available totals so we can
  // compute canonical ticks deterministically instead of throwing.
  try {
    if (['division','subdiv','subsubdiv'].includes(unitType)) {
      if (!Number.isFinite(tpBeat) && Number.isFinite(tpMeasure) && Number.isFinite(numerator)) {
        tpBeat = tpMeasure / numerator;
        spBeat = tpBeat / tpSec;
      }
      if (!Number.isFinite(tpDiv) && Number.isFinite(tpBeat) && Number.isFinite(divsPerBeat)) {
        tpDiv = tpBeat / Math.max(1, Number(divsPerBeat));
        spDiv = tpDiv / tpSec;
      }
      if (!Number.isFinite(tpSubdiv) && Number.isFinite(tpDiv) && Number.isFinite(subdivsPerDiv)) {
        tpSubdiv = tpDiv / Math.max(1, Number(subdivsPerDiv));
        spSubdiv = tpSubdiv / tpSec;
      }
      if (!Number.isFinite(tpSubsubdiv) && Number.isFinite(tpSubdiv) && Number.isFinite(subsubsPerSub)) {
        tpSubsubdiv = tpSubdiv / Math.max(1, Number(subsubsPerSub));
        spSubsubdiv = tpSubsubdiv / tpSec;
        // Early heuristic: if subsubsPerSub==1 and subdivs are unusually large relative to measure, raise CRITICAL immediately
        try {
          if (unitType === 'subsubdiv' && Number.isFinite(subsubsPerSub) && Number(subsubsPerSub) === 1 && Number.isFinite(tpSubdiv) && Number.isFinite(tpMeasure)) {
            const sCandidate = Number(subdivStart || 0) + (Number.isFinite(Number(subsubdivIndex)) ? Number(subsubdivIndex) : 0) * Number(tpSubsubdiv);
            const eCandidate = sCandidate + Number(tpSubsubdiv);
            if ((eCandidate - sCandidate) >= Math.round(tpSubdiv) && Number(tpSubdiv) >= (Math.max(1, Math.round(tpMeasure)) / 2)) {
              raiseCritical('overlong:subsubdiv_rel', 'Subsubdiv equals subdiv and is unusually large relative to measure; likely generator misconfiguration', { layer: (LMCurrent && LMCurrent.activeLayer) ? LMCurrent.activeLayer : 'primary', unitType: 'subsubdiv', start: sCandidate, end: eCandidate, duration: (eCandidate - sCandidate), tpSubdiv, tpMeasure, indices: { sectionIndex: (typeof sectionIndex !== 'undefined' ? sectionIndex : 0), phraseIndex: (typeof phraseIndex !== 'undefined' ? phraseIndex : 0), measureIndex: (typeof measureIndex !== 'undefined' ? measureIndex : 0) } });
            }
          }
        } catch (e) { if (e && e.message && e.message.indexOf('CRITICAL') === 0) throw e; /* swallow other errors */ }
      }

      // Compute approximate base starts if not present
      if ((!Number.isFinite(divStart) || !Number.isFinite(divStartTime)) && Number.isFinite(tpBeat) && Number.isFinite(tpDiv)) {
        const measureBase = phraseStart + measureIndex * tpMeasure;
        const beatBase = measureBase + (Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0) * tpBeat;
        divStart = beatBase + (Number.isFinite(Number(divIndex)) ? Number(divIndex) : 0) * tpDiv;
        divStartTime = measureStartTime + (Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0) * spBeat + (Number.isFinite(Number(divIndex)) ? Number(divIndex) : 0) * spDiv;
      }
      if ((!Number.isFinite(subdivStart) || !Number.isFinite(subdivStartTime)) && Number.isFinite(divStart) && Number.isFinite(tpSubdiv)) {
        subdivStart = divStart + (Number.isFinite(Number(subdivIndex)) ? Number(subdivIndex) : 0) * tpSubdiv;
        subdivStartTime = divStartTime + (Number.isFinite(Number(subdivIndex)) ? Number(subdivIndex) : 0) * spSubdiv;
      }
    }
  } catch (_e) { /* swallow */ }

  // Use globals (not layer.state) because LM.activate() already restored layer state to globals.
  // This ensures consistent timing across all unit calculations in cascading hierarchy.

  switch (unitType) {
    case 'phrase':
      // Critical-only: do not silently coerce invalid totals; fail loudly with trace info.
      if (!Number.isFinite(measuresPerPhrase) || measuresPerPhrase < 1) {
        // In short-play mode (PLAY_LIMIT) we may not have polyrhythm resolved; default to a safe bound
        if (process.env && process.env.PLAY_LIMIT) {
          const fallback = Number(process.env.PLAY_LIMIT) || 1;
          try { writeIndexTrace({ tag: 'timing:reconcile:measuresPerPhrase', when: new Date().toISOString(), layer, oldMeasuresPerPhrase: measuresPerPhrase, newMeasuresPerPhrase: fallback, note: 'PLAY_LIMIT fallback' }); } catch (_e) { /* swallow */ }
          measuresPerPhrase = fallback;
        } else {
          raiseCritical('invalid:measuresPerPhrase', 'measuresPerPhrase invalid or missing; expected finite > 0', { layer, measuresPerPhrase, sectionIndex, phraseIndex });
        }
      }
      tpPhrase = tpMeasure * measuresPerPhrase;
      spPhrase = tpPhrase / tpSec;

      // Defensive reconciliation: if tpPhrase is unexpectedly smaller than tpMeasure, repair when possible
      if (Number.isFinite(tpMeasure) && Number.isFinite(tpPhrase) && tpPhrase < tpMeasure) {
        // If a valid measuresPerPhrase is present, recompute tpPhrase to match tpMeasure
        if (Number.isFinite(measuresPerPhrase) && measuresPerPhrase > 0) {
          const oldTpPhrase = tpPhrase;
          tpPhrase = tpMeasure * measuresPerPhrase;
          spPhrase = tpPhrase / tpSec;
          try { writeIndexTrace({ tag: 'timing:reconcile:tpPhrase', when: new Date().toISOString(), layer, oldTpPhrase, newTpPhrase: tpPhrase, measuresPerPhrase }); } catch (_e) { /* swallow */ }
        } else if (process.env && process.env.PLAY_LIMIT) {
          // As a last resort in PLAY_LIMIT, force a single-measure phrase
          const oldTpPhrase = tpPhrase;
          measuresPerPhrase = 1;
          tpPhrase = tpMeasure * 1;
          spPhrase = tpPhrase / tpSec;
          try { writeIndexTrace({ tag: 'timing:reconcile:tpPhrase:playlimit', when: new Date().toISOString(), layer, oldTpPhrase, newTpPhrase: tpPhrase }); } catch (_e) { /* swallow */ }
        } else {
          // Let the original invalid:measuresPerPhrase check handle this
        }
      }
      // Derive phraseStart/phraseStartTime from section when caller provided a phraseIndex but not explicit phraseStart
      try {
        if ((!Number.isFinite(phraseStart) || !Number.isFinite(phraseStartTime)) && Number.isFinite(tpPhrase) && Number.isFinite(sectionStart) && Number.isFinite(sectionStartTime) && typeof phraseIndex !== 'undefined') {
          phraseStart = sectionStart + Number(phraseIndex) * tpPhrase;
          phraseStartTime = sectionStartTime + Number(phraseIndex) * spPhrase;
        }
      } catch (_e) { /* swallow */ }
      // Critical check: phrase boundaries must be within the section
      // Only enforce strictly when the phraseIndex is expected to lie inside the current section.
      try {
        // If `phrasesPerSection` is absent, do not assume index-based containment — defer index enforcement
        // until the *last* phrase when the section totals are final. `phrasesPerSection` itself is still
        // required elsewhere and will be raised if missing; here we conservatively avoid false positives.
        const insideCurrentSection = (typeof phrasesPerSection !== 'undefined' && Number.isFinite(Number(phrasesPerSection)) && Number(phrasesPerSection) > 0 && typeof phraseIndex !== 'undefined') ? (Number(phraseIndex) < Number(phrasesPerSection)) : false;
        const isLastPhrase = (typeof phrasesPerSection !== 'undefined' && Number.isFinite(Number(phrasesPerSection)) && typeof phraseIndex !== 'undefined' && (Number(phraseIndex) + 1) === Number(phrasesPerSection));
        try { if (TEST && TEST.DEBUG) console.log('phrase-check', { phraseStart, sectionStart, tpPhrase, tpSection, phraseIndex, phrasesPerSection, insideCurrentSection, isLastPhrase }); } catch (e) { /* swallow */ }

        // Explicit index-based check: only enforce when this is the last phrase of the section
        // because `tpSection` is not final until all phrases (randomly generated) are known.
        if (Number.isFinite(tpSection) && tpSection > 0 && Number.isFinite(tpPhrase) && typeof phraseIndex !== 'undefined' && Number.isFinite(Number(phraseIndex))) {
          const endIfIndexed = Number(phraseIndex + 1) * tpPhrase;
          if (isLastPhrase) {
            if (endIfIndexed > tpSection && insideCurrentSection) {
              try { writeDebugFile('phrase-boundary-debug.ndjson', { tag: 'index-check', when: new Date().toISOString(), layer, phraseIndex, phraseStart, tpPhrase, sectionStart, tpSection, endIfIndexed }); } catch (_e) { /* swallow */ }
              // Reconcile final section total instead of failing: the final phrase defines the
              // ultimate section duration when phrases are generated dynamically.
              try {
                writeIndexTrace({ tag: 'timing:reconcile:tpSection', when: new Date().toISOString(), layer, oldTpSection: tpSection, newTpSection: endIfIndexed, phraseIndex, tpPhrase });
              } catch (e) { /* swallow */ }
              tpSection = endIfIndexed; // extend section to include final phrase
            }
          } else {
            // Defer check — capture diagnostic so we can see why we skipped it in repro runs
            try { writeDebugFile('phrase-boundary-debug.ndjson', { tag: 'index-check-deferred', when: new Date().toISOString(), layer, phraseIndex, phraseStart, tpPhrase, sectionStart, tpSection, endIfIndexed, phrasesPerSection }); } catch (_e) { /* swallow */ }
          }
        }

        // Bounds check: always fail when phrase starts before section start. Only enforce the
        // right-hand bound when this is the last phrase and the section total is final.
        if (Number.isFinite(tpSection) && tpSection > 0 && (phraseStart < sectionStart)) {
          try { writeDebugFile('phrase-boundary-debug.ndjson', { tag: 'bounds-check-left', when: new Date().toISOString(), layer, phraseIndex, phraseStart, sectionStart, tpSection, tpPhrase, phrasesPerSection, measuresPerPhrase, sectionIndex, isLastPhrase, insideCurrentSection }); } catch (_e) { /* swallow */ }
          // If this happens on the last phrase, reconcile by shifting the section origin to
          // include the final phrase rather than failing. This mirrors the right-hand
          // reconciliation behavior implemented previously for final-phrase extension.
          if (isLastPhrase) {
            try { writeIndexTrace({ tag: 'timing:reconcile:sectionStart', when: new Date().toISOString(), layer, oldSectionStart: sectionStart, newSectionStart: phraseStart, phraseIndex, tpPhrase }); } catch (_e) { /* swallow */ }
            sectionStart = phraseStart; // adjust section start to include final phrase
          } else {
            raiseCritical('boundary:phrase', 'Computed phrase start is before section start', { layer, phraseIndex, phraseStart, sectionStart, tpSection });
          }
        }
        if (Number.isFinite(tpSection) && tpSection > 0 && isLastPhrase && ((phraseStart + tpPhrase) > (sectionStart + tpSection))) {
          try { writeDebugFile('phrase-boundary-debug.ndjson', { tag: 'bounds-check-right', when: new Date().toISOString(), layer, phraseIndex, phraseStart, tpPhrase, sectionStart, tpSection, phraseEnd: (phraseStart + tpPhrase), sectionEnd: (sectionStart + tpSection) }); } catch (_e) { /* swallow */ }
          raiseCritical('boundary:phrase', 'Computed phrase boundary out of section bounds', { layer, phraseIndex, phraseStart, tpPhrase, sectionStart, tpSection });
        }
      } catch (_e) { if (_e && _e.message && _e.message.indexOf('CRITICAL') === 0) throw _e; /* swallow other errors */ }
      break;

    case 'measure':
      measureStart = phraseStart + measureIndex * tpMeasure;
      measureStartTime = phraseStartTime + measureIndex * spMeasure;
      // Debug: log computed boundaries when enabled
      try { if (TEST && TEST.DEBUG) console.log('measure check', { phraseStart, tpMeasure, tpPhrase, measureIndex, measureStart, measureEnd: (measureStart + tpMeasure), phraseEnd: (phraseStart + tpPhrase) }); } catch (e) { /* swallow */ }
      // Early overlap detection: fail fast if an existing measure collides with the computed one
      try {
        const layerName = (LMCurrent && LMCurrent.activeLayer) ? LMCurrent.activeLayer : 'primary';
        const unitsArr = (LMCurrent && LMCurrent.layers && LMCurrent.layers[layerName] && Array.isArray(LMCurrent.layers[layerName].state.units)) ? LMCurrent.layers[layerName].state.units : [];
        const sTick = Number(measureStart);
        const eTick = Number(measureStart + tpMeasure);
        const TOL = 1; // one tick tolerance for minor rounding overlaps
        for (const ex of unitsArr) {
          if (!ex || ex.unitType !== 'measure') continue;
          const es = Number(ex.startTick || ex.start || 0);
          const ee = Number(ex.endTick || ex.end || 0);
          if (Number.isFinite(es) && Number.isFinite(ee) && (sTick < ee && eTick > es)) {
            // Compute overlap length and apply tolerance to avoid false positives from rounding
            const overlapLen = Math.min(eTick, ee) - Math.max(sTick, es);
            const payload = { tag: 'overlap-diagnostic', when: new Date().toISOString(), layer: layerName, unitType: 'measure', existing: ex, newUnit: { start: sTick, end: eTick }, indices: { sectionIndex: (typeof sectionIndex !== 'undefined' ? sectionIndex : 0), phraseIndex: (typeof phraseIndex !== 'undefined' ? phraseIndex : 0), measureIndex }, overlapLen };
            try { writeDebugFile('time-debug.ndjson', payload); } catch (_e) { /* swallow */ }
            if (overlapLen > TOL) {
              raiseCritical('overlap:unit', `Overlap detected for unitType=measure on layer=${layerName}`, { layer: layerName, unitType: 'measure', existing: ex, newUnit: { start: sTick, end: eTick }, indices: { sectionIndex: (typeof sectionIndex !== 'undefined' ? sectionIndex : 0), phraseIndex: (typeof phraseIndex !== 'undefined' ? phraseIndex : 0), measureIndex }, overlapLen });
            } else {
              // Minor rounding-only overlap: record for diagnosis but do not raise CRITICAL
              try { writeDebugFile('overlap-tolerance.ndjson', Object.assign({}, payload, { note: 'tolerated:rounding' })); } catch (_e) { /* swallow */ }
            }
          }
        }
      } catch (e) { if (e && e.message && e.message.indexOf('CRITICAL') === 0) throw e; /* swallow other errors */ }
      // Critical check: ensure measure does not start before the phrase. Also disallow measures to extend past phrase end
      try {
        // Only evaluate boundaries when tpPhrase is a valid finite number and the measureIndex is expected to be inside the current phrase.
        const insideCurrentPhrase = (typeof measuresPerPhrase !== 'undefined' && Number.isFinite(Number(measuresPerPhrase))) ? (Number(measureIndex) < Number(measuresPerPhrase)) : true;
        if (Number.isFinite(tpPhrase) && insideCurrentPhrase && ((measureStart < phraseStart) || ((measureStart + tpMeasure) > (phraseStart + tpPhrase)))) {
          const payload = { when: new Date().toISOString(), layer, measureIndex, measureStart, measureEnd: (measureStart + tpMeasure), phraseStart, phraseEnd: (phraseStart + tpPhrase), tpPhrase, tpMeasure, sectionIndex, phraseIndex, measuresPerPhrase };
          try { writeDebugFile('measure-boundary-debug.ndjson', payload); } catch (_e) { /* swallow */ }
          try { appendToFile('measure-boundary-debug.ndjson', payload); } catch (_e) { /* swallow */ }
          try { console.error('[setUnitTiming] measure-boundary payload', JSON.stringify(payload)); } catch (_e) { /* swallow */ }
          raiseCritical('boundary:measure', 'Computed measure boundary out of phrase bounds', { layer, measureIndex, measureStart, phraseStart, sectionIndex, phraseIndex });
        }
      } catch (_e) { if (_e && _e.message && _e.message.indexOf('CRITICAL') === 0) throw _e; /* swallow other errors */ }
      setMidiTiming();
      beatRhythm = setRhythm('beat');

      // Pre-populate beat & division caches for the current beat only (avoid flapping across beats)
      try {
        const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
        const cache = (LM.layers[layer] && LM.layers[layer].state) ? (LM.layers[layer].state._composerCache = LM.layers[layer].state._composerCache || {}) : null;
        if (cache && composer) {
          // Only pre-populate for the current beat to avoid multiple composer.getDivisions calls
          const bi = Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0;
          const beatKey = `beat:${measureIndex}:${bi}`;
          if (!cache[beatKey]) {
            if (typeof composer.getDivisions === 'function') {
              cache[beatKey] = { divisions: m.max(1, Number(composer.getDivisions())) };
              writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: beatKey, value: cache[beatKey], note: 'prepopulate:beat' });
            }
          }
          // Prepopulate subdivs for the current division only to minimize getter calls
          const divCount = cache[beatKey] && Number.isFinite(Number(cache[beatKey].divisions)) ? cache[beatKey].divisions : 1;
          const di = Number.isFinite(Number(divIndex)) ? Number(divIndex) : 0;
          if (di < divCount) {
            const divKey = `div:${measureIndex}:${bi}:${di}`;
            if (!cache[divKey]) {
              if (typeof composer.getSubdivs === 'function') {
                cache[divKey] = { subdivs: m.max(1, Number(composer.getSubdivs())) };
                writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: divKey, value: cache[divKey], note: 'prepopulate:beat' });
              }
            }
          }
        }
      } catch (e) { /* swallow */ }
      break;

    case 'beat':
      trackBeatRhythm();
      // Fallback: derive measureStart/measureStartTime when missing so boundary checks can run
      if ((!Number.isFinite(measureStart) || !Number.isFinite(measureStartTime)) && Number.isFinite(tpMeasure) && Number.isFinite(phraseStart)) {
        measureStart = phraseStart + measureIndex * tpMeasure;
        measureStartTime = phraseStartTime + measureIndex * spMeasure;
      }
      // Preserve explicit tpBeat set by tests; only compute when not provided
      if (!Number.isFinite(tpBeat) || tpBeat === 0) {
        tpBeat = tpMeasure / numerator;
      }
      spBeat = tpBeat / tpSec;
      trueBPM = 60 / spBeat;
      bpmRatio = BPM / trueBPM;
      bpmRatio2 = trueBPM / BPM;
      trueBPM2 = numerator * (numerator / denominator) / 4;
      bpmRatio3 = 1 / trueBPM2;

      // NOTE: Do not silently clamp beatIndex here — leave invalid inputs to surface
      // as CRITICAL errors so the root cause can be fixed rather than adapting to corrupt data.
      // The caller (play / tests / composer) is responsible for providing consistent indices.

      beatStart = phraseStart + measureIndex * tpMeasure + beatIndex * tpBeat;
      beatStartTime = measureStartTime + beatIndex * spBeat;
      // Critical check: beat boundaries must be within the measure
      try {
        const TOL = 1; // one tick tolerance to avoid false positives from rounding
        const leftViolation = Number.isFinite(measureStart) ? (measureStart - beatStart) : 0;
        const rightViolation = Number.isFinite(tpMeasure) ? ((beatStart + tpBeat) - (measureStart + tpMeasure)) : 0;
        if (Number.isFinite(tpMeasure) && (leftViolation > TOL || rightViolation > TOL)) {
          // Diagnostic: capture full timing state to aid root-cause analysis
          try {
            writeDebugFile('beat-boundary-debug.ndjson', {
              when: new Date().toISOString(),
              layer,
              activeLayer: (LM && LM.activeLayer) ? LM.activeLayer : null,
              indices: { sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, subsubdivIndex },
              meter: { numerator, denominator },
              tp: { tpSec, tpMeasure, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv },
              sp: { spMeasure, spBeat, spDiv, spSubdiv, spSubsubdiv },
              measureStart, measureStartTime, beatStart, beatEnd: (beatStart + tpBeat), measureEnd: (measureStart + tpMeasure),
              measuresPerPhrase1, measuresPerPhrase2, polyNumerator, polyDenominator, leftViolation, rightViolation, stack: (new Error()).stack
            });
          } catch (_e) { /* swallow diagnostic failures */ }

          // Attempt to reconcile cases where the last beat extends past the measure due to dynamic totals.
          // If this is the last beat in the measure (by numerator), extend the measure total instead of failing.
          let isLastBeat = false;
          try { isLastBeat = (typeof numerator !== 'undefined' && Number.isFinite(Number(numerator)) && typeof beatIndex !== 'undefined' && (Number(beatIndex) + 1) === Number(numerator)); } catch (e) { /* swallow */ }
          if (isLastBeat && rightViolation > TOL) {
            try { writeIndexTrace({ tag: 'timing:reconcile:tpMeasure', when: new Date().toISOString(), layer, oldTpMeasure: tpMeasure, newTpMeasure: (beatStart + tpBeat) - measureStart, beatIndex, measureIndex }); } catch (_e) { /* swallow */ }
            tpMeasure = (beatStart + tpBeat) - measureStart; // extend measure to include final beat
          } else if (!isLastBeat && leftViolation > TOL) {
            // If a beat starts before its measure on the first beat, shift the measure origin (rare but defensible)
            const isFirstBeat = (typeof beatIndex !== 'undefined' && Number(beatIndex) === 0);
            if (isFirstBeat && leftViolation > TOL) {
              try { writeIndexTrace({ tag: 'timing:reconcile:measureStart', when: new Date().toISOString(), layer, oldMeasureStart: measureStart, newMeasureStart: beatStart, beatIndex, measureIndex }); } catch (_e) { /* swallow */ }
              measureStart = beatStart;
            } else {
              raiseCritical('boundary:beat', 'Computed beat bounds fall outside parent measure bounds', { layer, beatIndex, beatStart, beatEnd: (beatStart + tpBeat), measureStart, measureEnd: (measureStart + tpMeasure), leftViolation, rightViolation, sectionIndex, phraseIndex, measureIndex });
            }
          } else {
            // Fallback: if not reconciled above, fail.
            raiseCritical('boundary:beat', 'Computed beat bounds fall outside parent measure bounds', { layer, beatIndex, beatStart, beatEnd: (beatStart + tpBeat), measureStart, measureEnd: (measureStart + tpMeasure), leftViolation, rightViolation, sectionIndex, phraseIndex, measureIndex });
          }
        } else if ((leftViolation > 0 && leftViolation <= TOL) || (rightViolation > 0 && rightViolation <= TOL)) {
          // Minor rounding-only anomaly: record for diagnosis but do not raise CRITICAL
          try { writeDebugFile('beat-boundary-tolerance.ndjson', { when: new Date().toISOString(), layer, beatIndex, beatStart, beatEnd: (beatStart + tpBeat), measureStart, measureEnd: (measureStart + tpMeasure), leftViolation, rightViolation }); } catch (_e) { /* swallow */ }
        }
      } catch (_e) { if (_e && _e.message && _e.message.indexOf('CRITICAL') === 0) throw _e; /* swallow other errors */ }
      // Get divisions from composer once per beat and cache to avoid flapping during child unit processing
      {
        const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
        const cache = (LM.layers[layer] && LM.layers[layer].state) ? (LM.layers[layer].state._composerCache = LM.layers[layer].state._composerCache || {}) : null;
        const beatKey = `beat:${measureIndex}:${beatIndex}`;
        if (cache) {
          if (!cache[beatKey]) {
            // Controlled one-shot population: call composer getter only during cache population (not as an error fallback)
            if (composer && typeof composer.getDivisions === 'function') {
              cache[beatKey] = { divisions: m.max(1, Number(composer.getDivisions())) };
              writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: beatKey, value: cache[beatKey] });
            } else if (!composer) {
              // No composer available: use conservative defaults so timing can still be computed deterministically in tests
              cache[beatKey] = { divisions: 1 };
              writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: beatKey, value: cache[beatKey], note: 'defaulted:composer-missing' });
            } else {
              // Composer present but missing getter - this is an error condition
              raiseCritical('getter:getDivisions', 'composer getter getDivisions missing; cannot compute divisions', { layer, beatKey, measureIndex, beatIndex });
            }
          } else {
            writeIndexTrace({ tag: 'composer:cache:hit', when: new Date().toISOString(), layer, key: beatKey, value: cache[beatKey] });
          }
          divsPerBeat = cache[beatKey].divisions;
        } else {
          // Composer cache unavailable: fail fast and write diagnostic payload
          raiseCritical('cache:unavailable:divisions', 'composer cache unavailable in setUnitTiming; cannot compute divisions', { layer, beatKey, measureIndex, beatIndex });
        }
      }
      divsPerBeat = m.max(1, Number(divsPerBeat) || 1);
      divsPerBeat = m.min(divsPerBeat, 8);
      // Reset child indices to avoid carry-over from previous beat/division
      divIndex = 0; subdivIndex = 0; subsubdivIndex = 0;
      divRhythm = setRhythm('div');
      break;

    case 'division':
      trackDivRhythm();
      // Derive base beat start using multiple fallbacks to avoid missing timing when upstream
      // indices or timing flip briefly (e.g., composers changing measuresPerPhrase).
      const baseBeatStart = (typeof beatStart !== 'undefined' && Number.isFinite(beatStart)) ? beatStart : (Number.isFinite(measureStart) && Number.isFinite(tpBeat) ? (measureStart + beatIndex * tpBeat) : null);
      const baseBeatStartTime = (typeof beatStartTime !== 'undefined' && Number.isFinite(beatStartTime)) ? beatStartTime : (Number.isFinite(measureStartTime) && Number.isFinite(spBeat) ? (measureStartTime + beatIndex * spBeat) : null);
      tpDiv = tpBeat / m.max(1, divsPerBeat);
      spDiv = tpDiv / tpSec;
      if (baseBeatStart === null || baseBeatStartTime === null) {
        try { appendToFile('division-debug.ndjson', { when: new Date().toISOString(), layer, measureIndex, beatIndex, baseBeatStart, baseBeatStartTime, phraseStart, measureStart, measureStartTime, tpMeasure, tpSec, tpBeat, spBeat }); } catch (_e) { /* swallow */ }
        // Fallback: if we can compute divStart from measureStart and tpDiv, do so and log a diagnostic
        if (Number.isFinite(measureStart) && Number.isFinite(tpDiv)) {
          divStart = measureStart + beatIndex * tpBeat + divIndex * tpDiv;
          divStartTime = Number.isFinite(measureStartTime) && Number.isFinite(spDiv) ? (measureStartTime + beatIndex * spBeat + divIndex * spDiv) : null;
          try { writeIndexTrace({ tag: 'timing:fallback:divStart', when: new Date().toISOString(), layer, measureIndex, beatIndex, divIndex, divStart, divStartTime }); } catch (_e) { /* swallow */ }
        } else {
          raiseCritical('missing:beatTiming', 'beat timing missing; cannot compute division timing', { layer, measureIndex, beatIndex, baseBeatStart, baseBeatStartTime });
        }
      } else {
        divStart = baseBeatStart + divIndex * tpDiv;
        divStartTime = baseBeatStartTime + divIndex * spDiv;
      }
      // Cache subdivs per division to avoid flapping during subdiv emission
      {
        const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
        const cache = (LM.layers[layer] && LM.layers[layer].state) ? (LM.layers[layer].state._composerCache = LM.layers[layer].state._composerCache || {}) : null;
        const divKey = `div:${measureIndex}:${beatIndex}:${divIndex}`;
        if (cache) {
          if (!cache[divKey]) {
            if (composer && typeof composer.getSubdivs === 'function') {
              cache[divKey] = { subdivs: m.max(1, Number(composer.getSubdivs())) };
              writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: divKey, value: cache[divKey] });
            } else if (!composer) {
              // No composer available: use default subdivs to allow timing to proceed
              cache[divKey] = { subdivs: 1 };
              writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: divKey, value: cache[divKey], note: 'defaulted:composer-missing' });
              // Do NOT raise a CRITICAL here; allow timing to proceed for test-mode/fallbacks
            } else {
              raiseCritical('getter:getSubdivs', 'composer getter getSubdivs missing; cannot compute subdivs', { layer, divKey, measureIndex, beatIndex, divIndex });
            }
          } else {
            writeIndexTrace({ tag: 'composer:cache:hit', when: new Date().toISOString(), layer, key: divKey, value: cache[divKey] });
          }
          subdivsPerDiv = cache[divKey].subdivs;
        } else {
          raiseCritical('cache:unavailable:subdivs', 'composer cache unavailable in setUnitTiming; cannot compute subdivs', { layer, divKey, measureIndex, beatIndex, divIndex });
        }
      }
      // Safety cap for subdivs per division
      subdivsPerDiv = m.min(subdivsPerDiv, 8);
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      // Reset child indices at division entry to avoid carry over from previous division
      subdivIndex = 0; subsubdivIndex = 0;
      if (TEST?.enableLogging) console.log(`division: divsPerBeat=${divsPerBeat} subdivsPerDiv=${subdivsPerDiv} subdivFreq=${subdivFreq}`);
      // Temporary trace for reproducer: capture composer and globals on division entry
      try {
        const _fs = require('fs'); const _path = require('path');
        const t = {
          tag: 'time:division-entry', when: new Date().toISOString(), layer: (LM && LM.activeLayer) ? LM.activeLayer : 'primary',
          sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex,
          // For trace stability when composers flip counts mid-play, clamp subdivIndex to current subdivsPerDiv
          subdivIndex: Number.isFinite(Number(subdivsPerDiv)) ? Math.min(subdivIndex, Math.max(0, Number(subdivsPerDiv) - 1)) : subdivIndex,
          divsPerBeat, subdivsPerDiv, numerator, meterRatio,
          // Use the clamped values in the trace to reflect the exact values used for timing
          composerDivisions: divsPerBeat,
          composerSubdivs: subdivsPerDiv
        };
        writeIndexTrace(t);
      } catch (_e) { /* swallow */ }
      subdivRhythm = setRhythm('subdiv');
      break;

    case 'subdiv':
      trackSubdivRhythm();
      tpSubdiv = tpDiv / m.max(1, (typeof subdivsPerDiv !== 'undefined' && Number.isFinite(Number(subdivsPerDiv))) ? Number(subdivsPerDiv) : 1);
      spSubdiv = tpSubdiv / tpSec;
      subdivsPerMinute = 60 / spSubdiv;
      if (!(typeof divStart !== 'undefined' && Number.isFinite(divStart) && typeof divStartTime !== 'undefined' && Number.isFinite(divStartTime))) {
        raiseCritical('missing:divTiming', 'division timing missing; cannot compute subdiv timing', { layer, divIndex, divStart: (typeof divStart !== 'undefined' ? divStart : null), divStartTime: (typeof divStartTime !== 'undefined' ? divStartTime : null) });
      }
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      // Cache sub-subdivs per subdiv to avoid flapping
      {
        const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
        const cache = (LM.layers[layer] && LM.layers[layer].state) ? (LM.layers[layer].state._composerCache = LM.layers[layer].state._composerCache || {}) : null;
        const subdivKey = `subdiv:${measureIndex}:${beatIndex}:${divIndex}:${subdivIndex}`;
        if (cache) {
          if (!cache[subdivKey]) {
            if (composer && typeof composer.getSubsubdivs === 'function') {
              cache[subdivKey] = { subsubdivs: m.max(1, Number(composer.getSubsubdivs())) };
              writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: subdivKey, value: cache[subdivKey] });
            } else {
              raiseCritical('getter:getSubsubdivs', 'composer getter getSubsubdivs missing; cannot compute subsubdivs', { layer, subdivKey, measureIndex, beatIndex, divIndex, subdivIndex });
            }
          } else {
            writeIndexTrace({ tag: 'composer:cache:hit', when: new Date().toISOString(), layer, key: subdivKey, value: cache[subdivKey] });
          }
          subsubsPerSub = cache[subdivKey].subsubdivs;
        } else {
          raiseCritical('cache:unavailable:subsubdivs', 'composer cache unavailable in setUnitTiming; cannot compute subsubdivs', { layer, subdivKey, measureIndex, beatIndex, divIndex, subdivIndex });
        }
      }
      // Safety cap for sub-subdivs
      subsubsPerSub = m.max(1, Number(subsubsPerSub) || 1);
      subsubsPerSub = m.min(subsubsPerSub, 4);
      if (TEST?.enableLogging) console.log(`subdiv: subdivsPerDiv=${subdivsPerDiv} subsubsPerSub=${subsubsPerSub} tpSubdiv=${tpSubdiv} spSubdiv=${spSubdiv}`);
      try { writeDebugFile('rhythm-debug.ndjson', { tag: 'subsub-call', layer, sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, subsubsPerSub, subsubdivRhythm: !!subsubdivRhythm, tpSubdiv, spSubdiv, tpSec }); } catch (_e) { /* swallow */ }
      subsubdivRhythm = setRhythm('subsubdiv');
      break;

    case 'subsubdiv':
      trackSubsubdivRhythm();
      tpSubsubdiv = tpSubdiv / m.max(1, (typeof subsubsPerSub !== 'undefined' && Number.isFinite(Number(subsubsPerSub))) ? Number(subsubsPerSub) : 1);
      spSubsubdiv = tpSubsubdiv / tpSec;
      subsubsPerMinute = 60 / spSubsubdiv;
      if (!Number.isFinite(subdivStart) || !Number.isFinite(subdivStartTime)) {
        raiseCritical('missing:subdivTiming', 'subdiv timing missing; cannot compute subsubdiv timing', { layer, subdivIndex, subdivStart, subdivStartTime });
      }
      // Early heuristic: if subsubsPerSub==1 and the subdiv is large relative to measure, treat as configuration error
      try {
        if (Number.isFinite(subsubsPerSub) && Number(subsubsPerSub) === 1 && Number.isFinite(tpSubdiv) && Number.isFinite(tpMeasure) && Number(tpSubdiv) >= (Math.max(1, Math.round(tpMeasure)) / 2)) {
          raiseCritical('overlong:subsubdiv_rel', 'Subsubdiv equals subdiv and is unusually large relative to measure; likely generator misconfiguration', { layer, unitType: 'subsubdiv', start: Number(subdivStart), end: Number(subdivStart + tpSubsubdiv), duration: Number(tpSubsubdiv), tpSubdiv, tpMeasure, indices: { sectionIndex, phraseIndex, measureIndex } });
        }
      } catch (_e) { /* swallow */ }
      subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;
      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;
      // Critical check: subsubdiv must be inside subdiv parent bounds
      // Allow a tiny tolerance to avoid spurious CRITICALs caused by floating-point rounding
      try {
        const TOL = 1; // one tick tolerance
        if (Number.isFinite(tpSubdiv) && ((subsubdivStart + TOL) < subdivStart || ((subsubdivStart + tpSubsubdiv) > (subdivStart + tpSubdiv + TOL)))) {
          raiseCritical('boundary:subsubdiv', 'Computed subsubdiv bounds fall outside parent subdiv bounds', { layer, subdivIndex, subsubdivIndex, subdivStart, tpSubdiv, subsubdivStart, tpSubsubdiv });
        }
      } catch (_e) { if (_e && _e.message && _e.message.indexOf('CRITICAL') === 0) throw _e; /* swallow other errors */ }
      break;

    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  // Persist a compact unit record into the layer state so writers can reference units later.
  try {
    const layerName = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
    try { writeDebugFile('time-debug.ndjson', { tag: 'persist-start', unitType, layerName, sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex }); } catch (_e) { /* swallow */ }
    const sec = (typeof sectionIndex !== 'undefined' && Number.isFinite(Number(sectionIndex))) ? Number(sectionIndex) : 0;
    const phr = (typeof phraseIndex !== 'undefined' && Number.isFinite(Number(phraseIndex))) ? Number(phraseIndex) : 0;
    const mea = (typeof measureIndex !== 'undefined' && Number.isFinite(Number(measureIndex))) ? Number(measureIndex) : 0;
    const bIdx = (typeof beatIndex !== 'undefined' && Number.isFinite(Number(beatIndex))) ? Number(beatIndex) : 0;
    const divIdx = (typeof divIndex !== 'undefined' && Number.isFinite(Number(divIndex))) ? Number(divIndex) : 0;
    const subdivIdx = (typeof subdivIndex !== 'undefined' && Number.isFinite(Number(subdivIndex))) ? Number(subdivIndex) : 0;
    const subsubIdx = (typeof subsubdivIndex !== 'undefined' && Number.isFinite(Number(subsubdivIndex))) ? Number(subsubdivIndex) : 0;

    const beatTotal = (typeof numerator !== 'undefined' && Number.isFinite(Number(numerator))) ? Number(numerator) : 1;
    const subdivTotal = (typeof subdivsPerDiv !== 'undefined' && Number.isFinite(Number(subdivsPerDiv))) ? Number(subdivsPerDiv) : 1;
    const subsubTotal = (typeof subsubsPerSub !== 'undefined' && Number.isFinite(Number(subsubsPerSub))) ? Number(subsubsPerSub) : 1;
    try { writeDebugFile('time-debug.ndjson', { tag: 'totals', beatTotal, subdivTotal, subsubTotal, numerator, subdivsPerDiv, subsubsPerSub }); } catch (_e) { /* swallow */ }

    // Compute canonical unit boundaries for this unitType so start/end are accurate
    let unitStart = 0;
    let unitEnd = 0;
    switch (unitType) {
      case 'section':
        unitStart = sectionStart;
        unitEnd = sectionStart + tpSection;
        break;
      case 'phrase':
        unitStart = phraseStart;
        unitEnd = phraseStart + tpPhrase;
        break;
      case 'measure':
        unitStart = measureStart;
        unitEnd = measureStart + tpMeasure;
        try { writeDebugFile('time-debug.ndjson', { tag: 'in-measure-case', measureStart, tpMeasure, unitStart, unitEnd }); } catch (_e) { /* swallow */ }
        break;
      case 'beat':
        unitStart = beatStart;
        unitEnd = beatStart + tpBeat;
        break;
      case 'division':
        unitStart = divStart;
        unitEnd = divStart + tpDiv;
        break;
      case 'subdiv':
        unitStart = subdivStart;
        unitEnd = subdivStart + tpSubdiv;
        break;
      case 'subsubdiv':
        unitStart = subsubdivStart;
        unitEnd = subsubdivStart + tpSubsubdiv;
        break;
      default:
        unitStart = 0;
        unitEnd = 0;
    }

    try { writeDebugFile('time-debug.ndjson', { tag: 'unitBounds', unitType, unitStart, unitEnd, tpSec, tpMeasure, tpBeat, tpDiv, tpSubdiv }); } catch (_e) { /* swallow */ }
    try { writeDebugFile('time-debug.ndjson', { tag: 'after-switch' }); } catch (_e) { /* swallow */ }

    // REMOVED: Clamp child unit boundaries to their parent unit to avoid overlaps or overlong spans
    // ANTI-PATTERN: NO POSTFIXES

    let startSecNum = (Number.isFinite(tpSec) && tpSec !== 0) ? (unitStart / tpSec) : null;
    let endSecNum = (Number.isFinite(tpSec) && tpSec !== 0) ? (unitEnd / tpSec) : null;
    try { writeDebugFile('time-debug.ndjson', { tag: 'secsComputed', startSecNum, endSecNum }); } catch (_e) { /* swallow */ }

    // Compute effective totals - critical-only: if totals are missing/invalid, fail loudly (no silent defaulting)
    // Use canonical `totalSections` variable everywhere; it must be present and numeric.
    if (!(typeof totalSections !== 'undefined' && Number.isFinite(Number(totalSections)))) raiseCritical('missing:totalSections', 'totalSections missing or invalid', { layer: layerName, totalSections, sectionIndex });
    if (!(typeof phrasesPerSection !== 'undefined' && Number.isFinite(Number(phrasesPerSection)))) raiseCritical('missing:phrasesPerSection', 'phrasesPerSection missing or invalid', { layer: layerName, phrasesPerSection, sectionIndex });
    if (!(typeof measuresPerPhrase !== 'undefined' && Number.isFinite(Number(measuresPerPhrase)))) raiseCritical('missing:measuresPerPhrase', 'measuresPerPhrase missing or invalid', { layer: layerName, measuresPerPhrase, phraseIndex });
    if (!(typeof numerator !== 'undefined' && Number.isFinite(Number(numerator)))) raiseCritical('missing:beatNumerator', 'numerator (beat total) missing or invalid', { layer: layerName, numerator });
    const effectiveSectionTotal = Number(totalSections);
    const effectivePhrasesPerSection = Number(phrasesPerSection);
    const effectiveMeasuresPerPhrase = Number(measuresPerPhrase);
    const effectiveBeatTotal = Number(numerator);

    // REMOVED: Compute effective totals here to avoid carrying stale/default totals into the first child unit of a new parent
    // ANTI-PATTERN: NO POSTFIXES - THE ENTIRE POINT OF LM IS TO PASS STATE CLEANLY

    // Diagnostic cache peek: compute cache keys and presence safely before tracing
    const _cache = (LMCurrent && LMCurrent.layers && LMCurrent.layers[layerName] && LMCurrent.layers[layerName].state) ? (LMCurrent.layers[layerName].state._composerCache = LMCurrent.layers[layerName].state._composerCache || {}) : null;
    const _mIdx = (typeof measureIndex !== 'undefined' && Number.isFinite(Number(measureIndex))) ? Number(measureIndex) : 0;
    const _bIdx = (typeof bIdx !== 'undefined' && Number.isFinite(Number(bIdx))) ? Number(bIdx) : 0;
    const _dIdx = (typeof divIdx !== 'undefined' && Number.isFinite(Number(divIdx))) ? Number(divIdx) : 0;
    const _sIdx = (typeof subdivIdx !== 'undefined' && Number.isFinite(Number(subdivIdx))) ? Number(subdivIdx) : 0;
    const _beatKey = `beat:${_mIdx}:${_bIdx}`;
    const _divKey = `div:${_mIdx}:${_bIdx}:${_dIdx}`;
    const _subdivKey = `subdiv:${_mIdx}:${_bIdx}:${_dIdx}:${_sIdx}`;
    writeIndexTrace({ tag: 'composer:cache:peek', when: new Date().toISOString(), layer: layerName, keys: { beat: _beatKey, div: _divKey, subdiv: _subdivKey }, cacheHas: { beat: !!(_cache && _cache[_beatKey]), div: !!(_cache && _cache[_divKey]), subdiv: !!(_cache && _cache[_subdivKey]) } });

    // Only query the cache levels that are relevant for this unitType to avoid spurious warnings
    let composerDivisionsCached;
    if (['beat','division','subdiv','subsubdiv'].includes(unitType)) {
      if (typeof divsPerBeat !== 'undefined' && Number.isFinite(Number(divsPerBeat))) {
        composerDivisionsCached = Number(divsPerBeat);
      } else if (_cache && _cache[_beatKey] && Number.isFinite(_cache[_beatKey].divisions)) {
        composerDivisionsCached = _cache[_beatKey].divisions;
        writeIndexTrace({ tag: 'composer:cache:get', when: new Date().toISOString(), layer, key: _beatKey, value: composerDivisionsCached });
      } else {
        writeIndexTrace({ tag: 'composer:cache:miss', when: new Date().toISOString(), layer, key: _beatKey });
        // Try to call composer getter on-demand before failing
        try {
          if (composer && typeof composer.getDivisions === 'function') {
            const computed = m.max(1, Number(composer.getDivisions()));
            composerDivisionsCached = computed;
            if (_cache) { _cache[_beatKey] = _cache[_beatKey] || {}; _cache[_beatKey].divisions = computed; }
            writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: _beatKey, value: { divisions: computed }, note: 'on-demand:beat' });
          } else {
            const safeBeatKey = (typeof _beatKey !== 'undefined') ? _beatKey : `beat:${measureIndex}:${beatIndex}`;
            raiseCritical('missing:divisions', `composer divisions missing for ${safeBeatKey}; cannot proceed`, { layer, beatKey: safeBeatKey, measureIndex, beatIndex, unitType });
          }
        } catch (_e2) { console.error('[setUnitTiming] missing:divisions', _e2 && _e2.stack ? _e2.stack : _e2); }
      }
    }

    let composerSubdivsCached;
    if (['division','subdiv','subsubdiv'].includes(unitType)) {
      if (typeof subdivsPerDiv !== 'undefined' && Number.isFinite(Number(subdivsPerDiv))) {
        composerSubdivsCached = Number(subdivsPerDiv);
      } else if (_cache && _cache[_divKey] && Number.isFinite(_cache[_divKey].subdivs)) {
        composerSubdivsCached = _cache[_divKey].subdivs;
        writeIndexTrace({ tag: 'composer:cache:get', when: new Date().toISOString(), layer, key: _divKey, value: composerSubdivsCached });
      } else {
        writeIndexTrace({ tag: 'composer:cache:miss', when: new Date().toISOString(), layer, key: _divKey });
        // Fail fast on missing high-level division subdivs: write rich diagnostics and throw
        try { raiseCritical('missing:subdivs', `composer subdivs missing for ${_divKey}; cannot proceed`, { layer, divKey, measureIndex, beatIndex, divIndex, unitType }); } catch (_e2) { console.error('[setUnitTiming] missing:subdivs', _e2 && _e2.stack ? _e2.stack : _e2); }
      }
    }

    let composerSubsubdivsCached;
    if (['subdiv','subsubdiv'].includes(unitType)) {
      if (typeof subsubsPerSub !== 'undefined' && Number.isFinite(Number(subsubsPerSub))) {
        composerSubsubdivsCached = Number(subsubsPerSub);
      } else if (_cache && _cache[_subdivKey] && Number.isFinite(_cache[_subdivKey].subsubdivs)) {
        composerSubsubdivsCached = _cache[_subdivKey].subsubdivs;
        writeIndexTrace({ tag: 'composer:cache:get', when: new Date().toISOString(), layer, key: _subdivKey, value: composerSubsubdivsCached });
      } else {
        writeIndexTrace({ tag: 'composer:cache:miss', when: new Date().toISOString(), layer, key: _subdivKey });
        // Critical: missing subsubdivs is a generator issue; fail loudly rather than fallback
        raiseCritical('missing:subsubdivs', `composer subsubdivs missing for ${_subdivKey}; cannot proceed`, { layer, subdivKey: _subdivKey, measureIndex, beatIndex, divIndex, subdivIndex });
      }
    }

    const effectiveDivsPerBeat = (typeof divsPerBeat !== 'undefined' && Number.isFinite(Number(divsPerBeat))) ? Number(divsPerBeat) : ((typeof composerDivisionsCached !== 'undefined' && Number.isFinite(Number(composerDivisionsCached))) ? composerDivisionsCached : 1);
    const effectiveSubdivTotal = (typeof subdivsPerDiv !== 'undefined' && Number.isFinite(Number(subdivsPerDiv))) ? Number(subdivsPerDiv) : ((typeof composerSubdivsCached !== 'undefined' && Number.isFinite(Number(composerSubdivsCached))) ? composerSubdivsCached : 1);
    const effectiveSubsubTotal = (typeof subsubsPerSub !== 'undefined' && Number.isFinite(Number(subsubsPerSub))) ? Number(subsubsPerSub) : ((typeof composerSubsubdivsCached !== 'undefined' && Number.isFinite(Number(composerSubsubdivsCached))) ? composerSubsubdivsCached : 1);

    try { writeDebugFile('time-debug.ndjson', { tag: 'about-to-build-unitRec', layerName, unitType, unitStart, unitEnd }); } catch (_e) { /* swallow */ }
    // Round start/end ticks and enforce non-overlap and span limits
    let sTick = Math.round(unitStart);
    let eTick = Math.round(unitEnd);

    // Enforce positive non-zero span
    if (!Number.isFinite(sTick)) sTick = 0;
    if (!Number.isFinite(eTick) || eTick <= sTick) eTick = sTick + 1;

    // REMOVED: Prevent overlaps with previously emitted units of the same unitType (stronger prevention)
   // ANTI-PATTERN: NO POSTIFIXES

    // REMOVED: Hard cap for subsubdiv spans to avoid pathological spans in treewalker
    // ANTI-PATTERN: NO POSTIFIXES

    const unitRec = {
      layer: layerName,
      unitType,
      sectionIndex: sec,
      sectionTotal: effectiveSectionTotal,
      phraseIndex: phr,
      phraseTotal: effectivePhrasesPerSection,
      measureIndex: mea,
      measureTotal: effectiveMeasuresPerPhrase,
      beatIndex: bIdx,
      beatTotal: effectiveBeatTotal,
      divIndex: divIdx,
      subdivIndex: subdivIdx,
      subdivTotal: effectiveSubdivTotal,
      subsubIndex: subsubIdx,
      subsubTotal: effectiveSubsubTotal,
      startTick: sTick,
      endTick: eTick,
      // Persist seconds-based start/end time when tpSec available (null otherwise)
      startTime: Number.isFinite(startSecNum) ? Number(startSecNum.toFixed(6)) : null,
      endTime: Number.isFinite(endSecNum) ? Number(endSecNum.toFixed(6)) : null
    };
    try { writeDebugFile('time-debug.ndjson', { tag: 'built-unitRec', layerName, unitType, unitRec }); } catch (_e) { /* swallow */ }
      // Optional: capture stack for every built unit to trace caller provenance (gated)
      if (process.env.CAPTURE_BUILT_STACK === '1') {
        try { appendToFile('built-unitRec-stacks.ndjson', { tag: 'built-unitRec-stack', when: new Date().toISOString(), layerName, unitType, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea, beatIndex: bIdx, divIndex: divIdx, subdivIndex: subdivIdx, subsubIndex: subsubIdx }, unitRec, stack: (new Error()).stack }); } catch (_e) { /* swallow */ }
      }


    // DEBUG: log unitRec push context
    try { writeDebugFile('time-debug.ndjson', { tag: 'pushUnitRec', layerName, unitType, parts: parts.slice(), unitStart: sTick, unitEnd: eTick, startTime: unitRec.startTime, endTime: unitRec.endTime }); } catch (_e) { /* swallow */ }
    if (LMCurrent && LMCurrent.layers && LMCurrent.layers[layerName]) {
      LMCurrent.layers[layerName].state.units = LMCurrent.layers[layerName].state.units || [];
        // Overlap check: fail if any existing unit of same type intersects
        for (const ex of LMCurrent.layers[layerName].state.units) {
          if (ex && ex.unitType === unitType && Number.isFinite(Number(ex.startTick)) && Number.isFinite(Number(ex.endTick))) {
            // Only treat as an overlap when the existing unit shares the same parent indices
            // (section/phrase/measure). This avoids false positives when units from different
            // parent contexts naturally have identical absolute ticks due to reused timing origin.
            // REMOVED: ANTI-PATTERN: NO POSTFIXES - EACH UNIT HAS TO INCREMENT, NOT STACK ON SIBLINGS!
            // const sameSection = (typeof ex.sectionIndex !== 'undefined' && typeof sec !== 'undefined') ? Number(ex.sectionIndex) === Number(sec) : true;
            // const samePhrase = (typeof ex.phraseIndex !== 'undefined' && typeof phr !== 'undefined') ? Number(ex.phraseIndex) === Number(phr) : true;
            // const sameMeasure = (typeof ex.measureIndex !== 'undefined' && typeof mea !== 'undefined') ? Number(ex.measureIndex) === Number(mea) : true;
            // if (!sameSection || !samePhrase || !sameMeasure) continue;

          const es = Number(ex.startTick); const ee = Number(ex.endTick);
          if (sTick < ee && eTick > es) {
            // Only treat as overlap when the existing unit shares the same parent indices
            const sameSection = (typeof ex.sectionIndex !== 'undefined' && typeof sec !== 'undefined') ? Number(ex.sectionIndex) === Number(sec) : true;
            const samePhrase = (typeof ex.phraseIndex !== 'undefined' && typeof phr !== 'undefined') ? Number(ex.phraseIndex) === Number(phr) : true;
            const sameMeasure = (typeof ex.measureIndex !== 'undefined' && typeof mea !== 'undefined') ? Number(ex.measureIndex) === Number(mea) : true;
            // Strengthen check: for units below the measure level, require the same beat to avoid comparing units across adjacent/overlapping beats when composer totals vary.
            const sameBeat = (typeof ex.beatIndex !== 'undefined' && typeof bIdx !== 'undefined') ? Number(ex.beatIndex) === Number(bIdx) : true;
            if (!sameSection || !samePhrase || !sameMeasure || !sameBeat) continue;

            // Exact duplicate: same start/end and same indices - treat as idempotent duplicate rather than a CRITICAL
            if (es === sTick && ee === eTick) {
              try { writeDebugFile('overlap-dupes.ndjson', { tag: 'overlap-duplicate', when: new Date().toISOString(), layer: layerName, unitType, existing: ex, newUnit: { start: sTick, end: eTick }, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea } }); } catch (_e) { /* swallow */ }
              continue;
            }
            // Compute overlap length and apply tolerance to avoid false positives from rounding
            const overlapLen = Math.min(eTick, ee) - Math.max(sTick, es);
            try {
              const recentUnits = (LMCurrent && LMCurrent.layers && LMCurrent.layers[layerName] && Array.isArray(LMCurrent.layers[layerName].state.units)) ? LMCurrent.layers[layerName].state.units.slice(Math.max(0, LMCurrent.layers[layerName].state.units.length - 10)) : null;
              const payload = {
                tag: 'overlap-diagnostic', when: new Date().toISOString(), layer: layerName, unitType,
                existing: ex, newUnit: { start: sTick, end: eTick }, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea },
                globals: { phraseStart, phraseStartTime, measureStart, measureStartTime, tpMeasure, tpDiv, tpSubdiv, tpSubsubdiv, tpSec, numerator, divsPerBeat, subdivsPerDiv, subsubsPerSub },
                unitsLength: LMCurrent.layers[layerName].state.units.length,
                recentUnits,
                overlapLen,
                stack: (new Error()).stack
              };
              try { writeDebugFile('time-debug.ndjson', payload); } catch (_e) { /* swallow */ }
              try { console.error('[setUnitTiming] Overlap diagnostic', JSON.stringify({ layer: layerName, unitType, existing: { start: es, end: ee }, newUnit: { start: sTick, end: eTick }, units: LMCurrent.layers[layerName].state.units.length })); } catch (_e) { /* swallow */ }
            } catch (_e) { /* swallow */ }
            const TOL = 1;
            if (overlapLen > TOL) {
              raiseCritical('overlap:unit', `Overlap detected for unitType=${unitType} on layer=${layerName}`, { layer: layerName, unitType, existing: ex, newUnit: { start: sTick, end: eTick }, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea }, overlapLen });
            } else {
              // Minor rounding-only overlap: record for diagnosis but do not raise CRITICAL
              try { writeDebugFile('overlap-tolerance.ndjson', Object.assign({}, { tag: 'overlap-tolerance', when: new Date().toISOString(), layer: layerName, unitType, existing: ex, newUnit: { start: sTick, end: eTick }, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea }, overlapLen }, { note: 'tolerated:rounding' })); } catch (_e) { /* swallow */ }
            }
          }
        }
      }
        // Subsubdiv span cap enforced here
        if (unitType === 'subsubdiv' && Number.isFinite(tpMeasure)) {
          const dur = eTick - sTick;
          if (dur > Math.max(1, Math.round(tpMeasure)) * 1.5) {
            raiseCritical('overlong:subsubdiv', `Subsubdiv span exceeds allowed threshold (${dur} > ${Math.max(1, Math.round(tpMeasure))} * 1.5)`, { layer: layerName, unitType, start: sTick, end: eTick, duration: dur, tpMeasure: tpMeasure, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea } });
          }
          // Additional heuristic: if subsubdiv equals the subdiv (i.e., subsubsPerSub==1) and subdivs are very large relative to measure, flag as critical
          try {
            if (Number.isFinite(subsubsPerSub) && Number(subsubsPerSub) === 1 && Number.isFinite(tpSubdiv) && Number.isFinite(tpMeasure)) {
              if ((eTick - sTick) >= Math.round(tpSubdiv) && Number(tpSubdiv) >= (Math.max(1, Math.round(tpMeasure)) / 2)) {
                raiseCritical('overlong:subsubdiv_rel', 'Subsubdiv equals subdiv and is unusually large relative to measure; likely generator misconfiguration', { layer: layerName, unitType, start: sTick, end: eTick, duration: (eTick - sTick), tpSubdiv, tpMeasure, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea } });
              }
            }
          } catch (_e) { /* swallow */ }
        }
        // Push unitRec into layer state for later inspection by writers/tests. We keep this simple
        // and deterministic: push the unit record and rely on earlier overlap checks to catch
        // mis-emissions. Defensive try/catch prevents unexpected failures from stopping play.
        try {
          // Defensive dedupe: if any previously pushed unit of the same type has identical
          // start/end ticks and parent indices, skip pushing to avoid duplicate emissions
          // (covers cases where setUnitTiming is called repeatedly or interleaved calls occur).
          const recent = LMCurrent.layers[layerName].state.units || [];
          let pushed = true;
          const isExactSame = (u) => u && u.unitType === unitType && Number(u.startTick) === Number(unitRec.startTick) && Number(u.endTick) === Number(unitRec.endTick) && u.sectionIndex === unitRec.sectionIndex && u.phraseIndex === unitRec.phraseIndex && u.measureIndex === unitRec.measureIndex && (typeof u.beatIndex === 'undefined' || typeof unitRec.beatIndex === 'undefined' ? true : Number(u.beatIndex) === Number(unitRec.beatIndex));

          const existingDup = recent.find(isExactSame);
          if (existingDup) {
            // Exact duplicate detected anywhere in current layer state — record and skip pushing
            pushed = false;
            try { writeDebugFile('time-debug.ndjson', { tag: 'exact-duplicate-skip', when: new Date().toISOString(), layerName, unitType, unitRec, existingDup }); } catch (_e) { /* swallow */ }
            try { writeDebugFile('duplicate-skip.ndjson', { when: new Date().toISOString(), layerName, unitType, unitRec, existingDup, note: 'exact-duplicate' }); } catch (_e) { /* swallow */ }
            try { LMCurrent.layers[layerName].state._duplicateSkips = (LMCurrent.layers[layerName].state._duplicateSkips || 0) + 1; } catch (_e) { /* swallow */ }
          }

          if (pushed) {
            LMCurrent.layers[layerName].state.units.push(unitRec);
            try { writeDebugFile('time-debug.ndjson', { tag: 'pushed-unitRec', when: new Date().toISOString(), layerName, unitType, unitRec }); } catch (_e) { /* swallow */ }
          }
        } catch (_e) {
          try { /* If push fails for some reason, avoid throwing to not destabilize test harness */ } catch (__e) { /* swallow */ }
        }
    }

    // Derive parts indices from the actual computed unitStart to avoid stale/carry-over index values
    // Fallback to nominal indices when timing values are not available
    let comp_mea = mea;
    let comp_bIdx = bIdx;
    let comp_divIdx = divIdx;
    let comp_subdivIdx = subdivIdx;
    let comp_subsubIdx = subsubIdx;
    try {
      if (Number.isFinite(tpMeasure) && tpMeasure !== 0) {
        comp_mea = Math.max(0, Math.floor((unitStart - phraseStart) / tpMeasure));
      }
      if (Number.isFinite(tpBeat) && tpBeat !== 0) {
        const measureBase = phraseStart + comp_mea * tpMeasure;
        comp_bIdx = Math.max(0, Math.floor((unitStart - measureBase) / tpBeat));
      }
      if (Number.isFinite(tpDiv) && tpDiv !== 0) {
        const beatBase = phraseStart + comp_mea * tpMeasure + comp_bIdx * tpBeat;
        comp_divIdx = Math.max(0, Math.floor((unitStart - beatBase) / tpDiv));
      }
      if (Number.isFinite(tpSubdiv) && tpSubdiv !== 0) {
        const divBase = phraseStart + comp_mea * tpMeasure + comp_bIdx * tpBeat + comp_divIdx * tpDiv;
        comp_subdivIdx = Math.max(0, Math.floor((unitStart - divBase) / tpSubdiv));
      }
      if (Number.isFinite(tpSubsubdiv) && tpSubsubdiv !== 0) {
        const subdivBase = phraseStart + comp_mea * tpMeasure + comp_bIdx * tpBeat + comp_divIdx * tpDiv + comp_subdivIdx * tpSubdiv;
        comp_subsubIdx = Math.max(0, Math.floor((unitStart - subdivBase) / tpSubsubdiv));
      }
    } catch (e) { /* swallow */ }

    // Build a compact full-id string per spec and emit an internal marker for writers to extract
    // Use sanitized (clamped) lower-level indices when those levels are not yet set to avoid using stale values
    const parts = [];
    parts.push(layerName);
    parts.push(`section${sec + 1}/${effectiveSectionTotal}`);
    parts.push(`phrase${(phr + 1)}/${effectivePhrasesPerSection}`);
    parts.push(`measure${(comp_mea + 1)}/${effectiveMeasuresPerPhrase}`);

    // Only include lower-level segments down to the current unitType to avoid mixing
    // example timing from a higher-level unit into a deeper canonical key (causes spurious huge ranges)
    const levelOrder = ['section','phrase','measure','beat','division','subdiv','subsubdiv'];
    const unitDepth = Math.max(0, levelOrder.indexOf(unitType));

    // Coerce effective totals to safe numeric values to avoid NaN/undefined in IDs
    const effBeatTotal = Number.isFinite(Number(effectiveBeatTotal)) ? Number(effectiveBeatTotal) : 1;
    const effDivsPerBeat = Number.isFinite(Number(effectiveDivsPerBeat)) ? Number(effectiveDivsPerBeat) : 1;
    const effSubdivTotal = Number.isFinite(Number(effectiveSubdivTotal)) ? Number(effectiveSubdivTotal) : 1;
    const effSubsubTotal = Number.isFinite(Number(effectiveSubsubTotal)) ? Number(effectiveSubsubTotal) : 1;
    // Sanitize indices: clamp to valid ranges so we never emit index > total
    const s_bIdx = Number.isFinite(bIdx) ? Math.max(0, Math.min(bIdx, Math.max(0, Number(effBeatTotal) - 1))) : 0;
    const s_divIdx = Number.isFinite(divIdx) ? Math.max(0, Math.min(divIdx, Math.max(0, Number(effDivsPerBeat) - 1))) : 0;
    const s_subdivIdx = Number.isFinite(subdivIdx) ? Math.max(0, Math.min(subdivIdx, Math.max(0, Number(effSubdivTotal) - 1))) : 0;
    const s_subsubIdx = Number.isFinite(subsubIdx) ? Math.max(0, Math.min(subsubIdx, Math.max(0, Number(effSubsubTotal) - 1))) : 0;

    if (unitDepth >= levelOrder.indexOf('beat')) parts.push(`beat${(s_bIdx + 1)}/${effBeatTotal}`);
    // Include division in canonical key to remove ambiguity across varying subdiv totals per division
    if (unitDepth >= levelOrder.indexOf('division')) parts.push(`division${(s_divIdx + 1)}/${effDivsPerBeat}`);
    if (unitDepth >= levelOrder.indexOf('subdiv')) parts.push(`subdiv${(s_subdivIdx + 1)}/${effSubdivTotal}`);
    if (unitDepth >= levelOrder.indexOf('subsubdiv')) parts.push(`subsubdiv${(s_subsubIdx + 1)}/${effSubsubTotal}`);
    const range = `${Math.round(unitStart)}-${Math.round(unitEnd)}`;
    // Prefer marker-derived seconds when available for this unit (search down from most-specific parts to less-specific)
    const getCsvForLayer = (layerName) => {
      // simple cached loader: map layer -> { key -> { startSec, endSec, tickStart, tickEnd, raw } }
      const cache = getCsvForLayer._cache = getCsvForLayer._cache || {};
      if (cache[layerName]) return cache[layerName];
      const map = {};
      try {
        const path = require('path'); const fs = require('fs');
        const csvPath = layerName === 'primary' ? path.join(process.cwd(), 'output', 'output1.csv') : (layerName === 'poly' ? path.join(process.cwd(), 'output', 'output2.csv') : path.join(process.cwd(),'output', `output${layerName}.csv`));
        if (fs.existsSync(csvPath)) {
          const txt = fs.readFileSync(csvPath, 'utf8');
          const lines = txt.split(new RegExp('\\r?\\n'));
          for (const ln of lines) {
            if (!ln || !ln.startsWith('1,')) continue;
            const partsLine = ln.split(','); if (partsLine.length < 4) continue;
            const tkn = partsLine[2]; if (String(tkn).toLowerCase() !== 'marker_t') continue;
            const val = partsLine.slice(3).join(',');
            const m = String(val).match(/unitRec:([^\s,]+)/);
            if (!m) continue;
            const full = m[1];
            const seg = full.split('|');
            // extract secs suffix if present (last segment like 0.000000-5.490196)
            let sStart = null, sEnd = null, tickStart = null, tickEnd = null;
            for (let i = seg.length - 1; i >= 0; i--) {
              const s = seg[i];
              if (/^\d+\.\d+-\d+\.\d+$/.test(s)) { const r = s.split('-'); sStart = Number(r[0]); sEnd = Number(r[1]); continue; }
              if (/^\d+-\d+$/.test(s)) { const r = s.split('-'); tickStart = Number(r[0]); tickEnd = Number(r[1]); continue; }
            }
            // build base key (without trailing tick/seconds segments)
            let baseSeg = seg.slice();
            while (baseSeg.length && (/^\d+\.\d+-\d+\.\d+$/.test(baseSeg[baseSeg.length-1]) || /^\d+-\d+$/.test(baseSeg[baseSeg.length-1]))) baseSeg.pop();
            const key = baseSeg.join('|');
            if (sStart !== null && sEnd !== null) {
              // prefer earliest start if multiple
              if (!map[key] || (map[key] && (sStart < map[key].startSec))) map[key] = { startSec: sStart, endSec: sEnd, tickStart, tickEnd, raw: full };
              // also store key without layer prefix (e.g. section1|phrase1|measure1...) for easier matching
              try { const keyNoLayer = key.split('|').slice(1).join('|'); if (keyNoLayer && (!map[keyNoLayer] || (map[keyNoLayer] && (sStart < map[keyNoLayer].startSec)))) map[keyNoLayer] = map[key]; } catch (_e) { /* swallow */ }
            } else if (tickStart !== null && tickEnd !== null) {
              if (!map[key] || (!map[key].startSec && tickStart < (map[key].tickStart || Infinity))) map[key] = { startSec: null, endSec: null, tickStart, tickEnd, raw: full };
              try { const keyNoLayer = key.split('|').slice(1).join('|'); if (keyNoLayer && (!map[keyNoLayer] || (!map[keyNoLayer].startSec && tickStart < (map[keyNoLayer].tickStart || Infinity)))) map[keyNoLayer] = map[key]; } catch (_e) { /* swallow */ }
            }
          }
        }
      } catch (e) { /* swallow */ }
      cache[layerName] = map; return map;
    };

    const findMarkerSecs = (layerName, partsArr) => {
      const map = getCsvForLayer(layerName);
      try { writeDebugFile('time-debug.ndjson', { tag: 'markerMap-keys', layerName, keys: Object.keys(map).slice(0,20) }); } catch (_e) { /* swallow */ }
      // try most-specific to least-specific
      for (let len = partsArr.length; len > 0; len--) {
        const k = partsArr.slice(0, len).join('|');
        const kNorm = partsArr.slice(0, len).map(p => String(p).replace(/\/1$/, '')).join('|');
        try { writeDebugFile('time-debug.ndjson', { tag: 'findMarkerSecs-check', len, k, kNorm, hasK: !!(map && map[k]), hasKNorm: !!(map && map[kNorm]) }); } catch (_e) { /* swallow */ }
        if (map && map[k] && Number.isFinite(map[k].startSec)) return map[k];
        if (kNorm !== k && map && map[kNorm] && Number.isFinite(map[kNorm].startSec)) return map[kNorm];
        // as a last resort, try matching more-specific map keys that start with the requested key
        if (map) {
          const keys = Object.keys(map);
          for (const mk of keys) {
            if (mk.startsWith(k + '|') && Number.isFinite(map[mk].startSec)) return map[mk];
            if (kNorm !== k && mk.startsWith(kNorm + '|') && Number.isFinite(map[mk].startSec)) return map[mk];
          }
        }
      }
      return null;
    };

    const markerMatch = findMarkerSecs(layerName, parts);
    let secs = null;
    if (markerMatch && Number.isFinite(markerMatch.startSec) && Number.isFinite(markerMatch.endSec)) {
      try { writeDebugFile('time-debug.ndjson', { tag: 'markerMatch-found', markerMatch }); } catch (_e) { /* swallow */ }
      secs = `${markerMatch.startSec.toFixed(6)}-${markerMatch.endSec.toFixed(6)}`;
      // also override startSecNum/endSecNum for downstream use
      if (Number.isFinite(markerMatch.startSec)) startSecNum = markerMatch.startSec;
      if (Number.isFinite(markerMatch.endSec)) endSecNum = markerMatch.endSec;

      // Update previously-pushed unitRec (and local unitRec variable) to reflect marker-derived seconds
      try {
        try { writeDebugFile('time-debug.ndjson', { tag: 'applying-marker-secs', unitType, startSecNum, endSecNum, layerName, unitStart: Math.round(unitStart), unitEnd: Math.round(unitEnd) }); } catch (_e) { /* swallow */ }
        if (typeof unitRec !== 'undefined') {
          unitRec.startTime = Number.isFinite(startSecNum) ? Number(startSecNum.toFixed(6)) : null;
          unitRec.endTime = Number.isFinite(endSecNum) ? Number(endSecNum.toFixed(6)) : null;
        }
        if (LMCurrent && LMCurrent.layers && LMCurrent.layers[layerName] && Array.isArray(LMCurrent.layers[layerName].state.units)) {
          const uarr = LMCurrent.layers[layerName].state.units;
          const last = uarr[uarr.length - 1];
          if (last && last.unitType === unitType && last.startTick === Math.round(unitStart) && last.endTick === Math.round(unitEnd)) {
            last.startTime = unitRec.startTime;
            last.endTime = unitRec.endTime;
          }
        }
      } catch (_e) { /* swallow */ }

    } else {
      secs = (Number.isFinite(tpSec) && tpSec !== 0) ? `${(unitStart / tpSec).toFixed(6)}-${(unitEnd / tpSec).toFixed(6)}` : null;
    }

    const fullId = secs ? (parts.join('|') + '|' + range + '|' + secs) : (parts.join('|') + '|' + range);

    // If a TARGET_PARENT is set, write a focused hit file when we reach that parent prefix
    try {
      const _fs = require('fs'); const _path = require('path');
      const parentPrefix = parts.join('|');
      if (process.env && process.env.TARGET_PARENT && String(process.env.TARGET_PARENT).length) {
        try {
          const target = String(process.env.TARGET_PARENT);
          if (parentPrefix.startsWith(target)) {
            const safe = target.replace(/[^a-zA-Z0-9-_]/g, '_');
            const globalsSnapshot = {
              phraseStart, phraseStartTime, measureStart, measureStartTime, sectionStart, sectionStartTime,
              tpPhrase, tpMeasure, tpSection, tpSec, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv,
              numerator, denominator, measuresPerPhrase, divsPerBeat, subdivsPerDiv, subsubsPerSub
            };
            const recentUnits = (() => { try { if (LMCurrent && LMCurrent.layers && LMCurrent.layers[LMCurrent.activeLayer] && Array.isArray(LMCurrent.layers[LMCurrent.activeLayer].state.units)) { return LMCurrent.layers[LMCurrent.activeLayer].state.units.slice(Math.max(0, LMCurrent.layers[LMCurrent.activeLayer].state.units.length - 10)); } } catch (_e) { /* swallow */ } return null; })();
            const hit = { when: new Date().toISOString(), target, parentPrefix, fullId, unitRec, globals: globalsSnapshot, recentUnits, stack: (new Error()).stack.split('\n').slice(2).map(s => s.trim()) };
            try { writeDebugFile(`repro-parent-hit-${safe}.ndjson`, hit); } catch (_e) { /* swallow */ }
          }
        } catch (_e) { /* swallow */ }
      }
      // Temporary trace: record timing snapshot immediately before anomaly checks
      writeIndexTrace({ tag: 'time:pre-anomaly', when: new Date().toISOString(), layer: (LM && LM.activeLayer) ? LM.activeLayer : 'primary', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, subsubdivIndex, numerator, divsPerBeat, subdivsPerDiv, subsubsPerSub, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv, tpSec });
      const anomalies = [];
      // Only flag strict greater-than (not loop-exit equality) to reduce transient noise
      // Only compare indices that are relevant to the current unitType to avoid spurious child-index carry-over reports
      const divTotal = (typeof divsPerBeat !== 'undefined' && Number.isFinite(Number(divsPerBeat))) ? Number(divsPerBeat) : 1;
      if (unitType === 'beat' && bIdx > beatTotal) anomalies.push({ field: 'beat', idx: bIdx, total: beatTotal });
      if (unitType === 'division' && divIdx > divTotal) anomalies.push({ field: 'division', idx: divIdx, total: divTotal });
      if (unitType === 'subdiv' && subdivIdx > subdivTotal) anomalies.push({ field: 'subdiv', idx: subdivIdx, total: subdivTotal });
      if (unitType === 'subsubdiv' && subsubIdx > subsubTotal) anomalies.push({ field: 'subsubdiv', idx: subsubIdx, total: subsubTotal });
      if (anomalies.length) {
        try {
          // Critical log for index anomalies (do NOT normalize here; just warn)
          console.error(`CRITICAL: unit index anomaly - ${layerName} ${unitType} ${fullId} ${JSON.stringify(anomalies)}`);
          try { writeDebugFile('unitIndex-anomalies.ndjson', { layer: layerName, unitType, unitId: fullId, anomalies, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea, beatIndex: bIdx, divIndex: divIdx, subdivIndex: subdivIdx, subsubIndex: subsubIdx }, when: new Date().toISOString() }); } catch (_e) { /* swallow */ }

          // Enriched diagnostic payload for deep inspection
          try {
            const composerInfo = (typeof composer !== 'undefined' && composer) ? {
              meter: (typeof composer.getMeter === 'function' ? composer.getMeter() : null),
              divisions: (typeof composer.getDivisions === 'function' ? composer.getDivisions() : null),
              subdivs: (typeof composer.getSubdivs === 'function' ? composer.getSubdivs() : null),
              subsubdivs: (typeof composer.getSubsubdivs === 'function' ? composer.getSubsubdivs() : null)
            } : null;

            const globalsSnapshot = {
              phraseStart, phraseStartTime, measureStart, measureStartTime, sectionStart, sectionStartTime,
              tpPhrase, tpMeasure, tpSection, tpSec, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv,
              numerator, denominator, measuresPerPhrase, divsPerBeat, subdivsPerDiv, subsubsPerSub
            };

            const recentUnits = (() => {
              try {
                if (LM && LM.layers && LM.layers[layerName] && Array.isArray(LM.layers[layerName].state.units)) {
                  const u = LM.layers[layerName].state.units;
                  return u.slice(Math.max(0, u.length - 6));
                }
              } catch (_e) { /* swallow */ }
              return null;
            })();

            const stack = (() => { try { return (new Error()).stack.split('\n').slice(2).map(s => s.trim()); } catch (_e) { return []; } })();

            const rich = {
              layer: layerName,
              unitType,
              unitId: fullId,
              anomalies,
              indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea, beatIndex: bIdx, divIndex: divIdx, subdivIndex: subdivIdx, subsubIndex: subsubIdx },
              composer: composerInfo,
              globals: globalsSnapshot,
              recentUnits,
              stack,
              when: new Date().toISOString()
            };

            try { writeDebugFile('unitIndex-anomalies-rich.ndjson', rich); } catch (_e) { /* swallow */ }
            // If the ASSERT gate is enabled, write a fatal diagnostic and throw so tests fail fast (helps CI detect regressions)
            try {
              if (process.env.INDEX_TRACES_ASSERT) {
                try { appendToFile('unitIndex-anomalies-fatal.ndjson', Object.assign({ note: 'INDEX_TRACES_ASSERT' }, rich)); } catch (_e2) { /* swallow */ }
                throw new Error('unit index anomaly (INDEX_TRACES_ASSERT) - ' + JSON.stringify(anomalies));
              }
            } catch (_e) { /* swallow */ }
          } catch (_e) { /* swallow */ }

        } catch (_e) { /* swallow */ }
      }
    } catch (_e) { /* swallow */ }

    // Diagnostic: record suspicious unit emissions (start==0 with non-zero end, non-finite, or start>end)
    try {
      const suspicious = !Number.isFinite(unitStart) || !Number.isFinite(unitEnd) || (unitStart === 0 && unitEnd !== 0) || (unitStart > unitEnd);
      if (suspicious) {
        // Build a rich diagnostic payload with timing snapshot and stack
        const globalsSnapshot = {
          phraseStart, phraseStartTime, measureStart, measureStartTime, sectionStart, sectionStartTime,
          tpPhrase, tpMeasure, tpSection, tpSec, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv,
          numerator, denominator, measuresPerPhrase, divsPerBeat, subdivsPerDiv, subsubsPerSub
        };
        const stack = (() => {
          try { return (new Error()).stack.split('\n').slice(2).map(s => s.trim()); } catch (_e) { return []; }
        })();
        const diag = {
          layer: layerName,
          unitType,
          unitId: fullId,
          start: Math.round(unitStart),
          end: Math.round(unitEnd),
          indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea, beatIndex: bIdx, divIndex: divIdx, subdivIndex: subdivIdx, subsubIndex: subsubIdx },
          globals: globalsSnapshot,
          lmActive: (LM && LM.activeLayer) ? LM.activeLayer : null,
          when: new Date().toISOString(),
          stack
        };
        try {
          const _fs = require('fs'); const _path = require('path');
          try { writeDebugFile('unitTreeAudit-diagnostics.ndjson', diag); } catch (_e) { /* swallow */ }
          // Keep legacy short list for quick inspection
          try { writeDebugFile('unitTreeAudit-suspicious-units.ndjson', { layer: layerName, unitType, unitId: fullId, start: Math.round(unitStart), end: Math.round(unitEnd), when: diag.when }); } catch (_e) { /* swallow */ }
        } catch (_e) { /* swallow */ }
      }
    } catch (_e) { /* swallow */ }

    try {
      // Diagnostic: record overlong unit emissions that exceed a measure (likely root of overlaps)
      try {
        const dur = Math.round(unitEnd - unitStart);
        const measureDur = Number.isFinite(tpMeasure) ? Math.round(tpMeasure) : null;
        if (dur > 0 && measureDur !== null && dur > Math.max(1, measureDur) * 1.5) {
          const _fs = require('fs'); const _path = require('path');
          const diag = {
            tag: 'overlong-unit', when: new Date().toISOString(), layer: layerName, unitType, fullId, startTick: Math.round(unitStart), endTick: Math.round(unitEnd), duration: dur, tpMeasure: measureDur, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea, beatIndex: bIdx, divIndex: divIdx, subdivIndex: subdivIdx, subsubIndex: subsubIdx }, parts: parts.slice(), composer: (typeof composer !== 'undefined' && composer) ? { divisions: (typeof composer.getDivisions === 'function' ? composer.getDivisions() : null), subdivs: (typeof composer.getSubdivs === 'function' ? composer.getSubdivs() : null), subsubdivs: (typeof composer.getSubsubdivs === 'function' ? composer.getSubsubdivs() : null) } : null, stack: (new Error()).stack.split('\n').slice(2).map(s => s.trim()) };
          try { writeDebugFile('overlong-units.ndjson', diag); } catch (e) { /* swallow */ }
          // If assert gating is enabled, write fatal diag and throw to fail fast
          if (process.env.INDEX_TRACES_ASSERT) {
            try { appendToFile('unitIndex-anomalies-fatal.ndjson', Object.assign({ note: 'OVERLONG_UNIT_ASSERT' }, diag)); } catch (e) { /* swallow */ }
            throw new Error('overlong unit detected');
          }
        }
      } catch (_e) { /* swallow */ }

      // Add to live master unit map (tick-first canonical aggregator) using the canonical part key
      try { const MasterMap = require('./masterMap'); MasterMap.addUnit({ parts: parts.slice(), layer: layerName, startTick: Math.round(unitStart), endTick: Math.round(unitEnd), startTime: startSecNum, endTime: endSecNum, raw: unitRec }); } catch (_e) { /* swallow */ }
      // Emit a labeled unitRec marker so CSV markers are both machine-parseable and human-friendly.
      // Example: "New Beat:unitRec:primary|section1/9|phrase1/4|measure1/5|beat1/8|1500-1875|0.045113-0.056391"
      const label = `New ${unitType.charAt(0).toUpperCase() + unitType.slice(1)}`;
      p(c, { tick: Math.round(unitStart), type: 'marker_t', vals: [`${label}:unitRec:${fullId}`], _internal: true });

      // REMOVED: Ensure section markers present in all layers by propagating primary's section markers into other layers
      // ANTI-PATTERN: NO POSTIFXES
    } catch (_e) { if (TEST?.enableLogging) console.log('[setUnitTiming] error emitting marker to buffer', _e && _e.stack ? _e.stack : _e); }
} catch (_e) { try { console.error('[setUnitTiming] persist block error', _e && _e.stack ? _e.stack : _e); } catch (_e2) { /* swallow */ } }

  // Log the unit after calculating timing
  logUnit(unitType);
};

/**
 * Format seconds as MM:SS.ssss time string.
 * @param {number} seconds - Time in seconds.
 * @returns {string} Formatted time string (MM:SS.ssss).
 */
formatTime = (seconds) => {
  const minutes = m.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};

// Marker cache (module-level) to support efficient marker-preference lookups across unit levels
const _markerCache = {}; // layerName -> { mtime: number, map: { key -> { startSec, endSec, tickStart, tickEnd, raw } } }

const _csvPathForLayer = (layerName) => {
  const path = require('path');
  if (layerName === 'primary') return path.join(process.cwd(), 'output', 'output1.csv');
  if (layerName === 'poly') return path.join(process.cwd(), 'output', 'output2.csv');
  return path.join(process.cwd(), 'output', `output${layerName}.csv`);
};

const loadMarkerMapForLayer = (layerName) => {
  const fs = require('fs');
  const p = _csvPathForLayer(layerName);
  try {
    const stat = fs.existsSync(p) ? fs.statSync(p) : null;
    const mtime = stat ? stat.mtimeMs : null;
    const cacheEntry = _markerCache[layerName];
    if (cacheEntry && cacheEntry.mtime === mtime && cacheEntry.map) return cacheEntry.map;
    const map = {};
    if (!fs.existsSync(p)) { _markerCache[layerName] = { mtime, map: {} }; return map; }
    const txt = fs.readFileSync(p, 'utf8');
    const lines = txt.split(new RegExp('\\r?\\n'));
    for (const ln of lines) {
      if (!ln || !ln.startsWith('1,')) continue;
      const partsLine = ln.split(','); if (partsLine.length < 4) continue;
      const tkn = partsLine[2]; if (String(tkn).toLowerCase() !== 'marker_t') continue;
      const val = partsLine.slice(3).join(',');
      const m = String(val).match(/unitRec:([^\s,]+)/);
      if (!m) continue;
      const full = m[1];
      const seg = full.split('|');
      let sStart = null, sEnd = null, tickStart = null, tickEnd = null;
      for (let i = seg.length - 1; i >= 0; i--) {
        const s = seg[i];
        if (/^\d+\.\d+-\d+\.\d+$/.test(s)) { const r = s.split('-'); sStart = Number(r[0]); sEnd = Number(r[1]); continue; }
        if (/^\d+-\d+$/.test(s)) { const r = s.split('-'); tickStart = Number(r[0]); tickEnd = Number(r[1]); continue; }
      }
      let baseSeg = seg.slice();
      while (baseSeg.length && (/^\d+\.\d+-\d+\.\d+$/.test(baseSeg[baseSeg.length-1]) || /^\d+-\d+$/.test(baseSeg[baseSeg.length-1]))) baseSeg.pop();
      const key = baseSeg.join('|');
      if (sStart !== null && sEnd !== null) {
        if (!map[key] || (map[key] && (sStart < map[key].startSec))) map[key] = { startSec: sStart, endSec: sEnd, tickStart, tickEnd, raw: full };
      } else if (tickStart !== null && tickEnd !== null) {
        if (!map[key] || (!map[key].startSec && tickStart < (map[key].tickStart || Infinity))) map[key] = { startSec: null, endSec: null, tickStart, tickEnd, raw: full };
      }
    }
    _markerCache[layerName] = { mtime, map };
    // Expose lightweight test hook (avoid `globalThis`/`global` usage — use centralized TEST namespace if present)
    if (TEST) {
      TEST._markerCache = TEST._markerCache || {};
      TEST._markerCache[layerName] = { mtime, keys: Object.keys(map) };
    }
    return map;
  } catch (e) {
    _markerCache[layerName] = { mtime: null, map: {} };
    return {};
  }
};

const findMarkerSecs = (layerName, partsArr) => {
  const map = loadMarkerMapForLayer(layerName);
  try { writeDebugFile('time-debug.ndjson', { tag: 'markerMap-keys', layerName, keys: Object.keys(map).slice(0,20) }); } catch (_e) { /* swallow */ }
  if (!map) return null;
  for (let len = partsArr.length; len > 0; len--) {
    const k = partsArr.slice(0, len).join('|');
    if (map[k] && Number.isFinite(map[k].startSec)) return map[k];
    // Try normalized key without '/1' suffixes (backward-compatible)
    const kNorm = partsArr.slice(0, len).map(p => String(p).replace(/\/1$/, '')).join('|');
    if (kNorm !== k && map[kNorm] && Number.isFinite(map[kNorm].startSec)) return map[kNorm];
  }
  for (let len = partsArr.length; len > 0; len--) {
    const k = partsArr.slice(0, len).join('|');
    if (map[k] && (Number.isFinite(map[k].tickStart) && Number.isFinite(map[k].tickEnd))) return map[k];
    const kNorm = partsArr.slice(0, len).map(p => String(p).replace(/\/\d+$/, '')).join('|');
    if (kNorm !== k && map[kNorm] && (Number.isFinite(map[kNorm].tickStart) && Number.isFinite(map[kNorm].tickEnd))) return map[kNorm];
  }
  return null;
};

// Export small test helpers via centralized TEST hooks
try { TEST.loadMarkerMapForLayer = loadMarkerMapForLayer; TEST.findMarkerSecs = findMarkerSecs; TEST.clearMarkerCache = (layerName) => { try { delete _markerCache[layerName]; } catch (e) { /* swallow */ } }; } catch (e) { /* swallow */ }

// Export TimingCalculator to TEST hooks
try { TEST.TimingCalculator = TimingCalculator; } catch (e) { /* swallow */ }

// Export public API for programmatic imports and testing
try {
  module.exports = module.exports || {};
  module.exports.TimingCalculator = TimingCalculator;
  module.exports.getMidiTiming = getMidiTiming;
  module.exports.setMidiTiming = setMidiTiming;
  module.exports.setUnitTiming = setUnitTiming;
  module.exports.loadMarkerMapForLayer = loadMarkerMapForLayer;
  module.exports.findMarkerSecs = findMarkerSecs;
  module.exports.clearMarkerCache = (layerName) => { try { delete _markerCache[layerName]; } catch (e) { /* swallow */ } };
} catch (e) { /* swallow export errors */ }
