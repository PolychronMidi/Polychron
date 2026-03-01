// setUnitTiming.js - Calculate timing variables for each unit level based on the current musical context

const V = validator.create('setUnitTiming');

// --- Iteration budget statistics ---
// Tracks how often the D*S*SS cap fires and the magnitude of reduction.
/** @type {{ totalBeats: number, cappedBeats: number, rawProducts: number[], cappedProducts: number[] }} */
const _budgetStats = { totalBeats: 0, cappedBeats: 0, rawProducts: [], cappedProducts: [] };

/** Expose read-only budget stats for manifest/trace consumers. */
setUnitTimingBudgetStats = {
  /** @returns {{ totalBeats: number, cappedBeats: number, capRate: number, maxRaw: number, avgRaw: number, maxCapped: number }} */
  getSummary() {
    const s = _budgetStats;
    const maxRaw = s.rawProducts.length > 0 ? m.max(...s.rawProducts) : 0;
    const avgRaw = s.rawProducts.length > 0 ? s.rawProducts.reduce((a, b) => a + b, 0) / s.rawProducts.length : 0;
    const maxCapped = s.cappedProducts.length > 0 ? m.max(...s.cappedProducts) : 0;
    return {
      totalBeats: s.totalBeats,
      cappedBeats: s.cappedBeats,
      capRate: s.totalBeats > 0 ? s.cappedBeats / s.totalBeats : 0,
      maxRaw,
      avgRaw: Number(avgRaw.toFixed(1)),
      maxCapped
    };
  },
  /** @returns {{ raw: number, capped: number, wasCapped: boolean } | null} Last beat's budget info. */
  getLastBeat() {
    const s = _budgetStats;
    if (s.rawProducts.length === 0) return null;
    const raw = s.rawProducts[s.rawProducts.length - 1];
    const capped = s.cappedProducts[s.cappedProducts.length - 1];
    return { raw, capped, wasCapped: raw !== capped };
  },
  reset() {
    _budgetStats.totalBeats = 0;
    _budgetStats.cappedBeats = 0;
    _budgetStats.rawProducts.length = 0;
    _budgetStats.cappedProducts.length = 0;
  }
};

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
    if (!activeLayer || typeof activeLayer !== 'object') {
      throw new Error(`setUnitTiming: active layer "${activeLayerName}" not found`);
    }
    activeComposer = LM.getComposerFor(activeLayerName);
  }

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
      setRhythm('beat', activeLayer);
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

      // Plan measure-level + beat-level hierarchical motifs
      motifManager.planMeasure(activeLayer, activeComposer);

      break;

    case 'beat':
      // Ensure the active layer has a beat rhythm generated before tracking it
      setRhythm('div', activeLayer);
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
      divsPerBeat = activeComposer.getDivisions();

      // --- Micro-unit iteration budget ---
      // Cap the product D*S*SS to prevent worst-case combinatorial explosions
      // (e.g. 15*15*15 = 3375). Adaptive: downbeats and structurally important
      // positions get a higher budget; inner beats get a lower budget to
      // compensate. The per-measure time watchdog in layerPass may further
      // reduce the cap via activeLayer._budgetOverrideCap.
      { const _rawD = divsPerBeat;
        const _rawS = activeComposer.getSubdivs();
        const _rawSS = activeComposer.getSubsubdivs();
        const _rawProduct = _rawD * _rawS * _rawSS;
        const _BASE_MAX = 400;
        const _isDownbeat = beatIndex === 0;
        const _isFirstMeasure = measureIndex === 0;
        const _boost = (_isDownbeat ? 50 : 0) + (_isFirstMeasure && _isDownbeat ? 50 : 0);
        const _overrideCap = activeLayer._budgetOverrideCap || 0;
        const _MAX = _overrideCap > 0 ? m.min(_BASE_MAX + _boost, _overrideCap) : (_BASE_MAX + _boost);
        _budgetStats.totalBeats++;
        if (_rawProduct > _MAX) {
          _budgetStats.cappedBeats++;
          // Reduce largest factor until product fits
          const _factors = [_rawD, _rawS, _rawSS];
          while (_factors[0] * _factors[1] * _factors[2] > _MAX) {
            // Find max index and shrink it
            let _mi = 0;
            if (_factors[1] > _factors[_mi]) _mi = 1;
            if (_factors[2] > _factors[_mi]) _mi = 2;
            _factors[_mi] = m.max(1, _factors[_mi] - 1);
          }
          divsPerBeat = _factors[0];
          // Stash pre-scaled targets so div/subdiv cases honour the budget
          activeLayer._budgetSubdivs = _factors[1];
          activeLayer._budgetSubsubdivs = _factors[2];
          _budgetStats.rawProducts.push(_rawProduct);
          _budgetStats.cappedProducts.push(_factors[0] * _factors[1] * _factors[2]);
        } else {
          activeLayer._budgetSubdivs = 0;  // 0 = no override
          activeLayer._budgetSubsubdivs = 0;
          _budgetStats.rawProducts.push(_rawProduct);
          _budgetStats.cappedProducts.push(_rawProduct);
        }
      }

      divRhythm = setRhythm('div', activeLayer);
      unitIndex = beatIndex;
      unitStart = beatStart;
      tpUnit = tpBeat;
      parentStart = measureStart;
      tpParent = tpMeasure;
      unitsPerParent = numerator;

      // DIVS-only planner invocation (use DIV API and run once per measure)
      const plannedDivCount = Number(divsPerBeat) * Number(numerator);
      if (beatIndex === 0 || !Array.isArray(activeLayer.divMotifs) || activeLayer._plannedDivCount !== plannedDivCount) {
        motifManager.planDivs(activeLayer, Number(divsPerBeat), Number(numerator), activeComposer);
      }
      if (!Array.isArray(activeLayer.divMotifs) || activeLayer.divMotifs.length < plannedDivCount) {
        throw new Error(`setUnitTiming(beat): motifSpreader failed to populate divMotifs (${activeLayer.divMotifs ? activeLayer.divMotifs.length : 0} / ${plannedDivCount})`);
      }

      break;

    case 'div':
      setRhythm('subdiv', activeLayer);
      tpDiv = tpBeat / divsPerBeat;
      spDiv = tpDiv / tpSec;
      divStart = beatStart + divIndex * tpDiv;
      divStartTime = beatStartTime + divIndex * spDiv;
      subdivsPerDiv = (activeLayer._budgetSubdivs > 0) ? activeLayer._budgetSubdivs : activeComposer.getSubdivs();
      subdivFreq = subdivsPerDiv * divsPerBeat * numerator * meterRatio;
      subdivRhythm = setRhythm('subdiv', activeLayer);
      unitIndex = divIndex;
      unitStart = divStart;
      tpUnit = tpDiv;
      parentStart = beatStart;
      tpParent = tpBeat;
      unitsPerParent = divsPerBeat;

      // Plan subdiv-level motifs derived from the current div's divMotifs bucket
      { const _absDivIdx = Number(beatIndex) * Number(divsPerBeat) + Number(divIndex);
        motifManager.planSubdivs(activeLayer, _absDivIdx, Number(subdivsPerDiv)); }

      break;

    case 'subdiv':
      setRhythm('subsubdiv', activeLayer);
      tpSubdiv = tpDiv / subdivsPerDiv;
      spSubdiv = tpSubdiv / tpSec;
      subdivsPerMinute = 60 / spSubdiv;
      subdivStart = divStart + subdivIndex * tpSubdiv;
      subdivStartTime = divStartTime + subdivIndex * spSubdiv;
      subsubsPerSub = (activeLayer._budgetSubsubdivs > 0) ? activeLayer._budgetSubsubdivs : activeComposer.getSubsubdivs();
      subsubdivRhythm = setRhythm('subsubdiv', activeLayer);
      unitIndex = subdivIndex;
      unitStart = subdivStart;
      tpUnit = tpSubdiv;
      parentStart = divStart;
      tpParent = tpDiv;
      unitsPerParent = subdivsPerDiv;

      // Plan subsubdiv-level motifs derived from the current subdiv's subdivMotifs bucket
      { const _absDivIdx2 = Number(beatIndex) * Number(divsPerBeat) + Number(divIndex);
        const _absSubIdx = _absDivIdx2 * Number(subdivsPerDiv) + Number(subdivIndex);
        motifManager.planSubsubdivs(activeLayer, _absSubIdx, Number(subsubsPerSub)); }

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
