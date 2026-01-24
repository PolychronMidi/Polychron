// time.js - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

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
    LM.layers[name] = { buffer: buf, state };
    state.buffer = buf;
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
      divsPerBeat = composer ? composer.getDivisions() : 1;
      divRhythm = setRhythm('div');
      break;

    case 'division':
      trackDivRhythm();
      tpDiv = tpBeat / m.max(1, divsPerBeat);
      spDiv = tpDiv / tpSec;
      divStart = beatStart + divIndex * tpDiv;
      divStartTime = beatStartTime + divIndex * spDiv;
      subdivsPerDiv = m.max(1, composer ? composer.getSubdivisions() : 1);
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      subdivRhythm = setRhythm('subdiv');
      break;

    case 'subdivision':
      trackSubdivRhythm();
      tpSubdiv = tpDiv / m.max(1, subdivsPerDiv);
      spSubdiv = tpSubdiv / tpSec;
      subdivsPerMinute = 60 / spSubdiv;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubdivsPerSub = composer ? composer.getSubsubdivs() : 1;
      subsubdivRhythm = setRhythm('subsubdiv');
      break;

    case 'subsubdivision':
      trackSubsubdivRhythm();
      tpSubsubdiv = tpSubdiv / m.max(1, subsubdivsPerSub);
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

    const startSecNum = (Number.isFinite(tpSec) && tpSec !== 0) ? (unitStart / tpSec) : null;
    const endSecNum = (Number.isFinite(tpSec) && tpSec !== 0) ? (unitEnd / tpSec) : null;

    const unitRec = {
      layer: layerName,
      unitType,
      sectionIndex: sec,
      phraseIndex: phr,
      measureIndex: mea,
      beatIndex: bIdx,
      beatTotal,
      divIndex: divIdx,
      subdivIndex: subdivIdx,
      subdivTotal,
      subsubIndex: subsubIdx,
      subsubTotal,
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



    // Build a compact full-id string per spec and emit an internal marker for writers to extract
    const parts = [];
    parts.push(layerName);
    parts.push(`section${sec + 1}`);
    parts.push(`phrase${phr + 1}`);
    parts.push(`measure${mea + 1}`);
    parts.push(`beat${(bIdx + 1)}/${beatTotal}`);
    parts.push(`subdivision${(subdivIdx + 1)}/${subdivTotal}`);
    parts.push(`subsubdivision${(subsubIdx + 1)}/${subsubTotal}`);
    const range = `${Math.round(unitStart)}-${Math.round(unitEnd)}`;
    const secs = (Number.isFinite(tpSec) && tpSec !== 0) ? `${(unitStart / tpSec).toFixed(6)}-${(unitEnd / tpSec).toFixed(6)}` : null;
    const fullId = secs ? (parts.join('|') + '|' + range + '|' + secs) : (parts.join('|') + '|' + range);

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
          _fs.appendFileSync(_path.join(process.cwd(), 'output', 'unitTreeAudit-diagnostics.ndjson'), JSON.stringify(diag) + '\n');
          // Keep legacy short list for quick inspection
          try { _fs.appendFileSync(_path.join(process.cwd(), 'output', 'unitTreeAudit-suspicious-units.ndjson'), JSON.stringify({ layer: layerName, unitType, unitId: fullId, start: Math.round(unitStart), end: Math.round(unitEnd), when: diag.when }) + '\n'); } catch (_e) {}
        } catch (_e) {}
      }
    } catch (_e) {}

    try {
      // Add to live master unit map (tick-first canonical aggregator) using the canonical part key
      try { const MasterMap = require('./masterMap'); MasterMap.addUnit({ parts: parts.slice(), layer: layerName, startTick: Math.round(unitStart), endTick: Math.round(unitEnd), startTime: startSecNum, endTime: endSecNum, raw: unitRec }); } catch (_e) {}
      p(c, { tick: Math.round(unitStart), type: 'marker_t', vals: [`unitRec:${fullId}`], _internal: true });
    } catch (_e) {}
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

// Export for tests and __POLYCHRON_TEST__ namespace usage
if (typeof globalThis !== 'undefined') {
  globalThis.TimingCalculator = TimingCalculator;
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  globalThis.__POLYCHRON_TEST__.TimingCalculator = TimingCalculator;
}
