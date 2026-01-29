const fs = require('fs');
const path = require('path');
const { writeDebugFile } = require('./logGate');
const { raiseCritical } = require('./postfixGuard');
const TEST = require('./test-hooks');

module.exports = function grandFinale() {
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
      buffer: (layer.buffer && Array.isArray(layer.buffer.rows)) ? layer.buffer.rows : layer.buffer
    };
  });

  const primaryCsv = path.join(process.cwd(), 'output', 'output1.csv');
  let primaryHasUnitRec = false;
  if (fs.existsSync(primaryCsv)) {
    const txt = fs.readFileSync(primaryCsv, 'utf8') || '';
    const lines = txt.split(new RegExp('\r?\n'));
    primaryHasUnitRec = lines.some(ln => ln && ln.indexOf('marker_t') !== -1 && ln.indexOf('unitRec:') !== -1);
    const humanOnlyExists = lines.some(ln => ln && ln.indexOf('marker_t') !== -1 && ln.indexOf('unitRec:') === -1);
  }

  layerData.forEach(({ name, layer: layerState, buffer }) => {
    try { layerState._primaryHasUnitRec = primaryHasUnitRec; } catch (_e) { /* swallow */ }

    // Set naked global buffer `c` to this layer's buffer
    c = buffer;
    try {
      const _allNotesOff = (typeof allNotesOff === 'function') ? allNotesOff : (()=>{});
      const _muteAll = (typeof muteAll === 'function') ? muteAll : (()=>{});
      _allNotesOff((layerState.sectionEnd || layerState.sectionStart) + PPQ);
      _muteAll((layerState.sectionEnd || layerState.sectionStart) + PPQ * 2);
    } catch (e) { /* swallow */ }

    if (!Array.isArray(buffer)) {
      try { writeDebugFile('writer-debug.ndjson', { tag: 'bad-buffer', name, bufferType: Object.prototype.toString.call(buffer), sample: (buffer && buffer.rows && Array.isArray(buffer.rows)) ? buffer.rows.slice(0,5) : buffer }); } catch (_e) { /* swallow */ }
      buffer = Array.isArray(buffer && buffer.rows) ? buffer.rows : (Array.isArray(buffer) ? buffer : []);
    }
    buffer = buffer.filter(i => i !== null)
      .map(i => {
        const rawTick = i && i.tick;
        let tickNum = null;
        let unitHash = null;
        if (typeof rawTick === 'string' && rawTick.indexOf('|') !== -1) {
          const p = String(rawTick).split('|');
          tickNum = Number(p[0]);
          unitHash = p.slice(1).join('|') || null;
          if (unitHash) {
            let hasSecOrPhr = false; let hasTickRange = false;
            try {
              const seg = String(unitHash).split('|');
              hasSecOrPhr = seg.some(s => /^section\d+/i.test(s) || /^phrase\d+/i.test(s));
              hasTickRange = seg.some(s => /^\d+-\d+$/.test(s) || /^\d+\.\d+-\d+\.\d+$/.test(s));
            } catch (_e) { /* swallow parsing errors */ }
            try { console.log('[writer] validating unitHash', { rawTick, unitHash, hasSecOrPhr, hasTickRange, layer: name }); } catch (_e) { /* swallow */ }
            if (!hasSecOrPhr || !hasTickRange) {
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

    const unitsForLayer = [];
    try {
      if (layerState && Array.isArray(layerState.units)) {
        layerState.units.forEach(u => {
          const parts = Array.isArray(u.parts) ? u.parts.filter(Boolean) : (u.parts ? [u.parts] : []);
          const start = Number(u.startTick || u.start || 0);
          const end = Number(u.endTick || u.end || 0);
          const startTime = Number(u.startTime || u.startingTime || 0);
          const endTime = Number(u.endTime || u.endingTime || 0);
          const partsJoined = parts.length ? parts.join('|') : '';
          const uid = `${name || 'primary'}${partsJoined ? ('|' + partsJoined) : ''}|${Math.round(start)}-${Math.round(end)}|${(startTime||0).toFixed(6)}-${(endTime||0).toFixed(6)}`;
          unitsForLayer.push({ unitId: uid, layer: name, startTick: start, endTick: end, startTime, endTime, raw: u });
        });
      }
    } catch (_e) { /* swallow */ }

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

    const _enforceLayerCanonical = !(TEST && TEST.allowMissingLayerCanonical === true);
    if (_enforceLayerCanonical && name !== 'primary' && layerState && layerState._primaryHasUnitRec && (!unitsForLayer || unitsForLayer.length === 0)) {
      raiseCritical('missing:canonical:layer', 'Missing canonical unitRec entries for layer despite primary CSV containing unitRec markers', { layer: name });
    }

    try {
      buffer.forEach(evt => {
        try {
          if (!evt || typeof evt !== 'object') return;
          if (evt._unitHash) return;
          const t = Number.isFinite(Number(evt._tickSortKey)) ? Math.round(Number(evt._tickSortKey)) : null;
          if (t === null) return;
          let candidates = (unitsForLayer || []).filter(u => {
            const s = Number(u.startTick || 0);
            const e = Number(u.endTick || 0);
            return Number.isFinite(s) && Number.isFinite(e) && (t >= s && t <= e);
          });
          if (!candidates.length) {
            candidates = (unitsForLayer || []).filter(u => {
              const s = Number(u.startTick || 0);
              const e = Number(u.endTick || 0);
              return Number.isFinite(s) && Number.isFinite(e) && (t >= (s - 1) && t <= (e + 1));
            });
          }
          if (candidates.length) {
            candidates.sort((a, b) => {
              const spanA = Number(a.endTick || 0) - Number(a.startTick || 0);
              const spanB = Number(b.endTick || 0) - Number(b.startTick || 0);
              if (spanA !== spanB) return spanA - spanB;
              return (String(b.unitId || '').split('|').length) - (String(a.unitId || '').split('|').length);
            });
            evt._unitHash = candidates[0].unitId;
          }
        } catch (_e) { /* swallow */ }
      });
    } catch (_e) { /* swallow */ }

    // Write per-layer CSVs
    try {
      if (!fs.existsSync(path.join(process.cwd(), 'output'))) fs.mkdirSync(path.join(process.cwd(), 'output'),{ recursive: true });
      const file = path.join(process.cwd(), 'output', `output${name === 'primary' ? '1' : (name === 'poly' ? '2' : ('_' + name))}.csv`);
      const lines = (buffer || []).map(r => {
        const vals = Array.isArray(r.vals) ? r.vals : (r.vals !== undefined ? [r.vals] : []);
        return [r.tick || 0, r.type || 'unknown', ...vals].join(',');
      });
      fs.writeFileSync(file, lines.join('\n'));
    } catch (_e) { /* swallow */ }
  });

  // Summary diagnostics
  try {
    const finished = { when: new Date().toISOString(), layers: Object.keys(LMCurrent.layers || {}).length };
    writeDebugFile('writer.ndjson', finished);
  } catch (_e) { /* swallow */ }
};

module.exports = { p, CSVBuffer, logUnit, grandFinale };
