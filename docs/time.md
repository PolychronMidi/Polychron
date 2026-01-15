# **time.js** ([code](../src/time.js)) ([doc](time.md)) - Timing Engine and Temporal Management System

> **Source**: `src/time.js`
> **Status**: Core Module - Timing & Meter Spoofing
> **Dependencies**: **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md)) ([code](../src/backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)))) ([doc](backstage.md)), **writer.js** ([code](../src/writer.js)) ([doc](writer.md)) ([code](../src/writer.js ([code](../src/writer.js)) ([doc](writer.md)))) ([doc](writer.md))

## Overview

****time.js** ([code](../src/time.js)) ([doc](time.md))** ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)) is the **temporal engine** of Polychron, handling all timing calculations, meter management, and the revolutionary "meter spoofing" technology that enables **any time signature** to work within MIDI constraints.

**Core Capabilities:**
- **Meter spoofing** - Converts non-power-of-2 time signatures (7/11, 420/69, etc.) to MIDI-compatible equivalents
- **Polyrhythm calculation** - Finds optimal measure alignments between different meters
- **Hierarchical timing** - Precise calculations across 7 nested levels: section → phrase → measure → beat → division → subdivision → subsubdivision
- **Dual-layer context management** - LayerManager (LM) enables independent polyrhythmic layers with synchronized time
- **MIDI timing events** - Generates tempo and meter change events via **writer.js** ([code](../src/writer.js)) ([doc](writer.md))

## Architecture Role

****time.js** ([code](../src/time.js)) ([doc](time.md))** ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)) serves as the **timing coordinator**:
- ****play.js** ([code](../src/play.js)) ([doc](play.md))** ([code](../src/play.js ([code](../src/play.js)) ([doc](play.md)))) ([doc](play.md)) - Calls setUnitTiming() at each hierarchy level and drives phrase/section advancement via LM
- ****composers.js** ([code](../src/composers.js)) ([doc](composers.md))** ([code](../src/composers.js ([code](../src/composers.js)) ([doc](composers.md)))) ([doc](composers.md)) - Provides division/subdivision counts that determine timing granularity
- ****writer.js** ([code](../src/writer.js)) ([doc](writer.md))** ([code](../src/writer.js ([code](../src/writer.js)) ([doc](writer.md)))) ([doc](writer.md)) - Receives MIDI timing events (tempo, meter) via setMidiTiming()
- ****backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md))** ([code](../src/backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)))) ([doc](backstage.md)) - Mathematical utility support (pow, log, ceil, floor)
## Unit Timing: `setUnitTiming()`

Calculates absolute positions for each hierarchy level using cascading parent position + index × duration.

<!-- BEGIN: snippet:Time_setUnitTiming -->

```javascript
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

  // Log the unit after calculating timing
  logUnit(unitType);
};
```

<!-- END: snippet:Time_setUnitTiming -->

---

## Layer Manager (LM) API

The LayerManager coordinates per-layer timing contexts and buffer switching.

### `LM.register(name, buffer, initialState, setupFn)`
<!-- BEGIN: snippet:LM_register -->

```javascript
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
```

<!-- END: snippet:LM_register -->

### `LM.activate(name, isPoly)`
<!-- BEGIN: snippet:LM_activate -->

```javascript
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
```

<!-- END: snippet:LM_activate -->

### `LM.advance(name, advancementType)`
<!-- BEGIN: snippet:LM_advance -->

```javascript
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
```

<!-- END: snippet:LM_advance -->

---

## Meter Spoofing: `getMidiTiming()`

### The Problem
MIDI supports only time signatures where the denominator is a power of 2 (2, 4, 8, 16, 32). Complex meters like 7/11 or 5/7 cannot be directly expressed in MIDI format, causing composition to fail.

### The Solution
**Meter spoofing** finds the nearest power-of-2 denominator while calculating a **sync factor** to preserve the original meter's musical feel:

<!-- BEGIN: snippet:TimingCalculator -->

```javascript
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

```

<!-- END: snippet:TimingCalculator -->

### Algorithm
1. **Check if already MIDI-compatible** - If denominator is a power of 2, use directly
2. **Find bracket** - Locate the nearest higher and lower powers of 2
3. **Compare ratios** - Calculate how far each option deviates from the original meter ratio
4. **Choose closer match** - Select the power-of-2 that minimizes distortion
5. **Calculate sync factor** - Ratio between MIDI meter and actual meter (enables tempo scaling)
6. **Set MIDI values** - Compute ticks-per-second, ticks-per-measure, seconds-per-measure

