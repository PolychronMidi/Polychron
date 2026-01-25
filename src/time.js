// time.js - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

const { writeIndexTrace, writeDebugFile } = require('./logGate');

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

// Export TimingCalculator to global namespace for tests and other modules
globalThis.TimingCalculator = TimingCalculator;
// One-time warning helper to avoid flooding logs with the same critical messages
const _polychron_warned = new Set();
function warnOnce(key, msg) {
  try {
    if (_polychron_warned.has(key)) return;
    _polychron_warned.add(key);
    console.warn(msg);
  } catch (e) { /* swallow logging errors */ }
}

// Fail-fast critical handler: write diagnostic payload and throw to surface root cause immediately
function raiseCritical(key, msg, ctx = {}) {
  try {
    const _fs = require('fs'); const _path = require('path');
    const outDir = _path.join(process.cwd(), 'output');
    try { if (!_fs.existsSync(outDir)) _fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}

    // Small diagnostic snapshot to help triage: composer identity and LM layer keys
    let composerInfo = null;
    try {
      composerInfo = {
        name: composer && composer.constructor && composer.constructor.name ? composer.constructor.name : (typeof composer),
        hasGetDivisions: composer && typeof composer.getDivisions === 'function',
        hasGetSubdivisions: composer && typeof composer.getSubdivisions === 'function',
        hasGetSubsubdivs: composer && typeof composer.getSubsubdivs === 'function',
      };
    } catch (_e) { composerInfo = { error: String(_e) }; }

    let lmInfo = null;
    try {
      lmInfo = { activeLayer: LM && LM.activeLayer, layers: LM && LM.layers ? Object.keys(LM.layers) : null };
    } catch (_e) { lmInfo = { error: String(_e) }; }

    // Attempt to append last 50 index-traces lines to payload (if present)
    let recentIndexTraces = null;
    try {
      const _path2 = _path.join(process.cwd(), 'output', 'index-traces.ndjson');
      if (_fs.existsSync(_path2)) {
        const lines = _fs.readFileSync(_path2, 'utf8').split(/\r?\n/).filter(Boolean);
        recentIndexTraces = lines.slice(-50).map(l => { try { return JSON.parse(l); } catch (e) { return l; } });
      }
    } catch (_e) { recentIndexTraces = `err:${String(_e)}`; }

    const payload = Object.assign({ when: new Date().toISOString(), key, msg, stack: (new Error()).stack, composerInfo, lmInfo, recentIndexTraces }, ctx);
    try { _fs.appendFileSync(_path.join(outDir, 'critical-errors.ndjson'), JSON.stringify(payload) + '\n'); } catch (e) {}
  } catch (e) {}
  // Throw to stop execution and force investigation
  throw new Error('CRITICAL: ' + msg);
}
if (typeof globalThis !== 'undefined') {
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  globalThis.__POLYCHRON_TEST__.TimingCalculator = TimingCalculator;
}
let timingCalculator = null;

/**
 * Compute MIDI-compatible meter and tempo sync factor.
 * Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure.
 * @returns {number[]} MIDI meter as [numerator, denominator].
 */
