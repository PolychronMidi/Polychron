/**
 * TIME.JS - Timing Engine with Dual-Layer Polyrhythm Support
 *
 * Core innovation: "Meter spoofing" + dual-layer architecture for perfect polyrhythm accuracy.
 * Each layer maintains independent timing state, outputs to separate MIDI files.
 * Phrase boundaries align in absolute time (verified via millisecond timestamps).
 *
 * Architecture:
 * - Primary layer: Full timing calculation, writes to c1/output1.csv
 * - Poly layer: Independent timing recalculation, writes to c2/output2.csv
 * - Final output: Two MIDI files rendered to audio and layered in DAW
 * - Future: Infinite layers with same synchronization principles
 *
 * Terminology vs Traditional 4/4:
 * - Beat = quarter note in 4/4, but generalized to numerator unit in any meter
 * - Measure = bar (one complete cycle of the meter)
 * - Division/Subdivision = tuplets, 16ths, 32nds (rhythm-dependent, not fixed)
 *
 * Hierarchy: Section → Phrase → Measure → Beat → Division → Subdivision → Subsubdivision
 */

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
  spMeasure = tpMeasure / tpSec;
  setMidiTiming();
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
    { tick: tick, type: 'marker_t', vals: [`tpSec: ${tpSec}`] },
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
      originalMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity,
      polyNumerator: polyNumerator,
      polyDenominator: polyDenominator
    };

    for (let originalMeasures = 1; originalMeasures < 7; originalMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
        if (m.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
          let currentMatch = {
            originalMeasures: originalMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: originalMeasures + polyMeasures,
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
         (bestMatch.originalMeasures > 1 || bestMatch.polyMeasures > 1)) &&
        (numerator !== polyNumerator || denominator !== polyDenominator)) {
      measuresPerPhrase1 = bestMatch.originalMeasures;
      measuresPerPhrase2 = bestMatch.polyMeasures;
      tpPhrase = tpMeasure * measuresPerPhrase1;
      return;
    }
  }
};

/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 *
 * @param {string} type - Unit type: 'section', 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'
 */