### Example: 7/11 Time
- **Original ratio**: 7 ÷ 11 = 0.636
- **Next higher power of 2**: 16 (7/16 = 0.4375)
- **Next lower power of 2**: 8 (7/8 = 0.875)
- **Higher deviation**: |0.636 - 0.4375| = 0.1985
- **Lower deviation**: |0.636 - 0.875| = 0.239
- **Choose**: 7/16 (closer match)
- **Sync factor**: (7/16) ÷ (7/11) ≈ 1.3125
- **Adjusted BPM**: 120 × 1.3125 = 157.5

---

## Polyrhythm Discovery: `getPolyrhythm()`

### Purpose
Finds the **optimal measure alignment** between primary and poly layers so they synchronize in time despite different meters.

```javascript
getPolyrhythm = () => {
  if (!composer) return;
  while (true) {
    [polyNumerator, polyDenominator] = composer.getMeter(true, true);
    polyMeterRatio = polyNumerator / polyDenominator;
    let bestMatch = {
      primaryMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity,
      polyNumerator: polyNumerator,
      polyDenominator: polyDenominator
    };

    // Search for measure counts that align both layers
    for (let primaryMeasures = 1; primaryMeasures < 7; primaryMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
        // Check if duration matches (within floating-point epsilon)
        if (m.abs(primaryMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
          let currentMatch = {
            primaryMeasures: primaryMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: primaryMeasures + polyMeasures,
            polyNumerator: polyNumerator,
            polyDenominator: polyDenominator
          };
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }

    // Accept match if it meets constraints
    if (bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1)) &&
        !(numerator === polyNumerator && denominator === polyDenominator)) {
      measuresPerPhrase1 = bestMatch.primaryMeasures;
      measuresPerPhrase2 = bestMatch.polyMeasures;
      return;
    }
  }
};
```

### Algorithm
1. **Get poly meter** - Request new meter from composer
2. **Calculate poly ratio** - polyNumerator ÷ polyDenominator
3. **Search measure combinations** - Try all combinations (1-6 measures each)
4. **Test duration equality** - Do N primary measures equal M poly measures in time?
5. **Find shortest** - Choose the combination with smallest total measure count
6. **Set phrase structure** - measuresPerPhrase1 (primary), measuresPerPhrase2 (poly)

### Example: 4/4 vs 3/4 Polyrhythm
- **4/4 ratio**: 1.0, **3/4 ratio**: 0.75
- **Test 1**: 1 × 1.0 = 1.0 vs 1 × 0.75 = 0.75 → No match
- **Test 2**: 2 × 1.0 = 2.0 vs 3 × 0.75 = 2.25 → No match
- **Test 3**: 3 × 1.0 = 3.0 vs 4 × 0.75 = 3.0 → **Match!**
- **Result**: 3 primary measures = 4 poly measures in time

---

## Hierarchical Timing: `setUnitTiming()`

### Purpose
Central function called at each level of the timing hierarchy. Calculates absolute tick and time positions for every note by cascading parent positions through each nested level.

### Called From
**play.js** ([code](../src/play.js)) ([doc](play.md)) nested loops at each hierarchy level:
```javascript
for (sectionIndex = 0; ...)
  LM.activate(layer)
  setUnitTiming('phrase')
  for (phraseIndex = 0; ...)
    for (measureIndex = 0; ...)
      setUnitTiming('measure')
      for (beatIndex = 0; ...)
        setUnitTiming('beat')
        for (divIndex = 0; ...)
          setUnitTiming('division')
          for (subdivIndex = 0; ...)
            setUnitTiming('subdivision')
            for (subsubdivIndex = 0; ...)
              setUnitTiming('subsubdivision')
              playNotes()  // Uses subsubdivStart
```

### Implementation
```javascript
setUnitTiming = (unitType) => {
  if (!Number.isFinite(tpSec) || tpSec <= 0) {
    throw new Error(`Invalid tpSec in setUnitTiming: ${tpSec}`);
  }

  switch (unitType) {
    case 'phrase':
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
      subdivRhythm = setRhythm('subdiv');
      break;

    case 'subdivision':
      trackSubdivRhythm();
      tpSubdiv = tpDiv / m.max(1, subdivsPerDiv);
      spSubdiv = tpSubdiv / tpSec;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubdivsPerSub = composer ? composer.getSubsubdivs() : 1;
      subsubdivRhythm = setRhythm('subsubdiv');
      break;

    case 'subsubdivision':
      trackSubsubdivRhythm();
      tpSubsubdiv = tpSubdiv / m.max(1, subsubdivsPerSub);
      spSubsubdiv = tpSubsubdiv / tpSec;
      subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;
      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;
      break;

    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  logUnit(unitType);
};
```

