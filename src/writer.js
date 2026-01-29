// @ts-check
// writer.js - MIDI output and file generation with CSV buffer management.
// minimalist comments, details at: writer.md

let fs = require('fs');
const path = require('path');
const { writeDebugFile, writeFatal } = require('./logGate');
const { raiseCritical } = require('./postfixGuard');
// Import canonical system constants from sheet.js (LOG, TUNING_FREQ, BINAURAL, etc.)
require('./sheet');
// Initialize naked globals and utility helpers defined in backstage
require('./backstage');
// Centralized test hook object (replace __POLYCHRON_TEST__ global)
const TEST = require('./test-hooks');


/**
 * @typedef {{parts?: string[], startTick?: number, endTick?: number, startTime?: number, endTime?: number}} Unit
 * @typedef {{tick?: number, type?: string, vals?: any[], _tickSortKey?: number, _unitHash?: string}} BufferEvent
 */

/**
 * Layer-aware MIDI event buffer.
 * @class CSVBuffer
 * @param {string} name - Layer identifier ('primary', 'poly', etc.).
 * @property {string} name - Layer identifier.
 * @property {Array<object>} rows - MIDI event objects: {tick, type, vals}.
 * @property {number} length - Read-only count of events.
 */
class CSVBuffer {
  /**
   * @param {string} name
   */
  constructor(name) {
    /** @type {string} */ this.name = name;
    /** @type {Array<BufferEvent>} */ this.rows = [];
  }
  /** @param {...BufferEvent} items */
  push(...items) {
    this.rows.push(...items);
  }
  get length() {
    return this.rows.length;
  }
  clear() {
    this.rows = [];
  }
}

/**
 * Push multiple items onto a buffer/array.
 * @param {CSVBuffer|Array<any>} buffer - The target buffer to push onto.
 * @param {...*} items - Items to push onto the buffer.
 * @returns {void}
 */
const pushMultiple = (buffer, ...items) => { buffer.push(...items); };
const p = pushMultiple;

// Initialize buffers (c1/c2 created here, layers register them in play.js)
const c1 = new CSVBuffer('primary');
const c2 = new CSVBuffer('poly');
/** @type {CSVBuffer} */ c = (typeof c !== 'undefined') ? c : c1;  // Active buffer reference (naked global)
// ensure a naked global c exists and references c1 (preserve legacy behavior)
if (typeof c === 'undefined') c = c1;


const { logUnit } = require('./logUnit');



/**
 * Outputs separate MIDI files for each layer with automatic synchronization.
 * @description
 * Architecture:
 * - output1.csv/mid: Primary layer with its syncFactor
 * - output2.csv/mid: Poly layer with independent syncFactor
 * - output3.csv/mid+: Additional layers (when added)
 * - Phrase boundaries align perfectly in absolute time (seconds)
 * - Tick counts differ due to different tempo adjustments
 * - Automatically handles any number of layers
 * @returns {void}
 */
