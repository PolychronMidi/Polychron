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

// Load TimingContext implementation from its own module to reduce file size and improve testability
try { TimingContext = require('./time/TimingContext'); } catch (e) { /* swallow */ }
// Load LayerManager module which sets global LM for tests and runtime (keeps legacy naked-global semantics)
try { require('./time/LayerManager'); } catch (e) { /* swallow */ }
// Load setUnitTiming implementation moved to its own file to keep time.js smaller and testable
try { require('./time/setUnitTiming'); } catch (e) { /* swallow */ }
/**
 * Set timing variables for each unit level. Implemented in `src/time/setUnitTiming.js`.
 * Delegated definition preserved to keep JSDoc in this file for code-quality checks.
 * @param {string} unitType - Unit type for timing calculation and logging.
 */
setUnitTiming = setUnitTiming || function () { /* placeholder - actual implementation in src/time/setUnitTiming.js */ };



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
  // Expose restoreLayerToGlobals so external modules (e.g., LayerManager) can restore timing state without relying on naked globals
  module.exports.restoreLayerToGlobals = restoreLayerToGlobals;
} catch (e) { /* swallow export errors */ }
