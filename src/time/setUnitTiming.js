// setUnitTiming.js - Calculate timing variables for each unit level based on the current musical context

const V = validator.create('setUnitTiming');

/**
 * Set timing variables for each unit level. Calculates absolute positions using
 * cascading parent position + index * duration pattern. See time.md for details.
 * @param {string} unitType - Unit type for timing calculation and logging.
 * @returns {void}
 */

setUnitTiming = (unitType) => {
  const needsComposer = unitType === 'measure' || unitType === 'beat' || unitType === 'div' || unitType === 'subdiv' || unitType === 'subsubdiv';
  let activeLayer = null;
  let activeComposer = null;
  if (needsComposer) {
    V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
    const activeLayerName = /** @type {string} */ (LM.activeLayer);
    activeLayer = LM.layers[activeLayerName];
    V.assertObject(activeLayer, 'activeLayer');
    activeComposer = LM.getComposerFor(activeLayerName);
  }

  // Use globals (not a legacy nested object) because `LM.activate()` already restored timing into globals in main.js

  switch (unitType) {
    case 'section':
      // Just log section; section timing already set in LayerManager
      break;

    case 'phrase':
      spPhrase = spMeasure * measuresPerPhrase;
      unitIndex = phraseIndex;
      unitStartTime = phraseStartTime;
      spUnit = spPhrase;
      spParent = spSection;
      unitsPerParent = phrasesPerSection;
      break;

    case 'measure':
      setRhythm('beat', activeLayer);
      measureStartTime = phraseStartTime + measureIndex * spMeasure;
      unitIndex = measureIndex;
      unitStartTime = measureStartTime;
      spUnit = spMeasure;
      spParent = spPhrase;
      unitsPerParent = measuresPerPhrase;
      V.requireFinite(Number(numerator), 'numerator');
      if (Number(numerator) <= 0) {
        throw new Error(`setUnitTiming(measure): invalid numerator=${numerator}`);
      }
      spBeat = spMeasure / Number(numerator);

      // Plan measure-level + beat-level hierarchical motifs
      motifManager.planMeasure(activeLayer, activeComposer);

      break;

    case 'beat':
      // Ensure the active layer has a beat rhythm generated before tracking it
      setRhythm('div', activeLayer);
      spBeat = spMeasure / numerator;
      trueBPM = 60 / spBeat;
      bpmRatio = BPM / trueBPM;
      bpmRatio2 = trueBPM / BPM;
      trueBPM2 = numerator * (numerator / denominator) / 4;
      bpmRatio3 = 1 / trueBPM2;

      beatStartTime = measureStartTime + beatIndex * spBeat;
      // ANTI-PATTERN: counter-productive "validation" masks issues and makes code unreadable
      // divsPerBeat = Number.isFinite(divsPerBeat) && divsPerBeat > 0 ? divsPerBeat : (composer && typeof composer.getDivisions === 'function' ? m.max(1, composer.getDivisions()) : (DIVISIONS && DIVISIONS.min ? DIVISIONS.min : 1));
      divsPerBeat = activeComposer.getDivisions();

      divRhythm = setRhythm('div', activeLayer);
      unitIndex = beatIndex;
      unitStartTime = beatStartTime;
      spUnit = spBeat;
      spParent = spMeasure;
      unitsPerParent = numerator;

      // DIVS-only planner invocation (use DIV API and run once per measure)
      const plannedDivCount = Number(divsPerBeat) * Number(numerator);
      if (beatIndex === 0 || !Array.isArray(activeLayer.divMotifs) || activeLayer.setUnitTimingPlannedDivCount !== plannedDivCount) {
        motifManager.planDivs(activeLayer, Number(divsPerBeat), Number(numerator), activeComposer);
      }
      V.assertArray(activeLayer.divMotifs, 'activeLayer.divMotifs');
      if (activeLayer.divMotifs.length < plannedDivCount) {
        throw new Error(`setUnitTiming(beat): motifSpreader failed to populate divMotifs (${activeLayer.divMotifs ? activeLayer.divMotifs.length : 0} / ${plannedDivCount})`);
      }

      break;

    case 'div':
      setRhythm('subdiv', activeLayer);
      spDiv = spBeat / divsPerBeat;
      divStartTime = beatStartTime + divIndex * spDiv;
      subdivsPerDiv = activeComposer.getSubdivs();
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      subdivRhythm = setRhythm('subdiv', activeLayer);
      unitIndex = divIndex;
      unitStartTime = divStartTime;
      spUnit = spDiv;
      spParent = spBeat;
      unitsPerParent = divsPerBeat;

      // Plan subdiv-level motifs derived from the current div's divMotifs bucket
      { const setUnitTimingAbsDivIdx = Number(beatIndex) * Number(divsPerBeat) + Number(divIndex);
        motifManager.planSubdivs(activeLayer, setUnitTimingAbsDivIdx, Number(subdivsPerDiv)); }

      break;

    case 'subdiv':
      setRhythm('subsubdiv', activeLayer);
      spSubdiv = spDiv / subdivsPerDiv;
      subdivsPerMinute = 60 / spSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubsPerSub = activeComposer.getSubsubdivs();
      subsubdivRhythm = setRhythm('subsubdiv', activeLayer);
      unitIndex = subdivIndex;
      unitStartTime = subdivStartTime;
      spUnit = spSubdiv;
      spParent = spDiv;
      unitsPerParent = subdivsPerDiv;

      // Plan subsubdiv-level motifs derived from the current subdiv's subdivMotifs bucket
      { const setUnitTimingAbsDivIdx2 = Number(beatIndex) * Number(divsPerBeat) + Number(divIndex);
        const setUnitTimingAbsSubIdx = setUnitTimingAbsDivIdx2 * Number(subdivsPerDiv) + Number(subdivIndex);
        motifManager.planSubsubdivs(activeLayer, setUnitTimingAbsSubIdx, Number(subsubsPerSub)); }

      break;

    case 'subsubdiv':
      spSubsubdiv = spSubdiv / subsubsPerSub;
      subsubsPerMinute = 60 / spSubsubdiv;
      subsubdivStartTime = subdivStartTime + subsubdivIndex * spSubsubdiv;
      unitIndex = subsubdivIndex;
      unitStartTime = subsubdivStartTime;
      spUnit = spSubsubdiv;
      spParent = spSubdiv;
      unitsPerParent = subsubsPerSub;
      break;

    default:
      throw new Error(`setUnitTiming: Unknown unit type: ${unitType}`);
  }

  // Log the unit after calculating timing
  logUnit(unitType);
};