getMidiTiming = () => {
  timingCalculator = new TimingCalculator({ bpm: BPM, ppq: PPQ, meter: [numerator, denominator] });
  ({ midiMeter, midiMeterRatio, meterRatio, syncFactor, midiBPM, tpSec, tpMeasure, spMeasure } = timingCalculator);
  return midiMeter; // Return the midiMeter for testing
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 * @param {number} [tick] - MIDI tick position.
 */
setMidiTiming = (tick=measureStart) => {
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec: ${tpSec}`);
  }
  p(c,
    { tick: tick, type: 'bpm', vals: [midiBPM] },
    { tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );
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
    // Minimal safe defaults for bounded play runs
    polyNumerator = numerator;
    polyDenominator = denominator;
    polyMeterRatio = polyNumerator / polyDenominator;
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

    if (bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1)) &&
        !(numerator === polyNumerator && denominator === polyDenominator)) {
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
  measuresPerPhrase1 = 1;
  measuresPerPhrase2 = 1;
};;

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
    this.phraseStart += tpPhrase;
    this.phraseStartTime += spPhrase;
    this.tpSection += tpPhrase;
    this.spSection += spPhrase;
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
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 */
const LM = layerManager ={
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
    if (buffer instanceof CSVBuffer) {
      buf = buffer;
      state.bufferName = buffer.name;
    } else if (typeof buffer === 'string') {
      state.bufferName = buffer;
      buf = new CSVBuffer(buffer);
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
    } catch (e) {}
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
    layer.state.restoreTo(globalThis);

    // Reset lower-level indices and derived totals to avoid carry-over from previously active layer
    measureIndex = beatIndex = divIndex = subdivIndex = subsubdivIndex = 0;
    divsPerBeat = subdivsPerDiv = subsubsPerSub = undefined;

    if (isPoly) {
      numerator = polyNumerator;
      denominator = polyDenominator;
      measuresPerPhrase = measuresPerPhrase2;
    } else {
      measuresPerPhrase = measuresPerPhrase1;
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

    // Restore advanced state back to globals so they stay in sync
    layer.state.restoreTo(globalThis);
  },

};
// Export layer manager to global scope for access from other modules
globalThis.LM = LM;
// layer manager is initialized in play.js after buffers are created
// This ensures c1 and c2 are available when registering layers

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
  if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log(`setUnitTiming enter: unit=${unitType} s=${si} p=${pi} m=${mi} b=${bi}`);
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec in setUnitTiming: ${tpSec}`);
  }

  // Use globals (not layer.state) because LM.activate() already restored layer state to globals.
  // This ensures consistent timing across all unit calculations in cascading hierarchy.

  switch (unitType) {
    case 'phrase':
      if (!Number.isFinite(measuresPerPhrase) || measuresPerPhrase < 1) {
        measuresPerPhrase = 1;
      }
      tpPhrase = tpMeasure * measuresPerPhrase;
      spPhrase = tpPhrase / tpSec;
      break;

    case 'measure':
      measureStart = phraseStart + measureIndex * tpMeasure;
      measureStartTime = phraseStartTime + measureIndex * spMeasure;
      setMidiTiming();
      beatRhythm = setRhythm('beat');

      // Pre-populate beat & division caches for this measure to avoid read-before-write races
      try {
        const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
        const cache = (LM.layers[layer] && LM.layers[layer].state) ? (LM.layers[layer].state._composerCache = LM.layers[layer].state._composerCache || {}) : null;
        if (cache && composer) {
          // Populate beats for entire measure to ensure beat cache exists before 'beat' entries
          for (let bi = 0; bi < numerator; bi++) {
            const beatKey = `beat:${measureIndex}:${bi}`;
            if (!cache[beatKey]) {
              if (typeof composer.getDivisions === 'function') {
                cache[beatKey] = { divisions: m.max(1, Number(composer.getDivisions())) };
                writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: beatKey, value: cache[beatKey], note: 'prepopulate:measure' });
              }
            }
            // Now prepopulate divisions for that beat
            const divCount = cache[beatKey] && Number.isFinite(Number(cache[beatKey].divisions)) ? cache[beatKey].divisions : 1;
            for (let di = 0; di < divCount; di++) {
              const divKey = `div:${measureIndex}:${bi}:${di}`;
              if (!cache[divKey]) {
                if (typeof composer.getSubdivisions === 'function') {
                  cache[divKey] = { subdivisions: m.max(1, Number(composer.getSubdivisions())) };
                  writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: divKey, value: cache[divKey], note: 'prepopulate:measure' });
                }
              }
            }
          }
        }
      } catch (e) {}
      break;

    case 'beat':
      trackBeatRhythm();
      tpBeat = tpMeasure / numerator;
      spBeat = tpBeat / tpSec;
      trueBPM = 60 / spBeat;
      bpmRatio = BPM / trueBPM;
      bpmRatio2 = trueBPM / BPM;
      trueBPM2 = numerator * (numerator / denominator) / 4;
      bpmRatio3 = 1 / trueBPM2;
      beatStart = phraseStart + measureIndex * tpMeasure + beatIndex * tpBeat;
      beatStartTime = measureStartTime + beatIndex * spBeat;
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
            } else {
              // Fail fast and write diagnostic payload so engineers can triage root cause
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
      tpDiv = tpBeat / m.max(1, divsPerBeat);
      spDiv = tpDiv / tpSec;
      divStart = beatStart + divIndex * tpDiv;
      divStartTime = beatStartTime + divIndex * spDiv;
      // Cache subdivisions per division to avoid flapping during subdivision emission
      {
        const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
        const cache = (LM.layers[layer] && LM.layers[layer].state) ? (LM.layers[layer].state._composerCache = LM.layers[layer].state._composerCache || {}) : null;
        const divKey = `div:${measureIndex}:${beatIndex}:${divIndex}`;
        if (cache) {
          if (!cache[divKey]) {
            if (composer && typeof composer.getSubdivisions === 'function') {
              cache[divKey] = { subdivisions: m.max(1, Number(composer.getSubdivisions())) };
              writeIndexTrace({ tag: 'composer:cache:set', when: new Date().toISOString(), layer, key: divKey, value: cache[divKey] });
            } else {
              raiseCritical('getter:getSubdivisions', 'composer getter getSubdivisions missing; cannot compute subdivisions', { layer, divKey, measureIndex, beatIndex, divIndex });
            }
          } else {
            writeIndexTrace({ tag: 'composer:cache:hit', when: new Date().toISOString(), layer, key: divKey, value: cache[divKey] });
          }
          subdivsPerDiv = cache[divKey].subdivisions;
        } else {
          raiseCritical('cache:unavailable:subdivisions', 'composer cache unavailable in setUnitTiming; cannot compute subdivisions', { layer, divKey, measureIndex, beatIndex, divIndex });
        }
      }
      // Safety cap for subdivisions per division
      subdivsPerDiv = m.min(subdivsPerDiv, 8);
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      // Reset child indices at division entry to avoid carry over from previous division
      subdivIndex = 0; subsubdivIndex = 0;
      if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log(`division: divsPerBeat=${divsPerBeat} subdivsPerDiv=${subdivsPerDiv} subdivFreq=${subdivFreq}`);
      // Temporary trace for reproducer: capture composer and globals on division entry
      try {
        const _fs = require('fs'); const _path = require('path');
        const t = {
          tag: 'time:division-entry', when: new Date().toISOString(), layer: (LM && LM.activeLayer) ? LM.activeLayer : 'primary',
          sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex,
          divsPerBeat, subdivsPerDiv, numerator, meterRatio,
          // Use the clamped values in the trace to reflect the exact values used for timing
          composerDivisions: divsPerBeat,
          composerSubdivisions: subdivsPerDiv
        };
        writeIndexTrace(t);
      } catch (_e) {}
      subdivRhythm = setRhythm('subdiv');
      break;

    case 'subdivision':
      trackSubdivRhythm();
      tpSubdiv = tpDiv / m.max(1, Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : 1);
      spSubdiv = tpSubdiv / tpSec;
      subdivsPerMinute = 60 / spSubdiv;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      // Cache sub-subdivisions per subdivision to avoid flapping
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
          subsubdivsPerSub = cache[subdivKey].subsubdivs;
        } else {
          raiseCritical('cache:unavailable:subsubdivs', 'composer cache unavailable in setUnitTiming; cannot compute subsubdivs', { layer, subdivKey, measureIndex, beatIndex, divIndex, subdivIndex });
        }
      }
      // Safety cap for sub-subdivisions
      subsubdivsPerSub = m.max(1, Number(subsubdivsPerSub) || 1);
      subsubdivsPerSub = m.min(subsubdivsPerSub, 4);
      if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log(`subdivision: subdivsPerDiv=${subdivsPerDiv} subsubdivsPerSub=${subsubdivsPerSub} tpSubdiv=${tpSubdiv} spSubdiv=${spSubdiv}`);
      subsubdivRhythm = setRhythm('subsubdiv');
      break;

    case 'subsubdivision':
      trackSubsubdivRhythm();
      tpSubsubdiv = tpSubdiv / m.max(1, Number.isFinite(Number(subsubdivsPerSub)) ? Number(subsubdivsPerSub) : 1);
      spSubsubdiv = tpSubsubdiv / tpSec;
      subsubdivsPerMinute = 60 / spSubsubdiv;
      subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;
      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;
      break;

    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  // Persist a compact unit record into the layer state so writers can reference units later.
  try {
    const layerName = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
    const sec = Number.isFinite(Number(sectionIndex)) ? Number(sectionIndex) : 0;
    const phr = Number.isFinite(Number(phraseIndex)) ? Number(phraseIndex) : 0;
    const mea = Number.isFinite(Number(measureIndex)) ? Number(measureIndex) : 0;
    const bIdx = Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0;
    const divIdx = Number.isFinite(Number(divIndex)) ? Number(divIndex) : 0;
    const subdivIdx = Number.isFinite(Number(subdivIndex)) ? Number(subdivIndex) : 0;
    const subsubIdx = Number.isFinite(Number(subsubdivIndex)) ? Number(subsubdivIndex) : 0;

    const beatTotal = Number.isFinite(Number(numerator)) ? Number(numerator) : 1;
    const subdivTotal = Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : 1;
    const subsubTotal = Number.isFinite(Number(subsubdivsPerSub)) ? Number(subsubdivsPerSub) : 1;

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
        break;
      case 'beat':
        unitStart = beatStart;
        unitEnd = beatStart + tpBeat;
        break;
      case 'division':
        unitStart = divStart;
        unitEnd = divStart + tpDiv;
        break;
      case 'subdivision':
        unitStart = subdivStart;
        unitEnd = subdivStart + tpSubdiv;
        break;
      case 'subsubdivision':
        unitStart = subsubdivStart;
        unitEnd = subsubdivStart + tpSubsubdiv;
        break;
      default:
        unitStart = 0;
        unitEnd = 0;
    }


    let startSecNum = (Number.isFinite(tpSec) && tpSec !== 0) ? (unitStart / tpSec) : null;
    let endSecNum = (Number.isFinite(tpSec) && tpSec !== 0) ? (unitEnd / tpSec) : null;

    // Compute effective totals here to avoid carrying stale/default totals into the first child unit of a new parent
    const effectiveSectionTotal = Number.isFinite(Number(totalSections)) ? Number(totalSections) : 1;
    const effectivePhrasesPerSection = Number.isFinite(Number(phrasesPerSection)) ? Number(phrasesPerSection) : 1;
    const effectiveMeasuresPerPhrase = Number.isFinite(Number(measuresPerPhrase)) ? Number(measuresPerPhrase) : 1;
    const effectiveBeatTotal = Number.isFinite(Number(numerator)) ? Number(numerator) : 1;
    // Cache composer-derived counts to avoid multiple getter calls and flip-flop
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
    const _cache = (LM.layers[layer] && LM.layers[layer].state && LM.layers[layer].state._composerCache) ? LM.layers[layer].state._composerCache : null;
    const _beatKey = `beat:${measureIndex}:${beatIndex}`;
    const _divKey = `div:${measureIndex}:${beatIndex}:${divIndex}`;
    const _subdivKey = `subdiv:${measureIndex}:${beatIndex}:${divIndex}:${subdivIndex}`;

    // Diagnostic cache peek: write a short trace showing whether cache entries exist for the current keys
    writeIndexTrace({ tag: 'composer:cache:peek', when: new Date().toISOString(), layer, keys: { beat: _beatKey, div: _divKey, subdiv: _subdivKey }, cacheHas: { beat: !!(_cache && _cache[_beatKey]), div: !!(_cache && _cache[_divKey]), subdiv: !!(_cache && _cache[_subdivKey]) } });

    // Only query the cache levels that are relevant for this unitType to avoid spurious warnings
    let composerDivisionsCached;
    if (['beat','division','subdivision','subsubdivision'].includes(unitType)) {
      if (Number.isFinite(Number(divsPerBeat))) {
        composerDivisionsCached = Number(divsPerBeat);
      } else if (_cache && _cache[_beatKey] && Number.isFinite(_cache[_beatKey].divisions)) {
        composerDivisionsCached = _cache[_beatKey].divisions;
        writeIndexTrace({ tag: 'composer:cache:get', when: new Date().toISOString(), layer, key: _beatKey, value: composerDivisionsCached });
      } else {
        writeIndexTrace({ tag: 'composer:cache:miss', when: new Date().toISOString(), layer, key: _beatKey });
        // Fail fast on missing high-level beat divisions: write rich diagnostics and throw
        raiseCritical('missing:divisions', `composer divisions missing for ${_beatKey}; cannot proceed`, { layer, beatKey, measureIndex, beatIndex, unitType });
      }
    }

    let composerSubdivisionsCached;
    if (['division','subdivision','subsubdivision'].includes(unitType)) {
      if (Number.isFinite(Number(subdivsPerDiv))) {
        composerSubdivisionsCached = Number(subdivsPerDiv);
      } else if (_cache && _cache[_divKey] && Number.isFinite(_cache[_divKey].subdivisions)) {
        composerSubdivisionsCached = _cache[_divKey].subdivisions;
        writeIndexTrace({ tag: 'composer:cache:get', when: new Date().toISOString(), layer, key: _divKey, value: composerSubdivisionsCached });
      } else {
        writeIndexTrace({ tag: 'composer:cache:miss', when: new Date().toISOString(), layer, key: _divKey });
        // Fail fast on missing high-level division subdivisions: write rich diagnostics and throw
        raiseCritical('missing:subdivisions', `composer subdivisions missing for ${_divKey}; cannot proceed`, { layer, divKey, measureIndex, beatIndex, divIndex, unitType });
      }
    }

    let composerSubsubdivsCached;
    if (['subdivision','subsubdivision'].includes(unitType)) {
      if (Number.isFinite(Number(subsubdivsPerSub))) {
        composerSubsubdivsCached = Number(subsubdivsPerSub);
      } else if (_cache && _cache[_subdivKey] && Number.isFinite(_cache[_subdivKey].subsubdivs)) {
        composerSubsubdivsCached = _cache[_subdivKey].subsubdivs;
        writeIndexTrace({ tag: 'composer:cache:get', when: new Date().toISOString(), layer, key: _subdivKey, value: composerSubsubdivsCached });
      } else {
        writeIndexTrace({ tag: 'composer:cache:miss', when: new Date().toISOString(), layer, key: _subdivKey });
        warnOnce(`missing:subsubdivs:${_subdivKey}`, `composer subsubdivs missing for ${_subdivKey}; using 1 as fallback`);
        composerSubsubdivsCached = 1;
      }
    }

    const effectiveDivsPerBeat = Number.isFinite(Number(divsPerBeat)) ? Number(divsPerBeat) : (Number.isFinite(Number(composerDivisionsCached)) ? composerDivisionsCached : 1);
    const effectiveSubdivTotal = Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : (Number.isFinite(Number(composerSubdivisionsCached)) ? composerSubdivisionsCached : 1);
    const effectiveSubsubTotal = Number.isFinite(Number(subsubdivsPerSub)) ? Number(subsubdivsPerSub) : (Number.isFinite(Number(composerSubsubdivsCached)) ? composerSubsubdivsCached : 1);

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
      startTick: Math.round(unitStart),
      endTick: Math.round(unitEnd),
      // Persist seconds-based start/end time when tpSec available (null otherwise)
      startTime: Number.isFinite(startSecNum) ? Number(startSecNum.toFixed(6)) : null,
      endTime: Number.isFinite(endSecNum) ? Number(endSecNum.toFixed(6)) : null
    };


    if (LM && LM.layers && LM.layers[layerName]) {
      LM.layers[layerName].state.units = LM.layers[layerName].state.units || [];
      LM.layers[layerName].state.units.push(unitRec);
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
    } catch (e) {}

    // Build a compact full-id string per spec and emit an internal marker for writers to extract
    // Use sanitized (clamped) lower-level indices when those levels are not yet set to avoid using stale values
    const parts = [];
    parts.push(layerName);
    parts.push(`section${sec + 1}/${effectiveSectionTotal}`);
    parts.push(`phrase${(phr + 1)}/${effectivePhrasesPerSection}`);
    parts.push(`measure${(comp_mea + 1)}/${effectiveMeasuresPerPhrase}`);
    // Coerce effective totals to safe numeric values to avoid NaN/undefined in IDs
    const effBeatTotal = Number.isFinite(Number(effectiveBeatTotal)) ? Number(effectiveBeatTotal) : 1;
    const effDivsPerBeat = Number.isFinite(Number(effectiveDivsPerBeat)) ? Number(effectiveDivsPerBeat) : 1;
    const effSubdivTotal = Number.isFinite(Number(effectiveSubdivTotal)) ? Number(effectiveSubdivTotal) : 1;
    const effSubsubTotal = Number.isFinite(Number(effectiveSubsubTotal)) ? Number(effectiveSubsubTotal) : 1;
    // Sanitize indices: clamp to valid ranges so we never emit index > total
    const s_bIdx = Number.isFinite(bIdx) ? Math.max(0, Math.min(bIdx, Math.max(0, Number(effBeatTotal) - 1))) : 0;
    const s_subdivIdx = Number.isFinite(subdivIdx) ? Math.max(0, Math.min(subdivIdx, Math.max(0, Number(effSubdivTotal) - 1))) : 0;
    const s_subsubIdx = Number.isFinite(subsubIdx) ? Math.max(0, Math.min(subsubIdx, Math.max(0, Number(effSubsubTotal) - 1))) : 0;
    parts.push(`beat${(s_bIdx + 1)}/${effBeatTotal}`);
    // Include division in canonical key to remove ambiguity across varying subdivision totals per division
    const s_divIdx = Number.isFinite(divIdx) ? Math.max(0, Math.min(divIdx, Math.max(0, Number(effDivsPerBeat) - 1))) : 0;
    parts.push(`division${(s_divIdx + 1)}/${effDivsPerBeat}`);
    parts.push(`subdivision${(s_subdivIdx + 1)}/${effSubdivTotal}`);
    parts.push(`subsubdivision${(s_subsubIdx + 1)}/${effSubsubTotal}`);
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
            } else if (tickStart !== null && tickEnd !== null) {
              if (!map[key] || (!map[key].startSec && tickStart < (map[key].tickStart || Infinity))) map[key] = { startSec: null, endSec: null, tickStart, tickEnd, raw: full };
            }
          }
        }
      } catch (e) {}
      cache[layerName] = map; return map;
    };

    const findMarkerSecs = (layerName, partsArr) => {
      const map = getCsvForLayer(layerName);
      // try most-specific to least-specific
      for (let len = partsArr.length; len > 0; len--) {
        const k = partsArr.slice(0, len).join('|');
        if (map && map[k] && Number.isFinite(map[k].startSec)) return map[k];
      }
      return null;
    };

    const markerMatch = findMarkerSecs(layerName, parts);
    let secs = null;
    if (markerMatch && Number.isFinite(markerMatch.startSec) && Number.isFinite(markerMatch.endSec)) {
      secs = `${markerMatch.startSec.toFixed(6)}-${markerMatch.endSec.toFixed(6)}`;
      // also override startSecNum/endSecNum for downstream use
      if (Number.isFinite(markerMatch.startSec)) startSecNum = markerMatch.startSec;
      if (Number.isFinite(markerMatch.endSec)) endSecNum = markerMatch.endSec;

      // Update previously-pushed unitRec (and local unitRec variable) to reflect marker-derived seconds
      try {
        if (typeof unitRec !== 'undefined') {
          unitRec.startTime = Number.isFinite(startSecNum) ? Number(startSecNum.toFixed(6)) : null;
          unitRec.endTime = Number.isFinite(endSecNum) ? Number(endSecNum.toFixed(6)) : null;
        }
        if (LM && LM.layers && LM.layers[layerName] && Array.isArray(LM.layers[layerName].state.units)) {
          const uarr = LM.layers[layerName].state.units;
          const last = uarr[uarr.length - 1];
          if (last && last.unitType === unitType && last.startTick === Math.round(unitStart) && last.endTick === Math.round(unitEnd)) {
            last.startTime = unitRec.startTime;
            last.endTime = unitRec.endTime;
          }
        }
      } catch (_e) {}

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
              numerator, denominator, measuresPerPhrase, divsPerBeat, subdivsPerDiv, subsubdivsPerSub
            };
            const recentUnits = (() => { try { if (LM && LM.layers && LM.layers[LM.activeLayer] && Array.isArray(LM.layers[LM.activeLayer].state.units)) { return LM.layers[LM.activeLayer].state.units.slice(Math.max(0, LM.layers[LM.activeLayer].state.units.length - 10)); } } catch (_e) {} return null; })();
            const hit = { when: new Date().toISOString(), target, parentPrefix, fullId, unitRec, globals: globalsSnapshot, recentUnits, stack: (new Error()).stack.split('\n').slice(2).map(s => s.trim()) };
            try { writeDebugFile(`repro-parent-hit-${safe}.ndjson`, hit); } catch (_e) {}
          }
        } catch (_e) {}
      }
      // Temporary trace: record timing snapshot immediately before anomaly checks
      writeIndexTrace({ tag: 'time:pre-anomaly', when: new Date().toISOString(), layer: (LM && LM.activeLayer) ? LM.activeLayer : 'primary', sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, subsubdivIndex, numerator, divsPerBeat, subdivsPerDiv, subsubdivsPerSub, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv, tpSec });
      const anomalies = [];
      // Only flag strict greater-than (not loop-exit equality) to reduce transient noise
      // Only compare indices that are relevant to the current unitType to avoid spurious child-index carry-over reports
      const divTotal = Number.isFinite(Number(divsPerBeat)) ? Number(divsPerBeat) : 1;
      if (unitType === 'beat' && bIdx > beatTotal) anomalies.push({ field: 'beat', idx: bIdx, total: beatTotal });
      if (unitType === 'division' && divIdx > divTotal) anomalies.push({ field: 'division', idx: divIdx, total: divTotal });
      if (unitType === 'subdivision' && subdivIdx > subdivTotal) anomalies.push({ field: 'subdivision', idx: subdivIdx, total: subdivTotal });
      if (unitType === 'subsubdivision' && subsubIdx > subsubTotal) anomalies.push({ field: 'subsubdivision', idx: subsubIdx, total: subsubTotal });
      if (anomalies.length) {
        try {
          // Critical log for index anomalies (do NOT normalize here; just warn)
          console.error(`CRITICAL: unit index anomaly - ${layerName} ${unitType} ${fullId} ${JSON.stringify(anomalies)}`);
          try { writeDebugFile('unitIndex-anomalies.ndjson', { layer: layerName, unitType, unitId: fullId, anomalies, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea, beatIndex: bIdx, divIndex: divIdx, subdivIndex: subdivIdx, subsubIndex: subsubIdx }, when: new Date().toISOString() }); } catch (_e) {}

          // Enriched diagnostic payload for deep inspection
          try {
            const composerInfo = (typeof composer !== 'undefined' && composer) ? {
              meter: (typeof composer.getMeter === 'function' ? composer.getMeter() : null),
              divisions: (typeof composer.getDivisions === 'function' ? composer.getDivisions() : null),
              subdivisions: (typeof composer.getSubdivisions === 'function' ? composer.getSubdivisions() : null),
              subsubdivs: (typeof composer.getSubsubdivs === 'function' ? composer.getSubsubdivs() : null)
            } : null;

            const globalsSnapshot = {
              phraseStart, phraseStartTime, measureStart, measureStartTime, sectionStart, sectionStartTime,
              tpPhrase, tpMeasure, tpSection, tpSec, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv,
              numerator, denominator, measuresPerPhrase, divsPerBeat, subdivsPerDiv, subsubdivsPerSub
            };

            const recentUnits = (() => {
              try {
                if (LM && LM.layers && LM.layers[layerName] && Array.isArray(LM.layers[layerName].state.units)) {
                  const u = LM.layers[layerName].state.units;
                  return u.slice(Math.max(0, u.length - 6));
                }
              } catch (_e) {}
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

            try { writeDebugFile('unitIndex-anomalies-rich.ndjson', rich); } catch (_e) {}
            // If the ASSERT gate is enabled, write a fatal diagnostic and throw so tests fail fast (helps CI detect regressions)
            try {
              if (process.env.INDEX_TRACES_ASSERT) {
                try { const _fs2 = require('fs'); const _path2 = require('path'); _fs2.appendFileSync(_path2.join(process.cwd(), 'output', 'unitIndex-anomalies-fatal.ndjson'), JSON.stringify(Object.assign({ note: 'INDEX_TRACES_ASSERT' }, rich)) + '\n'); } catch (_e2) {}
                throw new Error('unit index anomaly (INDEX_TRACES_ASSERT) - ' + JSON.stringify(anomalies));
              }
            } catch (_e) {}
          } catch (_e) {}

        } catch (_e) {}
      }
    } catch (_e) {}

    // Diagnostic: record suspicious unit emissions (start==0 with non-zero end, non-finite, or start>end)
    try {
      const suspicious = !Number.isFinite(unitStart) || !Number.isFinite(unitEnd) || (unitStart === 0 && unitEnd !== 0) || (unitStart > unitEnd);
      if (suspicious) {
        // Build a rich diagnostic payload with timing snapshot and stack
        const globalsSnapshot = {
          phraseStart, phraseStartTime, measureStart, measureStartTime, sectionStart, sectionStartTime,
          tpPhrase, tpMeasure, tpSection, tpSec, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv,
          numerator, denominator, measuresPerPhrase, divsPerBeat, subdivsPerDiv, subsubdivsPerSub
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
          try { writeDebugFile('unitTreeAudit-diagnostics.ndjson', diag); } catch (_e) {}
          // Keep legacy short list for quick inspection
          try { writeDebugFile('unitTreeAudit-suspicious-units.ndjson', { layer: layerName, unitType, unitId: fullId, start: Math.round(unitStart), end: Math.round(unitEnd), when: diag.when }); } catch (_e) {}
        } catch (_e) {}
      }
    } catch (_e) {}

    try {
      // Diagnostic: record overlong unit emissions that exceed a measure (likely root of overlaps)
      try {
        const dur = Math.round(unitEnd - unitStart);
        const measureDur = Number.isFinite(tpMeasure) ? Math.round(tpMeasure) : null;
        if (dur > 0 && measureDur !== null && dur > Math.max(1, measureDur) * 1.5) {
          const _fs = require('fs'); const _path = require('path');
          const diag = {
            tag: 'overlong-unit', when: new Date().toISOString(), layer: layerName, unitType, fullId, startTick: Math.round(unitStart), endTick: Math.round(unitEnd), duration: dur, tpMeasure: measureDur, tpBeat, tpDiv, tpSubdiv, tpSubsubdiv, indices: { sectionIndex: sec, phraseIndex: phr, measureIndex: mea, beatIndex: bIdx, divIndex: divIdx, subdivIndex: subdivIdx, subsubIndex: subsubIdx }, parts: parts.slice(), composer: (typeof composer !== 'undefined' && composer) ? { divisions: (typeof composer.getDivisions === 'function' ? composer.getDivisions() : null), subdivisions: (typeof composer.getSubdivisions === 'function' ? composer.getSubdivisions() : null), subsubdivs: (typeof composer.getSubsubdivs === 'function' ? composer.getSubsubdivs() : null) } : null, stack: (new Error()).stack.split('\n').slice(2).map(s => s.trim()) };
          try { writeDebugFile('overlong-units.ndjson', diag); } catch (e) {}
          // If assert gating is enabled, write fatal diag and throw to fail fast
          if (process.env.INDEX_TRACES_ASSERT) {
            try { _fs.appendFileSync(_path.join(process.cwd(), 'output', 'unitIndex-anomalies-fatal.ndjson'), JSON.stringify(Object.assign({ note: 'OVERLONG_UNIT_ASSERT' }, diag)) + '\n'); } catch (e) {}
            throw new Error('overlong unit detected');
          }
        }
      } catch (_e) {}

      // Add to live master unit map (tick-first canonical aggregator) using the canonical part key
      try { const MasterMap = require('./masterMap'); MasterMap.addUnit({ parts: parts.slice(), layer: layerName, startTick: Math.round(unitStart), endTick: Math.round(unitEnd), startTime: startSecNum, endTime: endSecNum, raw: unitRec }); } catch (_e) {}
      p(c, { tick: Math.round(unitStart), type: 'marker_t', vals: [`unitRec:${fullId}`], _internal: true });
    } catch (_e) { if (globalThis.__POLYCHRON_TEST__?.enableLogging) console.log('[setUnitTiming] error emitting marker to buffer', _e && _e.stack ? _e.stack : _e); }
} catch (_e) {}

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
    // Expose lightweight test hook
    if (globalThis && globalThis.__POLYCHRON_TEST__) globalThis.__POLYCHRON_TEST__._markerCache = globalThis.__POLYCHRON_TEST__._markerCache || {}, globalThis.__POLYCHRON_TEST__._markerCache[layerName] = { mtime, keys: Object.keys(map) };
    return map;
  } catch (e) {
    _markerCache[layerName] = { mtime: null, map: {} };
    return {};
  }
};

const findMarkerSecs = (layerName, partsArr) => {
  const map = loadMarkerMapForLayer(layerName);
  if (!map) return null;
  for (let len = partsArr.length; len > 0; len--) {
    const k = partsArr.slice(0, len).join('|');
    if (map[k] && Number.isFinite(map[k].startSec)) return map[k];
  }
  for (let len = partsArr.length; len > 0; len--) {
    const k = partsArr.slice(0, len).join('|');
    if (map[k] && (Number.isFinite(map[k].tickStart) && Number.isFinite(map[k].tickEnd))) return map[k];
  }
  return null;
};

// Export small test helpers
if (typeof globalThis !== 'undefined') {
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  globalThis.__POLYCHRON_TEST__.loadMarkerMapForLayer = loadMarkerMapForLayer;
  globalThis.__POLYCHRON_TEST__.findMarkerSecs = findMarkerSecs;
}

// Export for tests and __POLYCHRON_TEST__ namespace usage
if (typeof globalThis !== 'undefined') {
  globalThis.TimingCalculator = TimingCalculator;
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  globalThis.__POLYCHRON_TEST__.TimingCalculator = TimingCalculator;
}
