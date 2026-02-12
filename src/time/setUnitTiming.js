// setUnitTiming.js - Calculate timing variables for each unit level based on the current musical context

/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position + index × duration pattern. See time.md for details.
 * @param {string} unitType - Unit type for timing calculation and logging.
 * @returns {void}
 */

setUnitTiming = (unitType) => {

  // Use globals (not a legacy nested object) because `LM.activate()` already restored timing into globals in main.js

  switch (unitType) {
    case 'section':
      // Just log section; section timing already set in LayerManager
      break;

    case 'phrase':
      tpPhrase = tpMeasure * measuresPerPhrase;
      spPhrase = tpPhrase / tpSec;
      unitIndex = phraseIndex;
      unitStart = phraseStart;
      tpUnit = tpPhrase;
      parentStart = sectionStart;
      // tpParent = tpSection; // unknown at phrase start time
      unitsPerParent = phrasesPerSection;
      break;

    case 'measure':
      setRhythm('beat', LM.layers[LM.activeLayer]);
      measureStart = phraseStart + measureIndex * tpMeasure;
      measureStartTime = phraseStartTime + measureIndex * spMeasure;
      unitIndex = measureIndex;
      unitStart = measureStart;
      tpUnit = tpMeasure;
      parentStart = phraseStart;
      tpParent = tpPhrase;
      unitsPerParent = measuresPerPhrase;
      if (!Number.isFinite(Number(numerator)) || Number(numerator) <= 0) {
        throw new Error(`setUnitTiming(measure): invalid numerator=${numerator} - cannot compute tpBeat`);
      }
      tpBeat = tpMeasure / Number(numerator);
      if (!Number.isFinite(Number(tpBeat)) || Number(tpBeat) <= 0) {
        throw new Error(`setUnitTiming(measure): invalid tpBeat=${tpBeat} - cannot plan motifs`);
      }
      const layer = LM.layers[LM.activeLayer];
      MotifSpreader.spreadMeasure({ layer, measureStart, measureBeats: numerator, composer });
      break;

    case 'beat':
      // Ensure the active layer has a beat rhythm generated before tracking it
      setRhythm('div', LM.layers[LM.activeLayer]);
      tpBeat = tpMeasure / numerator;
      spBeat = tpBeat / tpSec;
      trueBPM = 60 / spBeat;
      bpmRatio = BPM / trueBPM;
      bpmRatio2 = trueBPM / BPM;
      trueBPM2 = numerator * (numerator / denominator) / 4;
      bpmRatio3 = 1 / trueBPM2;

      beatStart = measureStart + beatIndex * tpBeat;
      beatStartTime = measureStartTime + beatIndex * spBeat;
      // ANTI-PATTERN: counter-productive "validation" masks issues and makes code unreadable
      // divsPerBeat = Number.isFinite(divsPerBeat) && divsPerBeat > 0 ? divsPerBeat : (composer && typeof composer.getDivisions === 'function' ? m.max(1, composer.getDivisions()) : (DIVISIONS && DIVISIONS.min ? DIVISIONS.min : 1));
      divsPerBeat = composer.getDivisions();
      divRhythm = setRhythm('div', LM.layers[LM.activeLayer]);
      unitIndex = beatIndex;
      unitStart = beatStart;
      tpUnit = tpBeat;
      parentStart = measureStart;
      tpParent = tpMeasure;
      unitsPerParent = numerator;
      break;

    case 'div':
      setRhythm('subdiv', LM.layers[LM.activeLayer]);
      tpDiv = tpBeat / divsPerBeat;
      spDiv = tpDiv / tpSec;
      divStart = beatStart + divIndex * tpDiv;
      divStartTime = beatStartTime + divIndex * spDiv;
      subdivsPerDiv = composer.getSubdivs();
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      subdivRhythm = setRhythm('subdiv', LM.layers[LM.activeLayer]);
      unitIndex = divIndex;
      unitStart = divStart;
      tpUnit = tpDiv;
      parentStart = beatStart;
      tpParent = tpBeat;
      unitsPerParent = divsPerBeat;
      break;

    case 'subdiv':
      setRhythm('subsubdiv', LM.layers[LM.activeLayer]);
      tpSubdiv = tpDiv / subdivsPerDiv;
      spSubdiv = tpSubdiv / tpSec;
      subdivsPerMinute = 60 / spSubdiv;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubsPerSub =composer.getSubsubdivs();
      subsubdivRhythm = setRhythm('subsubdiv', LM.layers[LM.activeLayer]);
      unitIndex = subdivIndex;
      unitStart = subdivStart;
      tpUnit = tpSubdiv;
      parentStart = divStart;
      tpParent = tpDiv;
      unitsPerParent = subdivsPerDiv;
      break;

    case 'subsubdiv':
      tpSubsubdiv = tpSubdiv / subsubsPerSub;
      spSubsubdiv = tpSubsubdiv / tpSec;
      subsubsPerMinute = 60 / spSubsubdiv;
      subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;
      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;
      unitIndex = subsubdivIndex;
      unitStart = subsubdivStart;
      tpUnit = tpSubsubdiv;
      parentStart = subdivStart;
      tpParent = tpSubdiv;
      unitsPerParent = subsubsPerSub;
      break;

    default:
      throw new Error(`setUnitTiming: Unknown unit type: ${unitType}`);
  }

  // Log the unit after calculating timing
  logUnit(unitType);
};