### Cascading Position Pattern
Each level computes absolute position as: **parent_start + current_index × duration**

| Level | Formula | Example |
|-------|---------|---------|
| **Phrase** | `tpMeasure × measuresPerPhrase` | 480 × 4 = 1920 ticks |
| **Measure** | `phraseStart + measureIndex × tpMeasure` | 0 + 1 × 480 = 480 |
| **Beat** | `phraseStart + measureIndex × tpMeasure + beatIndex × tpBeat` | 0 + 0 × 480 + 2 × 120 = 240 |
| **Division** | `beatStart + divIndex × tpDiv` | 240 + 3 × 30 = 330 |
| **Subdivision** | `divStart + subdivIndex × tpSubdiv` | 330 + 1 × 10 = 340 |
| **Subsubdivision** | `subdivStart + subsubdivIndex × tpSubsubdiv` | 340 + 2 × 2 = 344 |

### Why This Matters
- **Precision**: Every note has an absolute, unambiguous tick position
- **Synchronization**: Both layers have identical `spPhrase` (seconds), so phrase boundaries align
- **Efficiency**: Calculations are simple arithmetic; no complex state tracking
- **Cascading**: Small errors don't accumulate because each level recalculates from absolute parent position

### Polyrhythm Example
**4/4 Primary Layer:**
- `tpMeasure = 480`, `measuresPerPhrase = 3`
- Phrase duration: 480 × 3 = 1440 ticks

**3/4 Poly Layer:**
- `tpMeasure = 360`, `measuresPerPhrase = 4`
- Phrase duration: 360 × 4 = 1440 ticks (same!)

Both layers reach end of phrase at identical absolute time despite different tick counts per measure.

---

## Timing State: `TimingContext` Class

### Purpose
Encapsulates all timing variables for a layer so they can be saved/restored without manual property copying.

### Storage
```javascript
TimingContext = class TimingContext {
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

  saveFrom(globals) { /* Copies properties from globals object to this */ }
  restoreTo(globals) { /* Copies properties from this to globals object */ }

  advancePhrase(tpPhrase, spPhrase) {
    this.phraseStart += tpPhrase;
    this.phraseStartTime += spPhrase;
    this.tpSection += tpPhrase;
    this.spSection += spPhrase;
  }

  advanceSection() {
    this.sectionStart += this.tpSection;
    this.sectionStartTime += this.spSection;
    this.sectionEnd += this.tpSection;
    this.tpSection = 0;
    this.spSection = 0;
  }
};
```

### Key Methods
- **`saveFrom(globals)`** - Copies timing variables FROM globals TO this object
- **`restoreTo(globals)`** - Copies timing variables FROM this object TO globals
- **`advancePhrase(tpPhrase, spPhrase)`** - Move phrase start forward by tpPhrase ticks and spPhrase seconds
- **`advanceSection()`** - Move section boundaries forward using accumulated tpSection/spSection

---

## Layer Context Management: `LayerManager` (LM)

### Purpose
Manages multiple timing contexts so different layers can have different meters but stay synchronized in absolute time.

### Architecture Pattern
```
1. register(layer_name, buffer)  → Create TimingContext for layer
2. activate(layer_name)          → Restore layer's timing to globals
3. [...composition code...]       → Uses globals (which are layer-specific)
4. advance(layer_name)           → Save globals back to layer's TimingContext
```

### Core Methods

#### `LM.register(name, buffer, initialState, setupFn)`
Creates a new layer:
```javascript
const { state: primary, buffer: c1 } = LM.register('primary', c1, {}, setupFn);
```

- **Parameters**:
  - `name` - Layer identifier (string)
  - `buffer` - CSVBuffer instance, array, or string (creates CSVBuffer if string)
  - `initialState` - Optional state overrides
  - `setupFn` - Optional initialization function to run with this layer's buffer

- **Returns**: `{ state: TimingContext, buffer: CSVBuffer|Array }`

