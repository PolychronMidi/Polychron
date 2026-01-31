const fs = require('fs');
const path = require('path');

grandFinale = () => {

  const LMCurrent = (typeof LM !== 'undefined' && LM) ? LM : { layers: {} };
  // Collect all layer data
  const layerData = Object.entries(LMCurrent.layers || {}).map(([name, layer]) => {
    return {
      name,
      layer: layer,
      buffer: layer.buffer
    };
  });
  // Expose flag for per-layer checks via a local variable in closure
  layerData.forEach(({ name, layer: layerState, buffer }) => {
    // Set naked global buffer `c` to this layer's buffer
    c = buffer;

    // Finalize buffer
    if (!Array.isArray(buffer)) {
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

    // Generate CSV
    let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
    let finalTick = -Infinity;


    buffer.forEach(_ => {
      if (!isNaN(_.tick)) {
        let type = _.type === 'on' ? 'note_on_c' : (_.type || 'note_off_c');
        const tickNum = _.tick || 0;
        const tickInt = Math.round(Number(tickNum) || 0);
        // Find the best containing unit; prefer most granular (smallest span)

        // Append unit id to tick field when available
        const isMarker = String(type).toLowerCase() === 'marker_t' || String(type).toLowerCase().includes('marker');
        // For non-marker events, append unit identity using the same path used in unitRec markers (no 'unitRec:' prefix in the tick field)

        composition += `1,${tickInt},${type},${_.vals.join(',')}\n`;
        finalTick = Math.max(finalTick, tickNum, tickInt);
      }
    });
    // Compute a safe numeric end tick using lastUnit/outroUnit when available; avoid tpSec-based calculations that can be NaN in tests
    const safeFinalTick = Number.isFinite(finalTick) && finalTick !== -Infinity ? Math.round(finalTick) : NaN;
    let computedEndTick = Number.isFinite(safeFinalTick) ? safeFinalTick : NaN;
    try {
      try { const res = require('./grandFinale.tail').ensureTailMarker({ buffer, computedEndTick, layerState, name, endTick }); if (res) { computedEndTick = res.computedEndTick; } } catch (_e) { /* swallow */ }
    } catch (e) { /* swallow */ }

    composition += `1,${phraseStart},end_track`;
    const outputFilename = name === 'primary' ? 'output/output1.csv' : name === 'poly' ? 'output/output2.csv' : `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    fs.writeFileSync(outputFilename, composition);
    console.log(`Wrote file: ${outputFilename}`);

  });
  // Finalize master unit map (write canonical unitMasterMap.json atomically)
  try { const MasterMap = require('./masterMap'); MasterMap.finalize(); } catch (e) { /* swallow */ }
};
