// logUnit.js - Extracted logUnit function to simplify writer.js and enable isolated refactor
// Relies on project globals (sectionIndex, phraseIndex, measureIndex, composer, LOG, c, etc.)
// Uses writeDebugFile from logGate for diagnostic traces.
const { writeDebugFile } = require('./logGate');

/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 *
 * @param {string} type - Unit type: 'section', 'phrase', 'measure', 'beat', 'division', 'subdiv', 'subsubdiv'
 */
const logUnit = (type) => {
  let shouldLog = false;
  type = type.toLowerCase();

  // Localize all per-unit variables to avoid accidental global mutation across calls
  let unit = null;
  let unitsPerParent = null;
  let startTick = null;
  let endTick = null;
  let startTime = null;
  let endTime = null;
  let spSection = null;
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
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else {
    const logList = LOG.toLowerCase().split(',').map(item => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
  }
  if (typeof shouldLog === 'undefined') {
    // function not yet invoked in this context; skip
  } else if (!shouldLog) return null;

  // Use buffer for this layer
  const buf = c;
  if (type === 'section') {
    unit = sectionIndex + 1;
    unitsPerParent = totalSections;
    startTick = sectionStart;
    spSection = tpSection / tpSec;
    endTick = startTick + tpSection;
    startTime = sectionStartTime;
    endTime = startTime + spSection;
  } else if (type === 'phrase') {
    unit = phraseIndex + 1;
    unitsPerParent = phrasesPerSection;
    startTick = phraseStart;
    endTick = startTick + tpPhrase;
    startTime = phraseStartTime;
    spPhrase = tpPhrase / tpSec;
    endTime = startTime + spPhrase;
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
    try {
      if (Array.isArray(midiMeter) && midiMeter[1] === actualMeter[1]) {
        meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
      } else {
        meterInfo = `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${Array.isArray(midiMeter) ? midiMeter.join('/') : String(midiMeter)} Composer: ${composerDetails} tpSec: ${tpSec}`;
      }
    } catch (_e) { meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`; }
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
    try {
      if (Array.isArray(midiMeter) && midiMeter[1] === actualMeter[1]) {
        meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
      } else {
        meterInfo = `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${Array.isArray(midiMeter) ? midiMeter.join('/') : String(midiMeter)} Composer: ${composerDetails} tpSec: ${tpSec}`;
      }
    } catch (_e) { meterInfo = `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`; }
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
    const sIndex = Number.isFinite(Number(subsubdivIndex)) ? Number(subsubdivIndex) : 0;
    unit = sIndex + 1;
    // Prefer canonical name `subsubsPerSub` but accept legacy `subsubsPerSub` if present
    unitsPerParent = Number.isFinite(Number(subsubsPerSub)) ? Number(subsubsPerSub) : (Number.isFinite(Number(subsubsPerSub)) ? Number(subsubsPerSub) : 1);
    startTick = subsubdivStart;
    endTick = startTick + (Number.isFinite(Number(tpSubsubdiv)) ? tpSubsubdiv : 0);
    startTime = Number.isFinite(Number(subsubdivStartTime)) ? subsubdivStartTime : 0;
    endTime = startTime + (Number.isFinite(Number(spSubsubdiv)) ? spSubsubdiv : 0);
  }

  return (() => {
    // Emit marker tick that corresponds to the canonical end of the unit when available.
    // Use a rounded integer endTick in both the event tick and the human-readable marker text
    const endTickInt = Math.round(Number(endTick) || 0);
    const markerTick = (Number.isFinite(endTickInt) && endTickInt >= 0) ? endTickInt : Math.round(Number(startTick || 0));
    const markerRaw = `${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${markerTick} ${meterInfo ? meterInfo : ''}`;


    try {
      const parts = [];
      // Coerce totals to safe numeric defaults to avoid NaN/undefined in IDs
      const total = Number.isFinite(Number(unitsPerParent)) ? Number(unitsPerParent) : 1;
      const formattedUnit = `${type}${unit}/${total}`;
      const idParts = ['unitRec', (c && c.name) ? `layer:${c.name}` : 'layer:unknown', `section${sectionIndex + 1}/${totalSections}`, `phrase${phraseIndex + 1}`, formattedUnit, `${startTick}-${endTick}`, `${startTime.toFixed(6)}-${endTime.toFixed(6)}`];
      const raw = `unitRec:${idParts.join('|')}`;
      parts.push(raw);

      // Emit human-readable marker event
      buf.push({
        tick: markerTick,
        type: 'marker_t',
        vals: [markerRaw]
      });

      return raw;
    } catch (e) {
      try { writeDebugFile('writer-debug.ndjson', { tag: 'marker-broken', error: e && e.message ? e.message : String(e), ctx: { type, unit, unitsPerParent } }); } catch (_e) { /* swallow */ }
      return null;
    }
  })();
};

module.exports = { logUnit };