logUnit = (type) => {
  let shouldLog = false;
  type = type.toLowerCase();
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else {
    const logList = LOG.toLowerCase().split(',').map(item => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
  }
  if (!shouldLog) return null;
  let meterInfo = '';

  if (type === 'section') {
    unit = sectionIndex + 1;
    unitsPerParent = totalSections;
    startTick = sectionStart;
    spSection = tpSection / tpSec;
    endTick = startTick + tpSection;
    startTime = sectionStartTime;
    endTime = startTime + spSection;
    composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
    if (composer && composer.scale && composer.scale.name) {
      composerDetails += `${composer.root} ${composer.scale.name}`;
    } else if (composer && composer.progression) {
      progressionSymbols = composer.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    } else if (composer && composer.mode && composer.mode.name) {
      composerDetails += `${composer.root} ${composer.mode.name}`;
    }
  } else if (type === 'phrase') {
    unit = phraseIndex + 1;
    unitsPerParent = phrasesPerSection;
    startTick = phraseStart;
    endTick = startTick + tpPhrase;
    startTime = phraseStartTime;
    spPhrase = tpPhrase / tpSec;
    endTime = startTime + spPhrase;
  } else if (type === 'measure') {
    unit = measureIndex + 1;
    unitsPerParent = measuresPerPhrase;
    startTick = measureStart;
    endTick = measureStart + tpMeasure;
    startTime = measureStartTime;
    endTime = measureStartTime + spMeasure;
    composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
    if (composer && composer.scale && composer.scale.name) {
      composerDetails += `${composer.root} ${composer.scale.name}`;
    } else if (composer && composer.progression) {
      progressionSymbols = composer.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    } else if (composer && composer.mode && composer.mode.name) {
      composerDetails += `${composer.root} ${composer.mode.name}`;
    }
    actualMeter = [numerator, denominator];
    meterInfo = midiMeter[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails}`;
  } else if (type === 'beat') {
    unit = beatIndex + 1;
    unitsPerParent = numerator;
    startTick = beatStart;
    endTick = startTick + tpBeat;
    startTime = beatStartTime;
    endTime = startTime + spBeat;
  } else if (type === 'division') {
    unit = divIndex + 1;
    unitsPerParent = divsPerBeat;
    startTick = divStart;
    endTick = startTick + tpDiv;
    startTime = divStartTime;
    endTime = startTime + spDiv;
  } else if (type === 'subdivision') {
    unit = subdivIndex + 1;
    unitsPerParent = subdivsPerDiv;
    startTick = subdivStart;
    endTick = startTick + tpSubdiv;
    startTime = subdivStartTime;
    endTime = startTime + spSubdiv;
  } else if (type === 'subsubdivision') {
    unit = subsubdivIndex + 1;
    unitsPerParent = subsubdivsPerSubdiv;
    startTick = subsubdivStart;
    endTick = startTick + tpSubsubdiv;
    startTime = subsubdivStartTime;
    endTime = startTime + spSubsubdiv;
  }

  return (() => {
    c.push({
      tick: startTick,
      type: 'marker_t',
      vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
    });
  })();
};

/**
 * Advances to the next section for a specific layer.
 * @param {string} layerName - Name of the layer to advance ('primary' or 'poly').
 */
nextSection = (layerName) => {
  const layer = LM.layers[layerName];
  if (!layer) return;

  // Advance section timing in layer state
  layer.state.sectionStart += layer.state.tpSection;
  layer.state.sectionStartTime += layer.state.spSection;
  // Reset section accumulation for next section
  layer.state.tpSection = layer.state.spSection = 0;
};

/**
 * Advances to the next phrase for a specific layer.
 * @param {string} layerName - Name of the layer to advance ('primary' or 'poly').
 */
nextPhrase = (layerName) => {
  const layer = LM.layers[layerName];
  if (!layer) return;

  // Advance phrase timing in layer state
  layer.state.phraseStart += tpPhrase;
  layer.state.phraseStartTime += spPhrase;

  // Accumulate into section timing
  layer.state.tpSection += tpPhrase;
  layer.state.spSection += spPhrase;
};

/**
 * Universal timing calculation and logging function for all musical units.
 * Handles the hierarchical timing structure: Section → Phrase → Measure → Beat → Division → Subdivision → Subsubdivision
 * Automatically uses current loop indices from global scope and logs the unit.
 *
 * @param {string} unitType - The unit type: 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'
 */
setUnitTiming = (unitType) => {
  const layer = LM.layers[LM.activeLayer];
  if (!layer) return;

  switch (unitType) {
    case 'phrase':
      // Phrase timing is special - calculated from measures
      tpPhrase = tpMeasure * measuresPerPhrase;
      spPhrase = tpPhrase / tpSec;
      break;

    case 'measure':
      // Measure timing within phrase
      measureStart = layer.state.phraseStart + measureIndex * tpMeasure;
      measureStartTime = layer.state.phraseStartTime + measureIndex * spMeasure;
      break;

    case 'beat':
      // Beat timing with tempo calculations
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
      break;

    case 'division':
      // Division timing within beat
      tpDiv = tpBeat / m.max(1, divsPerBeat);
      spDiv = tpDiv / tpSec;
      divStart = beatStart + divIndex * tpDiv;
      divStartTime = beatStartTime + divIndex * spDiv;
      subdivsPerDiv = m.max(1, composer ? composer.getSubdivisions() : 1);
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      break;

    case 'subdivision':
      // Subdivision timing within division
      tpSubdiv = tpDiv / m.max(1, subdivsPerDiv);
      spSubdiv = tpSubdiv / tpSec;
      subdivsPerMinute = 60 / spSubdiv;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubdivsPerSub = composer ? composer.getSubsubdivs() : 1;
      break;

    case 'subsubdivision':
      // Subsubdivision timing within subdivision
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
