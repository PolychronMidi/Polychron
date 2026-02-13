// logUnit.js - Logs timing markers with context awareness, writing to active buffer (c = c1 or c2) for proper file separation.

/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 *
 * @param {string} type - Unit type: 'section', 'phrase', 'measure', 'beat', 'division', 'subdiv', 'subsubdiv'
 */
logUnit = (type) => {
  let shouldLog = false;
  type = type.toLowerCase();

  // Localize all per-unit variables to avoid accidental global mutation across calls
  let unit = null;
  let unitsPerParent = null;
  let startTick = null;
  let endTick = null;
  let startTime = null;
  let endTime = null;
  let spPhrase = null;
  let spMeasure = null;
  let spBeat = null;
  let spDiv = null;
  let spSubdiv = null;
  let spSubsubdiv = null;
  let composerDetails = '';
  let progressionSymbols = '';
  let actualMeter = null;
  let meterInfo = '';
  const activeLayerObj = (LM && LM.layers && typeof LM.activeLayer === 'string') ? LM.layers[LM.activeLayer] : null;
  const composerForLog = (activeLayerObj && activeLayerObj.measureComposer && typeof activeLayerObj.measureComposer === 'object')
    ? activeLayerObj.measureComposer
    : composer;
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else {
    const logList = LOG.toLowerCase().split(',').map(item => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
  }
  if (typeof shouldLog === 'undefined') {
    throw new Error('logUnit: LOG configuration invalid - shouldLog is undefined');
  } else if (!shouldLog) return null;

  if (type === 'section') {
    unit = sectionIndex + 1;
    unitsPerParent = totalSections;
    // Ensure we always have a safe numeric start for sections.
    startTick = sectionStart;
    startTime = sectionStartTime;
    // Section duration not known this early in the loop.
  } else if (type === 'phrase') {
    unit = phraseIndex + 1;
    unitsPerParent = phrasesPerSection;
    startTick = phraseStart;
    // Compute endTick only when tpPhrase is a finite number
    endTick = startTick + tpPhrase;
    startTime = phraseStartTime;
    spPhrase = tpPhrase / tpSec;
    endTime = startTime + spPhrase;

    composerDetails = composerForLog ? `${composerForLog.constructor.name} ` : 'Unknown Composer ';
    if (composerForLog && composerForLog.scale && composerForLog.scale.name) {
      composerDetails += `${composerForLog.root} ${composerForLog.scale.name}`;
    } else if (composerForLog && composerForLog.progression) {
      progressionSymbols = composerForLog.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    } else if (composerForLog && composerForLog.mode && composerForLog.mode.name) {
      composerDetails += `${composerForLog.root} ${composerForLog.mode.name}`;
    }
    actualMeter = [numerator, denominator];
    try {
      if (Array.isArray(midiMeter) && midiMeter[1] === actualMeter[1]) {
        meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
      } else {
        meterInfo = `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${Array.isArray(midiMeter) ? midiMeter.join('/') : String(midiMeter)} Composer: ${composerDetails} tpSec: ${tpSec}`;
      }
    } catch { meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`; }
  } else if (type === 'measure') {
    unit = measureIndex + 1;
    unitsPerParent = measuresPerPhrase;
    startTick = measureStart;
    endTick = measureStart + tpMeasure;
    startTime = measureStartTime;
    endTime = measureStartTime + spMeasure;
    composerDetails = composerForLog ? `${composerForLog.constructor.name} ` : 'Unknown Composer ';
    if (composerForLog && composerForLog.scale && composerForLog.scale.name) {
      composerDetails += `${composerForLog.root} ${composerForLog.scale.name}`;
    } else if (composerForLog && composerForLog.progression) {
      progressionSymbols = composerForLog.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    } else if (composerForLog && composerForLog.mode && composerForLog.mode.name) {
      composerDetails += `${composerForLog.root} ${composerForLog.mode.name}`;
    }
    actualMeter = [numerator, denominator];
    try {
      if (Array.isArray(midiMeter) && midiMeter[1] === actualMeter[1]) {
        meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
      } else {
        meterInfo = `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${Array.isArray(midiMeter) ? midiMeter.join('/') : String(midiMeter)} Composer: ${composerDetails} tpSec: ${tpSec}`;
      }
    } catch { meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`; }
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
  } else if (type === 'subdiv') {
    unit = subdivIndex + 1;
    unitsPerParent = subdivsPerDiv;
    startTick = subdivStart;
    endTick = startTick + tpSubdiv;
    startTime = subdivStartTime;
    endTime = startTime + spSubdiv;
  } else if (type === 'subsubdiv') {
    // Use defensively coerced indices/totals to avoid NaN/undefined emissions
    const sIndex = subsubdivIndex;
    unit = sIndex + 1;
    // Prefer canonical name `subsubsPerSub` but accept legacy `subsubsPerSub` if present
    unitsPerParent = subsubsPerSub;
    startTick = subsubdivStart;
    endTick = startTick + tpSubsubdiv;
    startTime = subsubdivStartTime;
    endTime = startTime + spSubsubdiv;
  }
  return (() => {
    c.push({
      tick: startTick,
      type: 'marker_t',
      vals: [`${LM.activeLayer} ${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} ${typeof endTick === 'undefined' || typeof endTime === 'undefined' ? `Start: ${formatTime(startTime)}` : `Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick}`} ${meterInfo ? meterInfo : ''}`]
    });
  })();
};
