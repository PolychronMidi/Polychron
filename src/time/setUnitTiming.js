// Dependency: rhythm functions (trackRhythm etc) are required via `src/rhythm/index.js`

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
      unitStart = phraseStart;
      tpUnit = tpPhrase;
      parentStart = sectionStart;
      // tpParent = tpSection; // unknown at phrase start time
      unitsPerParent = phrasesPerSection;
      break;

    case 'measure':
      measureStart = phraseStart + measureIndex * tpMeasure;
      measureStartTime = phraseStartTime + measureIndex * spMeasure;
      unitStart = measureStart;
      tpUnit = tpMeasure;
      parentStart = phraseStart;
      tpParent = tpPhrase;
      unitsPerParent = measuresPerPhrase;

      // Ensure active layer has been planned for this measure before any play occurs.
      try {
        const layer = LM && LM.layers && LM.layers[LM.activeLayer];
        if (layer && (typeof layer.measureStart === 'undefined' || layer.measureStart !== measureStart)) {
          try {
            MotifSpreader.spreadMeasure({ layer, measureStart, measureBeats: numerator, composer });
          } catch (e) { console.warn('setUnitTiming(measure): MotifSpreader.spreadMeasure failed', e && e.stack ? e.stack : e); }
        }
      } catch (e) { /* defensive */ }
      break;

    case 'beat':
      // Ensure the active layer has a beat rhythm generated before tracking it
      try { setRhythm('beat', LM.layers[LM.activeLayer]); } catch (e) { console.warn('setRhythm(beat) failed', e); }
      try { trackRhythm('beat', LM.layers[LM.activeLayer]); } catch (e) { console.warn('trackRhythm(beat) failed', e); }
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
      // divsPerBeat = Number.isFinite(divsPerBeat) && divsPerBeat > 0 ? divsPerBeat : (composer && typeof composer.getDivisions === 'function' ? Math.max(1, composer.getDivisions()) : (DIVISIONS && DIVISIONS.min ? DIVISIONS.min : 1));
      divsPerBeat = composer.getDivisions();
      divRhythm = setRhythm('div', LM.layers[LM.activeLayer]);
      unitStart = beatStart;
      tpUnit = tpBeat;
      parentStart = measureStart;
      tpParent = tpMeasure;
      unitsPerParent = numerator;
      break;

    case 'division':
      try { trackRhythm('div', LM.layers[LM.activeLayer]); } catch (e) { console.warn('trackRhythm(div) failed', e); }
      tpDiv = tpBeat / divsPerBeat;
      spDiv = tpDiv / tpSec;
      divStart = beatStart + divIndex * tpDiv;
      divStartTime = beatStartTime + divIndex * spDiv;
      subdivsPerDiv = composer.getSubdivs();
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      subdivRhythm = setRhythm('subdiv', LM.layers[LM.activeLayer]);
      unitStart = divStart;
      tpUnit = tpDiv;
      parentStart = beatStart;
      tpParent = tpBeat;
      unitsPerParent = divsPerBeat;
      break;

    case 'subdiv':
      // subdiv trackRhythm handled by playSubdivNotes()
      tpSubdiv = tpDiv / subdivsPerDiv;
      spSubdiv = tpSubdiv / tpSec;
      subdivsPerMinute = 60 / spSubdiv;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubsPerSub =composer.getSubsubdivs();
      subsubdivRhythm = setRhythm('subsubdiv', LM.layers[LM.activeLayer]);
      unitStart = subdivStart;
      tpUnit = tpSubdiv;
      parentStart = divStart;
      tpParent = tpDiv;
      unitsPerParent = subdivsPerDiv;
      break;

    case 'subsubdiv':
      // subsubdiv trackRhythm handled by playSubsubdivNotes()
      tpSubsubdiv = tpSubdiv / subsubsPerSub;
      spSubsubdiv = tpSubsubdiv / tpSec;
      subsubsPerMinute = 60 / spSubsubdiv;
      subsubdivStart = subdivStart + subsubdivIndex * tpSubsubdiv;
      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;
      unitStart = subsubdivStart;
      tpUnit = tpSubsubdiv;
      parentStart = subdivStart;
      tpParent = tpSubdiv;
      unitsPerParent = subsubsPerSub;
      break;

    default:
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  // Log the unit after calculating timing
  logUnit(unitType);
};