grandFinale = () => {

  // REMOVED: Remove any stale CSV outputs for layers that are not currently registered
  // ANTI-PATTERN: DO NOT ADD POSTFIXES FOR CRITICAL ERRORS, INSTEAD RAISE A LOGGED FATAL ERROR AND HANDLE IT IN SOURCE GENERATION.
  // Compatibility shim: honor test harness (pull from test hooks when present)
  try {
    if (TEST && typeof TEST.LM !== 'undefined') LM = TEST.LM;
    if (TEST && typeof TEST.fs !== 'undefined') fs = TEST.fs;
    if (TEST && typeof TEST.allNotesOff !== 'undefined') allNotesOff = TEST.allNotesOff;
    if (TEST && typeof TEST.muteAll !== 'undefined') muteAll = TEST.muteAll;
  } catch (_e) { /* swallow */ }
  const LMCurrent = (typeof LM !== 'undefined' && LM) ? LM : { layers: {} };
  // Collect all layer data
  const layerData = Object.entries(LMCurrent.layers || {}).map(([name, layer]) => {
    return {
      name,
      layer: layer.state,
      buffer: layer.buffer instanceof CSVBuffer ? layer.buffer.rows : layer.buffer
    };
  });

  // Before processing layers, validate primary CSV for postfix anti-patterns (human-only markers)
  const primaryCsv = require('path').join(process.cwd(), 'output', 'output1.csv');
  let primaryHasUnitRec = false;
  if (fs.existsSync(primaryCsv)) {
    const txt = fs.readFileSync(primaryCsv, 'utf8') || '';
    const lines = txt.split(new RegExp('\r?\n'));
    // Human-only marker detection: detect lines without canonical unitRec tokens.
    // Only treat this as an anti-pattern if the file contains *some* canonical unitRec markers
    // (i.e. a mix of canonical and human-only markers), which indicates an unintended postfix-only entry.
    primaryHasUnitRec = lines.some(ln => ln && ln.indexOf('marker_t') !== -1 && ln.indexOf('unitRec:') !== -1);
    const humanOnlyExists = lines.some(ln => ln && ln.indexOf('marker_t') !== -1 && ln.indexOf('unitRec:') === -1);
  }

  // Expose flag for per-layer checks via a local variable in closure
  layerData.forEach(({ name, layer: layerState, buffer }) => {
    // attach flag to layerState for downstream checks
    try { layerState._primaryHasUnitRec = primaryHasUnitRec; } catch (_e) { /* swallow */ }

    // Set naked global buffer `c` to this layer's buffer
    c = buffer;
    // Cleanup - use naked global fallbacks to avoid load-order issues in tests
    try {
      const _allNotesOff = (typeof allNotesOff === 'function') ? allNotesOff : (()=>{});
      const _muteAll = (typeof muteAll === 'function') ? muteAll : (()=>{});
      _allNotesOff((layerState.sectionEnd || layerState.sectionStart) + PPQ);
      _muteAll((layerState.sectionEnd || layerState.sectionStart) + PPQ * 2);
    } catch (e) { /* swallow */ }
    // Finalize buffer
    if (!Array.isArray(buffer)) {
      try { writeDebugFile('writer-debug.ndjson', { tag: 'bad-buffer', name, bufferType: Object.prototype.toString.call(buffer), sample: (buffer && buffer.rows && Array.isArray(buffer.rows)) ? buffer.rows.slice(0,5) : buffer }); } catch (_e) { /* swallow */ }
      buffer = Array.isArray(buffer && buffer.rows) ? buffer.rows : (Array.isArray(buffer) ? buffer : []);
    }
    buffer = buffer.filter(i => i !== null)
      .map(i => {
        const rawTick = i && i.tick;
        let tickNum = null;
        let unitHash = null;
          // Keep original behavior: parse rawTick field first (may include appended '|<unitId>')
          if (typeof rawTick === 'string' && rawTick.indexOf('|') !== -1) {
            const p = String(rawTick).split('|');
            tickNum = Number(p[0]);
            // Preserve the full trailing unit id (it may contain '|' separators)
            unitHash = p.slice(1).join('|') || null;
            // Validate canonical unit id suffix: must contain section/phrase tokens and tick range markers
            if (unitHash) {
              let hasSecOrPhr = false; let hasTickRange = false;
              try {
                const seg = String(unitHash).split('|');
                hasSecOrPhr = seg.some(s => /^section\d+/i.test(s) || /^phrase\d+/i.test(s));
                hasTickRange = seg.some(s => /^\d+-\d+$/.test(s) || /^\d+\.\d+-\d+\.\d+$/.test(s));
              } catch (_e) { /* swallow parsing errors */ }
              // DEBUG LOG
              try { console.log('[writer] validating unitHash', { rawTick, unitHash, hasSecOrPhr, hasTickRange, layer: name }); } catch (_e) { /* swallow */ }
              if (!hasSecOrPhr || !hasTickRange) {
                // allow raiseCritical to throw (do not swallow)
                raiseCritical('malformed:unitIdSuffix', 'Malformed unit id suffix in tick field; expected canonical unitRec-like path', { rawTick, unitHash, layer: name });
              }
            }
          } else if (Number.isFinite(rawTick)) {
            tickNum = Number(rawTick);
          } else if (typeof rawTick === 'string') {
            tickNum = Number(rawTick);
          }
        let tickVal = Number.isFinite(tickNum) ? tickNum : Math.abs(Number(rawTick) || 0) * rf(.1, .3);
        if (!Number.isFinite(tickVal) || tickVal < 0) tickVal = 0;
        tickVal = Math.round(tickVal);
        const preservedFinal = unitHash || (i && i._unitHash) || null;
        return { ...i, tick: tickVal, _tickSortKey: tickVal, _unitHash: preservedFinal, _tickRaw: rawTick };
      })
      .sort((a, b) => (a._tickSortKey || 0) - (b._tickSortKey || 0));

    // Collect annotated units from layer state (logUnit stores them there)
    const unitsForLayer = [];
    try {
      if (layerState && Array.isArray(layerState.units)) {
        layerState.units.forEach(u => {
          const parts = Array.isArray(u.parts) ? u.parts.filter(Boolean) : (u.parts ? [u.parts] : []);
          const start = Number(u.startTick || u.start || 0);
          const end = Number(u.endTick || u.end || 0);
          const startTime = Number(u.startTime || u.startingTime || 0);
          const endTime = Number(u.endTime || u.endingTime || 0);
          // Always include the layer name as the first segment of the canonical unit id so CSV tokens are unambiguous
          const partsJoined = parts.length ? parts.join('|') : '';
          const uid = `${name || 'primary'}${partsJoined ? ('|' + partsJoined) : ''}|${Math.round(start)}-${Math.round(end)}|${(startTime||0).toFixed(6)}-${(endTime||0).toFixed(6)}`;
          unitsForLayer.push({ unitId: uid, layer: name, startTick: start, endTick: end, startTime, endTime, raw: u });
        });
      }
    } catch (_e) { /* swallow */ }



    // Add any unitRec markers present in the buffer into unitsForLayer (extract full unitId when available)
    try {
      for (const evt of buffer) {
        try {
          if (!evt || typeof evt !== 'object') continue;
          if (String(evt.type).toLowerCase() === 'marker_t' && Array.isArray(evt.vals)) {
            const m = evt.vals.find(v => String(v).includes('unitRec:')) || null;
            if (m) {
              try {
                const mo = String(m).match(/unitRec:([^\s,]+)/);
                const fullId = mo ? mo[1] : null;
                if (fullId) {
                  const seg = fullId.split('|');
                  const last = seg[seg.length - 1] || '';
                  const secondLast = seg[seg.length - 2] || '';
                  let sTick = undefined; let eTick = undefined; let sTime = undefined; let eTime = undefined;
                  if (secondLast && secondLast.includes('-') && /^[0-9]+-[0-9]+$/.test(secondLast)) {
                    const r = secondLast.split('-'); sTick = Number(r[0]); eTick = Number(r[1]);
                  }
                  if (last && last.includes('-') && /^[0-9]+\.[0-9]+-[0-9]+\.[0-9]+$/.test(last)) {
                    const rs = last.split('-'); sTime = Number(rs[0]); eTime = Number(rs[1]);
                  }
                  unitsForLayer.push({ unitId: fullId, layer: name, startTick: sTick, endTick: eTick, startTime: sTime, endTime: eTime, raw: { fromMarker: true } });
                }
              } catch (_e) { /* swallow */ }
            }
          }
        } catch (_e) { /* swallow */ }
      }
    } catch (_e) { /* swallow */ }

    // If primary CSV contained canonical unitRec markers but this layer has none, treat as postfix anti-pattern
    // For test harnesses allow opting out via TEST.allowMissingLayerCanonical = true
    const _enforceLayerCanonical = !(TEST && TEST.allowMissingLayerCanonical === true);
    if (_enforceLayerCanonical && name !== 'primary' && layerState && layerState._primaryHasUnitRec && (!unitsForLayer || unitsForLayer.length === 0)) {
      raiseCritical('missing:canonical:layer', 'Missing canonical unitRec entries for layer despite primary CSV containing unitRec markers', { layer: name });
    }

    // Backfill _unitHash for events that did not receive it during normalization by consulting unitsForLayer ranges
    try {
      buffer.forEach(evt => {
        try {
          if (!evt || typeof evt !== 'object') return;
          if (evt._unitHash) return;
          const t = Number.isFinite(Number(evt._tickSortKey)) ? Math.round(Number(evt._tickSortKey)) : null;
          if (t === null) return;
          // Prefer exact-containing, smallest-span unit
          let candidates = (unitsForLayer || []).filter(u => {
            const s = Number(u.startTick || 0);
            const e = Number(u.endTick || 0);
            return Number.isFinite(s) && Number.isFinite(e) && (t >= s && t <= e);
          });
          if (!candidates.length) {
            // broaden search slightly (+/-1 tick) to tolerate rounding/edge cases
            candidates = (unitsForLayer || []).filter(u => {
              const s = Number(u.startTick || 0);
              const e = Number(u.endTick || 0);
              return Number.isFinite(s) && Number.isFinite(e) && (t >= (s - 1) && t <= (e + 1));
            });
          }
          if (candidates.length) {
            // Prefer smallest span (most granular) but if spans tie, prefer units with more path segments
            candidates.sort((a, b) => {
              const spanA = Number(a.endTick || 0) - Number(a.startTick || 0);
              const spanB = Number(b.endTick || 0) - Number(b.startTick || 0);
              if (spanA !== spanB) return spanA - spanB;
              const partsA = String(a.unitId || '').split('|').length;
              const partsB = String(b.unitId || '').split('|').length;
              return partsB - partsA; // prefer more parts
            });
            const found = candidates[0];
            if (found && found.unitId) evt._unitHash = found.unitId;
          }
        } catch (_e) { /* swallow */ }
      });
    } catch (_e) { /* swallow */ }

    // Generate CSV
    let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
    let finalTick = -Infinity;

    // Build helper to find containing unit and to fallback to last unit when necessary
    const findUnitForTick = (tickNum) => {
      const tickInt = Math.round(Number(tickNum) || 0);
      const candidates = unitsForLayer
        .filter(uu => Number.isFinite(Number(uu.startTick)) && Number.isFinite(Number(uu.endTick)) && (tickInt >= Math.round(Number(uu.startTick)) && tickInt <= Math.round(Number(uu.endTick))))
        .map(uu => ({ ...uu, span: Math.round(Number(uu.endTick) - Number(uu.startTick)), partsCount: (String(uu.unitId || '').split('|').length) }));
      if (candidates.length) {
        // Prefer smallest span (most granular); on ties prefer entries with more path segments
        candidates.sort((a, b) => {
          if (a.span !== b.span) return a.span - b.span;
          return b.partsCount - a.partsCount;
        });
        return candidates[0];
      }
      return null;
    };

    const lastUnit = unitsForLayer.length ? unitsForLayer.reduce((a, b) => (Number(a.endTick) > Number(b.endTick) ? a : b)) : null;
    const emittedUnitRec = new Set();

    // Detect orphan events after the last known unit and create a single "layer[number]outro" virtual unit
    let outroUnit = null;
    try {
      const lastEnd = lastUnit ? Number(lastUnit.endTick) : -Infinity;
      const maxEventTick = buffer.reduce((m, i) => Math.max(m, Number(i && i.tick) || -Infinity), -Infinity);
      // Prefer the layer's last explicit marker_t tick when available (authoritative) to determine projected end.
      let lastMarkerTick = null;
      try { lastMarkerTick = buffer.slice().reverse().find(l => l && String(l.type).toLowerCase() === 'marker_t') ? Number(buffer.slice().reverse().find(l => l && String(l.type).toLowerCase() === 'marker_t').tick) : null; } catch (_e) { /* swallow */ }
      const baseTickForProjection = (Number.isFinite(lastMarkerTick) ? lastMarkerTick : (Number.isFinite(maxEventTick) ? maxEventTick : -Infinity));
      const projectedEndTick = Number.isFinite(baseTickForProjection) ? Math.round(baseTickForProjection + (SILENT_OUTRO_SECONDS * (layerState && layerState.tpSec || 0))) : -Infinity;
      const orphanTicks = buffer
        .map(i => ({ tickNum: i && i.tick, tickInt: Math.round(Number(i && i.tick) || 0) }))
        .filter(i => Number.isFinite(i.tickInt) && !findUnitForTick(i.tickInt) && i.tickInt >= lastEnd)
        .map(i => i.tickInt);
      // Include the projected end_track tick so the outro region will cover it
      if (Number.isFinite(projectedEndTick) && projectedEndTick >= lastEnd) orphanTicks.push(projectedEndTick);
      if (orphanTicks.length) {
        const minTick = Math.min(...orphanTicks);
        const maxTick = Math.max(...orphanTicks);
        const layerNum = name === 'primary' ? 1 : name === 'poly' ? 2 : 0;
        const outroKey = `layer${layerNum}outro`;
        const outroId = `${outroKey}|${minTick}-${maxTick}`;
        outroUnit = { unitId: outroId, layer: name, startTick: minTick, endTick: maxTick, startTime: 0, endTime: 0, raw: { outro: true } };
        unitsForLayer.push(outroUnit);
        // Register synthesized outro with MasterMap so it appears in the manifest for downstream validation
        try { const MasterMap = require('./masterMap'); MasterMap.addUnit({ parts: [outroId], layer: name, startTick: minTick, endTick: maxTick, startTime: 0, endTime: 0, raw: { outro: true } }); } catch (_e) { /* swallow */ }
        // Add a marker event into the buffer so it will be sorted numerically with other events
        try { buffer.push({ tick: minTick, type: 'marker_t', vals: [`unitRec:${outroId}`], _tickSortKey: Math.round(minTick) }); } catch (_e) { /* swallow */ }
        try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) { /* swallow */ }
        emittedUnitRec.add(outroId);
      }
    } catch (e) { /* swallow */ }

    buffer.forEach(_ => {
      if (!isNaN(_.tick)) {
        let type = _.type === 'on' ? 'note_on_c' : (_.type || 'note_off_c');
        const tickNum = _.tick || 0;
        const tickInt = Math.round(Number(tickNum) || 0);

        // Find the best containing unit; prefer most granular (smallest span)
        let unitMatch = findUnitForTick(tickNum);

        // If no containing unit and an outro unit exists that covers trailing events, attach to it.
        if (!unitMatch && outroUnit && (tickInt >= Number(outroUnit.startTick) && tickInt <= Number(outroUnit.endTick))) {
          unitMatch = outroUnit;
        }

        // Append unit id to tick field when available
        const chosenUnit = unitMatch ? unitMatch.unitId : (_._unitHash ? String(_._unitHash) : null);
        const chosenClean = chosenUnit ? String(chosenUnit).replace(/^\|+/, '') : null;
        const chosenValid = chosenClean && (chosenClean.includes('|') || chosenClean.includes('-') || /section|phrase|measure|beat/i.test(chosenClean));
        const isMarker = String(type).toLowerCase() === 'marker_t' || String(type).toLowerCase().includes('marker');
        const tickNumRound = Math.round(Number(tickNum) || 0);
        // For non-marker events, append unit identity using the same path used in unitRec markers (no 'unitRec:' prefix in the tick field)
        const tickField = (!isMarker && chosenValid) ? `${tickNumRound}|${chosenClean}` : `${tickNumRound}`;
        composition += `1,${tickField},${type},${_.vals.join(',')}\n`;

        finalTick = Math.max(finalTick, tickNum, tickInt);

      }
    });

    // Compute a safe numeric end tick using lastUnit/outroUnit when available; avoid tpSec-based calculations that can be NaN in tests
    const safeFinalTick = Number.isFinite(finalTick) && finalTick !== -Infinity ? Math.round(finalTick) : NaN;
    let computedEndTick = Number.isFinite(safeFinalTick) ? safeFinalTick : NaN;
    try {
      const lastEnd = lastUnit ? Number(lastUnit.endTick) : NaN;
      // Prefer lastUnit's end if it exists
      if (!Number.isFinite(computedEndTick) && Number.isFinite(lastEnd)) computedEndTick = Math.round(lastEnd);
      // If we have an outroUnit in memory, use its bounds instead of deriving from tpSec
      if (outroUnit && (Number.isFinite(outroUnit.startTick) || Number.isFinite(outroUnit.endTick))) {
        const oStart = Number.isFinite(outroUnit.startTick) ? Math.round(outroUnit.startTick) : null;
        const oEnd = Number.isFinite(outroUnit.endTick) ? Math.round(outroUnit.endTick) : null;
        // ensure computedEndTick covers the outro
        if (oEnd !== null) computedEndTick = Math.max(computedEndTick || -Infinity, oEnd);
        else if (oStart !== null) computedEndTick = Math.max(computedEndTick || -Infinity, oStart);
      }

      // If still undefined, fall back to 0 to ensure determinism
      if (!Number.isFinite(computedEndTick)) computedEndTick = 0;

      // When there is no outroUnit but we have a lastUnit and no outro, synthesize an outro marker at computedEndTick
      if (!outroUnit && lastUnit && Number.isFinite(computedEndTick) && computedEndTick >= Number(lastUnit.endTick || 0)) {
        const layerNum = name === 'primary' ? 1 : name === 'poly' ? 2 : 0;
        const outroKey = `layer${layerNum}outro`;
        const outroId = `${outroKey}|${computedEndTick}-${computedEndTick}`;
        outroUnit = { unitId: outroId, layer: name, startTick: computedEndTick, endTick: computedEndTick, startTime: 0, endTime: 0, raw: { outro: true } };
        unitsForLayer.push(outroUnit);
        try { buffer.push({ tick: computedEndTick, type: 'marker_t', vals: [`unitRec:${outroId}`], _tickSortKey: Math.round(computedEndTick) }); } catch (_e) { /* swallow */ }
        try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) { /* swallow */ }
        emittedUnitRec.add(outroId);
      } else if (outroUnit && Number.isFinite(computedEndTick) && computedEndTick > Number(outroUnit.endTick || -Infinity)) {
        // extend existing outro unit
        const base = String(outroUnit.unitId).split('|')[0];
        const newId = `${base}|${Math.round(outroUnit.startTick)}-${computedEndTick}`;
        outroUnit.unitId = newId;
        outroUnit.endTick = computedEndTick;
        try { buffer.push({ tick: Math.round(outroUnit.startTick), type: 'marker_t', vals: [`unitRec:${newId}`], _tickSortKey: Math.round(outroUnit.startTick) }); } catch (_e) { /* swallow */ }
        try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) { /* swallow */ }
        emittedUnitRec.add(newId);
      }

      // Ensure there is always a tail unitRec marker at endTick. Prefer existing outroUnit or lastUnit if present, otherwise synthesize a final marker.
      try {
        const layerNum = name === 'primary' ? 1 : name === 'poly' ? 2 : 0;
        let finalId = null;
        if (outroUnit && outroUnit.unitId) finalId = outroUnit.unitId;
        else if (lastUnit && lastUnit.unitId) finalId = lastUnit.unitId;
        else finalId = `layer${layerNum}final|${endTick}-${endTick}`;

        // Compute a target end time in seconds derived from primary's last marker when available to maintain global sync.
        let targetEndSec = null;
        try {
          const primaryCsv = path.join(process.cwd(), 'output', 'output1.csv');
          if (fs.existsSync(primaryCsv)) {
            const ptxt = fs.readFileSync(primaryCsv, 'utf8').split(new RegExp('\\r?\\n')).reverse();
            for (const ln of ptxt) {
              if (!ln || ln.indexOf('marker_t') === -1) continue;
              const parts = ln.split(',');
              const val = parts.slice(3).join(',');
              // Prefer unitRec seconds suffix
              const mUnitSec = String(val).match(/unitRec:[^\s,]+\|([0-9]+\.[0-9]+-[0-9]+\.[0-9]+)/);
              if (mUnitSec) { const r = mUnitSec[1].split('-'); targetEndSec = Number(r[1]); break; }
              // Otherwise use parenthetical times if present
              const mPhrase = String(val).match(/\(([^)]+)\s*-\s*([^)]+)\)/);
              if (mPhrase) {
                const endStr = String(mPhrase[2]).trim();
                const mm = Number(endStr.split(':')[0]) || 0; const ss = Number(endStr.split(':')[1]) || 0;
                targetEndSec = mm * 60 + ss; break;
              }
            }
          }
        } catch (_e) { /* swallow */ }

        if (finalId && !emittedUnitRec.has(finalId)) {
          // Determine tail tick: if we have a primary targetEndSec and this is not the primary layer,
          // convert it into this layer's tick space using this layer's tpSec; otherwise fall back to local endTick logic
          let tailTick;
          if (name !== 'primary' && Number.isFinite(targetEndSec) && Number.isFinite(layerState.tpSec)) {
            tailTick = Math.round(Number(targetEndSec) * Number(layerState.tpSec));
          } else {
            tailTick = Math.round(Number((lastUnit && lastUnit.endTick) || endTick));
          }

          try { buffer.push({ tick: tailTick, type: 'marker_t', vals: [`unitRec:${finalId}`], _tickSortKey: tailTick }); } catch (_e) { /* swallow */ }
          try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) { /* swallow */ }
          emittedUnitRec.add(finalId);
          // If we synthesized a finalId (no lastUnit/outro), add a minimal unit entry for auditing
          if (!lastUnit && !outroUnit) {
            const synth = { unitId: finalId, layer: name, startTick: tailTick, endTick: tailTick, startTime: 0, endTime: 0, raw: { synthesized: true } };
            unitsForLayer.push(synth);
            // Also register synthesized final unit in MasterMap for manifest consistency
            try { const MasterMap = require('./masterMap'); MasterMap.addUnit({ parts: [finalId], layer: name, startTick: tailTick, endTick: tailTick, startTime: 0, endTime: 0, raw: { synthesized: true } }); } catch (_e) { /* swallow */ }
          }
        }
      } catch (_e) { /* swallow */ }

    } catch (e) { /* swallow */ }

    // Use computedEndTick and append the unit id (no 'unitRec:' prefix) for the end_track field
    const endUnitId = (outroUnit && outroUnit.unitId) ? outroUnit.unitId : (lastUnit && lastUnit.unitId) ? lastUnit.unitId : null;
    const endTickField = endUnitId ? `${Math.round(computedEndTick || 0)}|${endUnitId}` : `${Math.round(computedEndTick || 0)}`;
    composition += `1,${endTickField},end_track`;

    // Determine output filename based on layer name
    let outputFilename;
    if (name === 'primary') {
      outputFilename = 'output/output1.csv';
    } else if (name === 'poly') {
      outputFilename = 'output/output2.csv';
    } else {
      // For additional layers, use name-based numbering
      outputFilename = `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    }

    // Ensure output directory exists and prefer test-provided global fs when present
    const path = require('path');
    const outputDir = path.dirname(outputFilename);
    const _G = (function(){ try { return Function('return this')(); } catch (e) { return {}; } })();
    const effectiveFs = (typeof _G.fs !== 'undefined') ? _G.fs : ((typeof fs !== 'undefined') ? fs : require('fs'));
    if (!effectiveFs.existsSync(outputDir)) {
      effectiveFs.mkdirSync(outputDir, { recursive: true });
    }

    effectiveFs.writeFileSync(outputFilename, composition);
    console.log(`Wrote file: ${outputFilename}`);
    try { writeDebugFile('writer.ndjson', { tag: 'file-created', outputFilename, layer: name }); } catch (e) { /* swallow */ }

  });

  // Finalize master unit map (write canonical unitMasterMap.json atomically)
  try { const MasterMap = require('./masterMap'); MasterMap.finalize(); } catch (e) { /* swallow */ }

};

/**
 * Node.js filesystem module with wrapped writeFileSync for error logging.
 * @type {Object}
 */
// Wrap writeFileSync to log errors centrally
try {
  const _origWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function(...args) {
    try {
      return _origWriteFileSync.apply(fs, args);
    } catch (err) {
      console.error('Failed to write', args[0] || '', err);
      throw err;
    }
  };
} catch (err) {
  console.error('Failed to wrap fs.writeFileSync:', err);
}

// Explicit module exports for direct importing by tests/tools. Do NOT mutate globals here.
module.exports = { p, CSVBuffer, logUnit, grandFinale };
