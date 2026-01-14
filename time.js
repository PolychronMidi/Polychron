// time.js - Timing engine with meter spoofing and dual-layer polyrhythm support.
// minimalist comments, details at: time.md

/**
 * METER SPOOFING: THE CORE INNOVATION
 *
 * Problem: MIDI only supports power-of-2 denominators
 * Solution: "Spoof" the meter while preserving actual duration
 *
 * Example: 7/9 meter
 * 1. Actual ratio: 7/9 = 0.777...
 * 2. MIDI-compatible: 7/8 = 0.875 (nearest power-of-2)
 * 3. Sync factor: 0.875/0.777 = 1.126
 * 4. Adjusted BPM: original_BPM * 1.126
 *
 * Result: MIDI sees valid 7/8 but plays at adjusted tempo
 * to match the actual 7/9 duration in absolute time.
 *
 * This applies independently to each layer, enabling
 * polyrhythms with different spoofing factors that still
 * align perfectly in absolute time.
 */

/**
 * Generates MIDI-compatible meter via "meter spoofing" - Polychron's core innovation.
 * NOW CONTEXT-AWARE: Recalculated independently for primary and poly meters.
 *
 * MIDI Constraint: Time signature denominators must be power-of-2 (2,4,8,16...).
 * Solution: Convert denominator to nearest power-of-2, adjust tempo to preserve duration.
 *
 * Tick Calculation (Music Theory):
 * Standard: tpMeasure = PPQ * 4 * (numerator/denominator)
 * - PPQ * 4 = ticks in whole note (semibreve)
 * - Multiply by meter ratio to get ticks per measure
 * - Example 4/4: 480 * 4 * (4/4) = 1920 ticks/measure
 * - Example 3/4: 480 * 4 * (3/4) = 1440 ticks/measure
 * - Example 7/8: 480 * 4 * (7/8) = 1680 ticks/measure
 *
 * Meter Spoofing Mechanism:
 * 1. Calculate actual meterRatio = num/den (e.g., 7/9 = 0.777...)
 * 2. Find MIDI-compatible midiMeterRatio (e.g., 7/8 = 0.875)
 * 3. Compute syncFactor = midiMeterRatio / meterRatio (e.g., 0.875/0.777 = 1.126)
 * 4. Scale BPM by syncFactor: midiBPM = BPM * syncFactor
 * 5. Result: MIDI sees valid 7/8, but plays at adjusted tempo to match 7/9 duration
 *
 * Dual-Context Accuracy:
 * When polyrhythm uses two spoofed meters with different syncFactors, each gets
 * its own MIDI file with correct tempo. Phrase boundaries align perfectly in absolute
 * time despite different tick rates.
 *
 * @global Sets: midiMeter, midiMeterRatio, syncFactor, midiBPM, tpSec, tpMeasure
 *
 * @example
 * // Primary meter: 7/9
 * c = c1; numerator = 7; denominator = 9;
 * getMidiMeter(); // syncFactor = 1.126, writes to c1
 *
 * // Poly meter: 5/6 (independent calculation)
 * c = c2; numerator = 5; denominator = 6;
 * getMidiMeter(); // syncFactor = 1.067, writes to c2
 * // Both phrase durations match in seconds, different in ticks
 */
getMidiMeter = () => {
  meterRatio = numerator / denominator;
  isPowerOf2 = (n) => { return (n & (n - 1)) === 0; }

  if (isPowerOf2(denominator)) {
    midiMeter = [numerator, denominator];
  } else {
    const high = 2 ** m.ceil(m.log2(denominator));
    const highRatio = numerator / high;
    const low = 2 ** m.floor(m.log2(denominator));
    const lowRatio = numerator / low;
    midiMeter = m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio)
      ? [numerator, high]
      : [numerator, low];
  }

  midiMeterRatio = midiMeter[0] / midiMeter[1];
  syncFactor = midiMeterRatio / meterRatio;
  midiBPM = BPM * syncFactor;
  tpSec = midiBPM * PPQ / 60;
  tpMeasure = PPQ * 4 * midiMeterRatio;
  spMeasure = (60 / BPM) * 4 * meterRatio;
  return midiMeter; // Return the midiMeter for testing
};

/**
 * Writes MIDI timing events to active buffer (c).
 * Context-aware: writes to c1 or c2 depending on current meter.
 */
setMidiTiming = (tick=measureStart) => {
  p(c,
    { tick: tick, type: 'bpm', vals: [midiBPM] },
    { tick: tick, type: 'meter', vals: [midiMeter[0], midiMeter[1]] },
  );
};

