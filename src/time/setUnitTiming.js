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
      unitIndex = phraseIndex;
      unitStart = phraseStart;
      tpUnit = tpPhrase;
      parentStart = sectionStart;
      // tpParent = tpSection; // unknown at phrase start time
      unitsPerParent = phrasesPerSection;
      break;

    case 'measure':
      try { setRhythm('beat', LM.layers[LM.activeLayer]); } catch (e) { console.warn('setRhythm(beat) failed', e); }
      measureStart = phraseStart + measureIndex * tpMeasure;
      measureStartTime = phraseStartTime + measureIndex * spMeasure;
      unitIndex = measureIndex;
      unitStart = measureStart;
      tpUnit = tpMeasure;
      parentStart = phraseStart;
      tpParent = tpPhrase;
      unitsPerParent = measuresPerPhrase;
      try {
        const layer = LM.layers[LM.activeLayer];
        MotifSpreader.spreadMeasure({ layer, measureStart, measureBeats: numerator, composer });
      } catch (_e) { console.warn('main.js: MotifSpreader.spreadMeasure failed while planning measure (continuing):', _e && _e.stack ? _e.stack : _e); }
      break;

    case 'beat':
      // Ensure the active layer has a beat rhythm generated before tracking it
      try { setRhythm('div', LM.layers[LM.activeLayer]); } catch (e) { console.warn('setRhythm(beat) failed', e); }
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
      unitIndex = beatIndex;
      unitStart = beatStart;
      tpUnit = tpBeat;
      parentStart = measureStart;
      tpParent = tpMeasure;
      unitsPerParent = numerator;
      break;

    case 'div':
      try { setRhythm('subdiv', LM.layers[LM.activeLayer]); } catch (e) { console.warn('setRhythm(beat) failed', e); }
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
      try { setRhythm('subsubdiv', LM.layers[LM.activeLayer]); } catch (e) { console.warn('setRhythm(beat) failed', e); }
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
      console.warn(`Unknown unit type: ${unitType}`);
      return;
  }

  // Log the unit after calculating timing
  logUnit(unitType);
};