- **Process**:
  1. Create new TimingContext
  2. Resolve buffer (if string, create CSVBuffer; if CSVBuffer, use directly; if array, use as-is)
  3. Store layer in `LM.layers[name] = { buffer, state }`
  4. Call setupFn if provided (with c temporarily set to this layer's buffer)
  5. Return both state and buffer for convenient destructuring

#### `LM.activate(name, isPoly)`
Switch to a layer's timing context:
```javascript
LM.activate('primary', false);
// Now all timing globals are from primary layer
setUnitTiming('measure');  // Uses primary layer's tpMeasure
```

- **Parameters**:
  - `name` - Layer to activate
  - `isPoly` - If true, use poly meter and measuresPerPhrase2; if false, use primary meter and measuresPerPhrase1

- **Process**:
  1. Set `c = layer.buffer` (switch active buffer)
  2. Set `LM.activeLayer = name`
  3. Store current meter into layer state
  4. Call `layer.state.restoreTo(globalThis)` - restore all timing variables from this layer
  5. Recalculate `spPhrase` and `tpPhrase` based on active meter
  6. Return snapshot of key timing values

- **Result**: All global timing variables now reflect this layer's state

#### `LM.advance(name, advancementType)`
Advance a layer's timing and save state:
```javascript
LM.advance('primary', 'phrase');  // Advance to next phrase
```

- **Parameters**:
  - `name` - Layer to advance
  - `advancementType` - 'phrase' or 'section'

- **Process**:
  1. Set `c = layer.buffer` (switch to this layer's buffer)
  2. Reset rhythm counters (beatRhythm, divRhythm, etc.)
  3. Call `layer.state.saveFrom(globals)` - save current timing to layer state
  4. Call appropriate advancement method:
     - 'phrase': `layer.state.advancePhrase(tpPhrase, spPhrase)`
     - 'section': `layer.state.advanceSection()`
  5. Call `layer.state.restoreTo(globalThis)` - restore advanced state back to globals

- **Result**: Layer state updated with new phrase/section boundaries

### Usage Pattern in **play.js** ([code](../src/play.js)) ([doc](play.md))

```javascript
// Dual-layer composition
for (sectionIndex = 0; sectionIndex < sections; sectionIndex++) {
  for (phraseIndex = 0; phraseIndex < measuresPerPhrase1; phraseIndex++) {

    // PRIMARY LAYER
    LM.activate('primary', false);
    setUnitTiming('phrase');
    for (measureIndex = 0; ...)
      setUnitTiming('measure');
      for (beatIndex = 0; ...)
        setUnitTiming('beat');
        playNotes();  // Primary notes on primary layer buffer
    LM.advance('primary', 'phrase');

    // POLY LAYER
    LM.activate('poly', true);
    setUnitTiming('phrase');
    for (measureIndex = 0; ...)
      setUnitTiming('measure');
      for (beatIndex = 0; ...)
        setUnitTiming('beat');
        playNotes();  // Poly notes on poly layer buffer
    LM.advance('poly', 'phrase');
  }
  LM.advance('primary', 'section');
  LM.advance('poly', 'section');
}
```

### Why This Works
- **Isolation**: Each layer maintains its own timing state
- **Switch speed**: `activate()` restores a layer's state in O(1)
- **Synchronization**: Both layers have identical `spPhrase` (absolute time), ensuring alignment
- **Scalability**: Add 3rd, 4th layers with `LM.register('tertiary', ...)` - no changes needed

---

## Supporting Functions

### `setMidiTiming(tick)`
Writes MIDI timing events (tempo and meter changes) to the active buffer:
```javascript
setMidiTiming = (tick=measureStart) => {
  p(c,
    { tick: tick, type: 'bpm', vals: [midiBPM] },
    { tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );
};
```
- Writes at the start of each measure
- Uses `midiBPM` (adjusted for meter spoofing)
- Uses `midiMeter` (spoofed to power-of-2 denominator)

### `formatTime(seconds)`
Converts seconds to human-readable MM:SS.ssss format:
```javascript
formatTime = (seconds) => {
  const minutes = m.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};
```

### `logUnit(type)`
Generates CSV marker events for debugging/visualization if LOG setting allows:
- Controlled by LOG environment variable ('none', 'all', or comma-separated unit types)
- Creates MIDI text events with timing info
- Useful for analyzing composition in MIDI viewer

---

## Quick Reference

| Variable | Type | Purpose |
|----------|------|---------|
| `tpSec` | number | MIDI ticks per second (tempo-dependent) |
| `tpMeasure` | number | MIDI ticks per measure (meter-dependent) |
| `tpPhrase` | number | MIDI ticks per phrase |
| `spMeasure` | number | Seconds per measure (actual time) |
| `spPhrase` | number | Seconds per phrase (synchronized across layers) |
| `meterRatio` | number | Original numerator ÷ denominator |
| `syncFactor` | number | Ratio for tempo adjustment (MIDI meter ÷ actual meter) |
| `phraseStart` | number | Absolute MIDI tick where current phrase began |
| `phraseStartTime` | number | Absolute seconds where current phrase began |

---

## Error Handling

**getMidiTiming()** validates inputs:
- Meter numerator and denominator must be finite numbers
- Denominator cannot be zero
- BPM must be positive

**setUnitTiming()** validates computation state:
- `tpSec` must be positive and finite
- Raises error if timing calculation fails

These checks prevent silent failures and help debug timing issues early.