/**
 * Finds polyrhythm alignment using ACTUAL meters (before spoofing).
 * Alignment calculated in mathematical ratios, not MIDI ticks.
 * Each meter then spoofs independently, maintaining duration accuracy.
 *
 * Musical Context:
 * "3:4 polyrhythm" means 3 measures of one meter = 4 measures of another.
 * Example: 3 measures of 4/4 (12 beats) = 4 measures of 3/4 (12 beats).
 *
 * Algorithm:
 * 1. Get candidate meter (ignoreRatioCheck=true allows any meter)
 * 2. Test combinations: where do measure boundaries align?
 * 3. Find match with fewest total measures (tightest polyrhythm)
 * 4. Validate: total > 2, at least one uses multiple measures, meters differ
 * 5. Store results: measuresPerPhrase1 (primary), measuresPerPhrase2 (poly)
 *
 * Critical: Alignment happens in TIME (seconds), not TICKS (MIDI events).
 * After spoofing, tick counts differ but durations match.
 *
 * @global Sets: measuresPerPhrase1, measuresPerPhrase2, tpPhrase
 *
 * @example
 * // Primary: 7/9 (ratio=0.777), Poly: 5/6 (ratio=0.833)
 * // Test: 5 measures * 0.777 = 3.885, 4 measures * 0.833 = 3.332 ✗
 * // Test: 10 measures * 0.777 = 7.77, 9 measures * 0.833 = 7.497 ≈ ✓
 * // Result: 10:9 polyrhythm (within tolerance)
 */
getPolyrhythm = () => {
  if (!composer) return;
  while (true) {
    [polyNumerator, polyDenominator] = composer.getMeter(true, true);
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
};

/**
 * TimingContext class - encapsulates all timing state for a layer.
 * @class
 */
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



// Layer timing globals are created by `LM.register` at startup to support infinite layers

/**
 * LayerManager (LM) - Context Switching Pattern for Multi-Layer Timing
 *
 * ARCHITECTURE: Each layer maintains private timing state, but calculations
 * use shared global variables. LM switches contexts between layers.
 *
 * PATTERN:
 * 1. register() → Create layer with initial state
 * 2. activate(layer) → Save current globals → Restore layer's globals
 * 3. Process with globals → Layer state accessed as needed
 * 4. advance(layer) → Save updated globals to layer state
 *
 * WHY: Enables complex per-layer timing while keeping calculation code simple
 */
const LM = layerManager ={
  layers: {},
  activeLayer: null,

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

  // Advance timing boundaries after phrase/section completes
  advance: (name, advancementType = 'phrase') => {
    const layer = LM.layers[name];
    if (!layer) return;

    beatRhythm = divRhythm = subdivRhythm = subsubdivRhthm = 0;

    // Save current globals to state first
    layer.state.saveFrom({
      numerator, denominator, measuresPerPhrase,
      tpPhrase, spPhrase, measureStart, measureStartTime,
      tpMeasure, spMeasure, phraseStart, phraseStartTime,
      sectionStart, sectionStartTime, sectionEnd,
      tpSec, tpSection, spSection
    });

    // Then advance using saved values
    if (advancementType === 'phrase') {
      layer.state.advancePhrase(tpPhrase, spPhrase);
    } else if (advancementType === 'section') {
      layer.state.advanceSection();
    }
  },

};
// Export layer manager to global scope for access from other modules
globalThis.LM = LM;
// layer manager is initialized in play.js after buffers are created
// This ensures c1 and c2 are available when registering layers

/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position + index × duration pattern. See time.md for details.
 * @param {string} unitType - Unit type for timing calculation and logging
 */
setUnitTiming = (unitType) => {
  const layer = LM.layers[LM.activeLayer];
  if (!layer) return;

  switch (unitType) {
    case 'phrase':
      tpPhrase = tpMeasure * measuresPerPhrase;
      spPhrase = tpPhrase / tpSec;
      break;

    case 'measure':
      // measureStart = phraseStart + measureIndex × tpMeasure
      measureStart = layer.state.phraseStart + measureIndex * tpMeasure;
      measureStartTime = layer.state.phraseStartTime + measureIndex * spMeasure;
      setMidiTiming();
      beatRhythm = setRhythm('beat');
      break;

    case 'beat':
      // beatStart = phraseStart + measureIndex × tpMeasure + beatIndex × tpBeat
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
      // divStart = beatStart + divIndex × tpDiv
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
      // subdivStart = divStart + subdivIndex × tpSubdiv
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
      // SUBSUBDIVISION: Finest resolution, cascaded from all parent levels\n      // Formula: subdivStart + subsubdivIndex × tpSubsubdiv\n      trackSubsubdivRhythm();  // Track subsubdivision rhythm\n      tpSubsubdiv = tpSubdiv / m.max(1, subsubdivsPerSub);  // Calculate ticks per subsubdiv\n      spSubsubdiv = tpSubsubdiv / tpSec;  // Seconds per subsubdivision
      subsubdivsPerMinute = 60 / spSubsubdiv;  // Calculate subsubdivs per minute
      subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;  // Position within subdivision\n      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;  // Time position\n      break;

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
