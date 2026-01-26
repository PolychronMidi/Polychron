// writer.js - MIDI output and file generation with CSV buffer management.
// minimalist comments, details at: writer.md

/**
 * Layer-aware MIDI event buffer.
 * @class CSVBuffer
 * @param {string} name - Layer identifier ('primary', 'poly', etc.).
 * @property {string} name - Layer identifier.
 * @property {Array<object>} rows - MIDI event objects: {tick, type, vals}.
 * @property {number} length - Read-only count of events.
 */
CSVBuffer = class CSVBuffer {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  push(...items) {
    this.rows.push(...items);
  }
  get length() {
    return this.rows.length;
  }
  clear() {
    this.rows = [];
  }
};

/**
 * Push multiple items onto a buffer/array.
 * @param {CSVBuffer|Array} buffer - The target buffer to push onto.
 * @param {...*} items - Items to push onto the buffer.
 * @returns {void}
 */
p=pushMultiple=(buffer,...items)=>{  buffer.push(...items);  };

// Initialize buffers (c1/c2 created here, layers register them in play.js)
c1=new CSVBuffer('primary');
c2=new CSVBuffer('poly');
c=c1;  // Active buffer reference


/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 *
 * @param {string} type - Unit type: 'section', 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'
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
    meterInfo = midiMeter[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
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
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
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
    // Use defensively coerced indices/totals to avoid NaN/undefined emissions
    const sIndex = Number.isFinite(Number(subsubdivIndex)) ? Number(subsubdivIndex) : 0;
    unit = sIndex + 1;
    // Prefer canonical name `subsubdivsPerSub` but accept legacy `subsubsPerSub` if present
    unitsPerParent = Number.isFinite(Number(subsubdivsPerSub)) ? Number(subsubdivsPerSub) : (Number.isFinite(Number(subsubsPerSub)) ? Number(subsubsPerSub) : 1);
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
    // Ensure the emitted event tick and the embedded endTick agree
    c.push({
      tick: markerTick,
      type: 'marker_t',
      vals: [markerRaw]
    });
    // If there is ever a mismatch between human text and event tick, this should be a source bug; log lightly for diagnostics
    if (Number.isFinite(Number(endTick)) && Math.round(Number(endTick)) !== markerTick) {
      try { console.warn(`Marker tick normalized: original endTick=${endTick} → ${markerTick} (layer=${c && c.name})`); } catch (_e) {}
    }

    try {
      const parts = [];
      // Coerce totals to safe numeric defaults to avoid NaN/undefined in IDs
      const safe_totalSections = Number.isFinite(Number(totalSections)) ? Number(totalSections) : 1;
      const safe_phrasesPerSection = Number.isFinite(Number(phrasesPerSection)) ? Number(phrasesPerSection) : 1;
      const safe_measuresPerPhrase = Number.isFinite(Number(measuresPerPhrase)) ? Number(measuresPerPhrase) : 1;
      const safe_numerator = Number.isFinite(Number(numerator)) ? Number(numerator) : 1;
      const safe_divsPerBeat = Number.isFinite(Number(divsPerBeat)) ? Number(divsPerBeat) : 1;
      const safe_subdivsPerDiv = Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : 1;
      const safe_subsubdivsPerSub = Number.isFinite(Number(subsubdivsPerSub)) ? Number(subsubdivsPerSub) : (Number.isFinite(Number(subsubsPerSub)) ? Number(subsubsPerSub) : 1);
      if (typeof sectionIndex !== 'undefined') parts.push('section' + ((sectionIndex||0)+1) + '/' + safe_totalSections);
      if (typeof phraseIndex !== 'undefined') parts.push('phrase' + ((phraseIndex||0)+1) + '/' + safe_phrasesPerSection);
      if (typeof measureIndex !== 'undefined') parts.push('measure' + ((measureIndex||0)+1) + '/' + safe_measuresPerPhrase);
      if (typeof beatIndex !== 'undefined') parts.push('beat' + ((beatIndex||0)+1) + '/' + safe_numerator);
      if (typeof divIndex !== 'undefined') parts.push('division' + ((divIndex||0)+1) + '/' + safe_divsPerBeat);
      if (typeof subdivIndex !== 'undefined') parts.push('subdivision' + ((subdivIndex||0)+1) + '/' + safe_subdivsPerDiv);
      if (Number.isFinite(Number(subsubdivIndex))) parts.push('subsubdivision' + (Number(subsubdivIndex) + 1) + '/' + safe_subsubdivsPerSub);

      const startTickN = Math.round(Number(startTick) || 0);
      const endTickN = Math.round(Number(endTick) || 0);
      const startTimeN = Number(startTime) || 0;
      const endTimeN = Number(endTime) || 0;

      if ((c && c.name && typeof LM !== 'undefined' && LM.layers && LM.layers[c.name] && LM.layers[c.name].state) || (typeof LM !== 'undefined' && LM.activeLayer && LM.layers && LM.layers[LM.activeLayer] && LM.layers[LM.activeLayer].state)) {
        const st = (LM.layers[c && c.name && LM.layers[c.name] ? c.name : LM.activeLayer] && LM.layers[c && c.name && LM.layers[c.name] ? c.name : LM.activeLayer].state) ? LM.layers[c && c.name && LM.layers[c.name] ? c.name : LM.activeLayer].state : null;
        st.units = st.units || [];
        // If this is not the primary layer and primary units are present, copy primary unit times
        let finalStartTime = startTimeN;
        let finalEndTime = endTimeN;
        try {
          if (c.name !== 'primary' && LM.layers['primary'] && LM.layers['primary'].state && Array.isArray(LM.layers['primary'].state.units)) {
            const primUnits = LM.layers['primary'].state.units;
            // match by section/phrase tokens if possible
            const want = {};
            parts.forEach(p => {
              const m = String(p).match(/^(section\d+|phrase\d+)/i);
              if (m) want[m[1].toLowerCase()] = true;
            });
            const match = primUnits.find(u => {
              if (!Array.isArray(u.parts)) return false;
              const have = {};
              u.parts.forEach(pp => {
                const m = String(pp).match(/^(section\d+|phrase\d+)/i);
                if (m) have[m[1].toLowerCase()] = true;
              });
              // require both section and phrase tokens to match when present
              if (Object.keys(want).length === 0) return false;
              for (const k of Object.keys(want)) if (!have[k]) return false;
              return true;
            });
            if (match && match.startTime !== undefined) {
              finalStartTime = Number(match.startTime) || finalStartTime;
              finalEndTime = Number(match.endTime) || finalEndTime;
            }
          }
        } catch (e) {}
        st.units.push({ parts: parts.slice(), unitNumber: unit, unitsPerParent, startTick: startTickN, endTick: endTickN, startTime: finalStartTime, endTime: finalEndTime, type });
      }
    } catch (err) {}

  })();
};

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

  // Collect all layer data
  const layerData = Object.entries(LM.layers).map(([name, layer]) => {
    return {
      name,
      layer: layer.state,
      buffer: layer.buffer instanceof CSVBuffer ? layer.buffer.rows : layer.buffer
    };
  });

  // Process each layer's output
  layerData.forEach(({ name, layer: layerState, buffer }) => {
    c = buffer;
    // Cleanup
    allNotesOff((layerState.sectionEnd || layerState.sectionStart) + PPQ);
    muteAll((layerState.sectionEnd || layerState.sectionStart) + PPQ * 2);
    // Finalize buffer
    buffer = buffer.filter(i => i !== null)
      .map(i => {
        const rawTick = i && i.tick;
        let tickNum = null;
        let unitHash = null;
        try {
          // Keep original behavior: parse rawTick field first (may include appended '|<unitId>')
          if (typeof rawTick === 'string' && rawTick.indexOf('|') !== -1) {
            const p = String(rawTick).split('|');
            tickNum = Number(p[0]);
            // Preserve the full trailing unit id (it may contain '|' separators)
            unitHash = p.slice(1).join('|') || null;
          } else if (Number.isFinite(rawTick)) {
            tickNum = Number(rawTick);
          } else if (typeof rawTick === 'string') {
            tickNum = Number(rawTick);
          }
        } catch (_e) {}
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
          const parts = Array.isArray(u.parts) ? u.parts : (u.parts ? [u.parts] : []);
          const start = Number(u.startTick || u.start || 0);
          const end = Number(u.endTick || u.end || 0);
          const startTime = Number(u.startTime || u.startingTime || 0);
          const endTime = Number(u.endTime || u.endingTime || 0);
          const uid = `${parts.join('|')}|${Math.round(start)}-${Math.round(end)}|${(startTime||0).toFixed(6)}-${(endTime||0).toFixed(6)}`;
          unitsForLayer.push({ unitId: uid, layer: name, startTick: start, endTick: end, startTime, endTime, raw: u });
        });
      }
    } catch (_e) {}

    // Source-only canonicalization: If this is a non-primary layer and primary CSV exists,
    // use primary `marker_t` entries (which include canonical seconds) to compute ticks for this layer
    try {
      if (true) {
        const primCsv = (name === 'primary') ? path.join(process.cwd(), 'output', 'output1.csv') : (name === 'poly' ? path.join(process.cwd(), 'output', 'output2.csv') : path.join(process.cwd(), `output/output${name}.csv`));
        if (fs.existsSync(primCsv)) {
          try {
            const primTxt = fs.readFileSync(primCsv, 'utf8');
            const primLines = primTxt.split(new RegExp('\\r?\\n'));
            const canonicalMap = {}; // key -> { startSec, endSec, tick }
            for (const ln of primLines) {
              if (!ln || !ln.startsWith('1,')) continue;
              const parts = ln.split(',');
              if (parts.length < 4) continue;
              const t = parts[2];
              if (String(t).toLowerCase() !== 'marker_t') continue;
              const val = parts.slice(3).join(',');
              // Look for 'Section X/Y' or 'Phrase X/Y' markers with parenthetical times or unitRec token
              const mUnit = String(val).match(/unitRec:([^\s,]+)/);
              if (mUnit) {
                const full = mUnit[1];
                const seg = full.split('|');
                const sec = seg.find(s => /^section\d+/i.test(s)) || null;
                const phr = seg.find(s => /^phrase\d+/i.test(s)) || null;
                const ticksPart = seg[seg.length-2] || null; // startTick-endTick
                const secsPart = seg[seg.length-1] && seg[seg.length-1].includes('.') && seg[seg.length-1].includes('-') ? seg[seg.length-1] : null;
                if (sec && phr && secsPart) {
                  const sSec = Number(secsPart.split('-')[0]);
                  const eSec = Number(secsPart.split('-')[1]);
                  const key = `s${Number(sec.match(/(\d+)/)[1]) - 1}-p${Number(phr.match(/(\d+)/)[1]) - 1}`;
                  canonicalMap[key] = canonicalMap[key] || { startSec: sSec, endSec: eSec };
                }
              } else {
                // Try phrase/section human marker like 'Section 3/7 Length: ... (1:01.7965 - 1:01.7965) endTick: 2197500'
                const mPhrase = String(val).match(/Section\s*(\d+)\/(\d+).*\(([^\)]+)\s*-\s*([^\)]+)\)/i) || String(val).match(/Phrase\s*(\d+)\/./i);
                if (mPhrase && mPhrase.length >= 4) {
                  // parse parenthetical times as MM:SS.ssss
                  const startStr = mPhrase[3];
                  const endStr = mPhrase[4];
                  const parseHMS = (s) => {
                    const mm = Number(s.split(':')[0]);
                    const ss = Number(s.split(':')[1]) || 0;
                    return mm * 60 + ss;
                  };
                  const sSec = parseHMS(startStr.trim());
                  const eSec = parseHMS(endStr.trim());
                  // derive section/phrase indices from the string when possible
                  const secMatch = String(val).match(/Section\s*(\d+)\/(\d+)/i);
                  const phrMatch = String(val).match(/Phrase\s*(\d+)\/(\d+)/i);
                  if (secMatch && phrMatch) {
                    const key = `s${Number(secMatch[1]) - 1}-p${Number(phrMatch[1]) - 1}`;
                    canonicalMap[key] = canonicalMap[key] || { startSec: sSec, endSec: eSec };
                  }
                }
              }
            }
            // Apply canonicalMap to unitsForLayer when keys match
            for (const u of unitsForLayer) {
              try {
                const parsed = String(u.unitId).split('|');
                const secToken = parsed.find(p => /^section\d+/i.test(p));
                const phrToken = parsed.find(p => /^phrase\d+/i.test(p));
                if (!secToken || !phrToken) continue;
                const key = `s${Number(secToken.match(/(\d+)/)[1]) - 1}-p${Number(phrToken.match(/(\d+)/)[1]) - 1}`;
                const canon = canonicalMap[key];
                if (canon && Number.isFinite(canon.startSec) && Number.isFinite(canon.endSec) && Number.isFinite(layerState.tpSec) && layerState.tpSec !== 0) {
                  const newStart = Math.round(Number(canon.startSec) * Number(layerState.tpSec));
                  const newEnd = Math.round(Number(canon.endSec) * Number(layerState.tpSec));
                  u.startTick = newStart;
                  u.endTick = newEnd;
                  u.startTime = Number(canon.startSec);
                  u.endTime = Number(canon.endSec);
                }
              } catch (_e) {}
            }
          } catch (_e) {}
        }
      }
    } catch (_e) {}

    // Add any unitRec markers present in the buffer into unitsForLayer (extract full unitId when available)
    try {
      for (const evt of buffer) {
        try {
          if (!evt || typeof evt !== 'object') continue;
          if (String(evt.type).toLowerCase() === 'marker_t' && Array.isArray(evt.vals)) {
            const m = evt.vals.find(v => String(v).startsWith('unitRec:')) || null;
            if (m) {
              try {
                const fullId = String(m).split(':')[1];
                const seg = fullId.split('|');
                const last = seg[seg.length - 1] || '';
                const secondLast = seg[seg.length - 2] || '';
                let sTick = undefined; let eTick = undefined; let sTime = undefined; let eTime = undefined;
                if (secondLast && secondLast.includes('-') && /^[0-9]+\-[0-9]+$/.test(secondLast)) {
                  const r = secondLast.split('-'); sTick = Number(r[0]); eTick = Number(r[1]);
                }
                if (last && last.includes('-') && /^[0-9]+\.[0-9]+\-[0-9]+\.[0-9]+$/.test(last)) {
                  const rs = last.split('-'); sTime = Number(rs[0]); eTime = Number(rs[1]);
                }
                unitsForLayer.push({ unitId: fullId, layer: name, startTick: sTick, endTick: eTick, startTime: sTime, endTime: eTime, raw: { fromMarker: true } });
              } catch (_e) {}
            }
          }
        } catch (_e) {}
      }
    } catch (_e) {}

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
            candidates.sort((a, b) => (Number(a.endTick || 0) - Number(a.startTick || 0)) - (Number(b.endTick || 0) - Number(b.startTick || 0)));
            const found = candidates[0];
            if (found && found.unitId) evt._unitHash = found.unitId;
          }
        } catch (_e) {}
      });
    } catch (_e) {}

    // Generate CSV
    let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
    let finalTick = -Infinity;

    // Build helper to find containing unit and to fallback to last unit when necessary
    const findUnitForTick = (tickNum) => {
      const tickInt = Math.round(Number(tickNum) || 0);
      const candidates = unitsForLayer
        .filter(uu => Number.isFinite(Number(uu.startTick)) && Number.isFinite(Number(uu.endTick)) && (tickInt >= Math.round(Number(uu.startTick)) && tickInt <= Math.round(Number(uu.endTick))))
        .map(uu => ({ ...uu, span: Math.round(Number(uu.endTick) - Number(uu.startTick)) }));
      if (candidates.length) {
        candidates.sort((a, b) => a.span - b.span);
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
      try { lastMarkerTick = buffer.slice().reverse().find(l => l && String(l.type).toLowerCase() === 'marker_t') ? Number(buffer.slice().reverse().find(l => l && String(l.type).toLowerCase() === 'marker_t').tick) : null; } catch (_e) {}
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
        // Add a marker event into the buffer so it will be sorted numerically with other events
        try { buffer.push({ tick: minTick, type: 'marker_t', vals: [`unitRec:${outroId}`], _tickSortKey: Math.round(minTick) }); } catch (_e) {}
        try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) {}
        emittedUnitRec.add(outroId);
      }
    } catch (e) {}

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
        const isMarker = String(type).toLowerCase() === 'marker_t' || String(type).toLowerCase().includes('marker');
        const tickNumRound = Math.round(Number(tickNum) || 0);
        const tickField = isMarker ? `${tickNumRound}` : (chosenClean ? `${tickNumRound}|${chosenClean}` : `${tickNumRound}`);
        composition += `1,${tickField},${type},${_.vals.join(',')}\n`;

        finalTick = Math.max(finalTick, tickNum, tickInt);

      }
    });

    const endTick = Math.round(finalTick + (SILENT_OUTRO_SECONDS * layerState.tpSec));
    try {
      const lastEnd = lastUnit ? Number(lastUnit.endTick) : -Infinity;
      if (!outroUnit && lastEnd !== -Infinity && endTick >= lastEnd) {
        const layerNum = name === 'primary' ? 1 : name === 'poly' ? 2 : 0;
        const outroKey = `layer${layerNum}outro`;
        const outroId = `${outroKey}|${endTick}-${endTick}`;
        outroUnit = { unitId: outroId, layer: name, startTick: endTick, endTick: endTick, startTime: 0, endTime: 0, raw: { outro: true } };
        unitsForLayer.push(outroUnit);
        try { buffer.push({ tick: endTick, type: 'marker_t', vals: [`unitRec:${outroId}`], _tickSortKey: Math.round(endTick) }); } catch (_e) {}
        try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) {}
        emittedUnitRec.add(outroId);
      } else if (outroUnit && endTick > Number(outroUnit.endTick)) {
        // extend the outro unit range and add an expanded unitRec marker for auditing
        const base = String(outroUnit.unitId).split('|')[0];
        const newId = `${base}|${Math.round(outroUnit.startTick)}-${endTick}`;
        outroUnit.unitId = newId;
        outroUnit.endTick = endTick;
        try { buffer.push({ tick: Math.round(outroUnit.startTick), type: 'marker_t', vals: [`unitRec:${newId}`], _tickSortKey: Math.round(outroUnit.startTick) }); } catch (_e) {}
        try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) {}
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
              const mPhrase = String(val).match(/\(([^(]+)\s*-\s*([^\)]+)\)/);
              if (mPhrase) {
                const endStr = String(mPhrase[2]).trim();
                const mm = Number(endStr.split(':')[0]) || 0; const ss = Number(endStr.split(':')[1]) || 0;
                targetEndSec = mm * 60 + ss; break;
              }
            }
          }
        } catch (_e) {}

        if (finalId && !emittedUnitRec.has(finalId)) {
          // Determine tail tick: if we have a primary targetEndSec and this is not the primary layer,
          // convert it into this layer's tick space using this layer's tpSec; otherwise fall back to local endTick logic
          let tailTick;
          if (name !== 'primary' && Number.isFinite(targetEndSec) && Number.isFinite(layerState.tpSec)) {
            tailTick = Math.round(Number(targetEndSec) * Number(layerState.tpSec));
          } else {
            tailTick = Math.round(Number((lastUnit && lastUnit.endTick) || endTick));
          }

          try { buffer.push({ tick: tailTick, type: 'marker_t', vals: [`unitRec:${finalId}`], _tickSortKey: tailTick }); } catch (_e) {}
          try { buffer.sort((A,B)=> (A._tickSortKey || Math.round(Number(A.tick)||0)) - (B._tickSortKey || Math.round(Number(B.tick)||0))); } catch (_e) {}
          emittedUnitRec.add(finalId);
          // If we synthesized a finalId (no lastUnit/outro), add a minimal unit entry for auditing
          if (!lastUnit && !outroUnit) {
            const synth = { unitId: finalId, layer: name, startTick: tailTick, endTick: tailTick, startTime: 0, endTime: 0, raw: { synthesized: true } };
            unitsForLayer.push(synth);
          }
        }
      } catch (_e) {}

    } catch (e) {}

    const endTickField = outroUnit ? `${endTick}|${outroUnit.unitId}` : (lastUnit && lastUnit.unitId ? `${endTick}|${lastUnit.unitId}` : `${endTick}`);
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

    // Ensure output directory exists
    const path = require('path');
    const outputDir = path.dirname(outputFilename);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputFilename, composition);
    console.log(`${outputFilename} created (${name} layer).`);

  });

  // Finalize master unit map (write canonical unitMasterMap.json atomically)
  try { const MasterMap = require('./masterMap'); MasterMap.finalize(); } catch (e) {}

};

/**
 * Node.js filesystem module with wrapped writeFileSync for error logging.
 * @type {Object}
 */
fs=require('fs');
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

// Export to globalThis test namespace for clean test access
if (typeof globalThis !== 'undefined') {
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  Object.assign(globalThis.__POLYCHRON_TEST__, { p });
}
