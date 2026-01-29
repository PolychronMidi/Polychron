// parseMarkersAndBackfill(buffer, unitsForLayer)
// Scans `buffer` for unitRec markers and backfills event._unitHash based on unitsForLayer.
// Mutates `unitsForLayer` and `buffer` in-place.

function parseMarkersAndBackfill(buffer, unitsForLayer, layerName = null) {
  try {
    for (const evt of buffer) {
      try {
        if (!evt || typeof evt !== 'object') continue;

        // Marker extraction: if this event is a unitRec marker, capture its full id and push into unitsForLayer
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
                unitsForLayer.push({ unitId: fullId, layer: layerName, startTick: sTick, endTick: eTick, startTime: sTime, endTime: eTime, raw: { fromMarker: true } });
              }
            } catch (_e) { /* swallow */ }
          }
        }

        // Backfill unit hash for this event if missing (use currently accumulated unitsForLayer which includes markers parsed above)
        if (!evt._unitHash) {
          const t = Number.isFinite(Number(evt._tickSortKey)) ? Math.round(Number(evt._tickSortKey)) : null;
          if (t === null) continue;
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
              const partsA = String(a.unitId || '').split('|').length;
              const partsB = String(b.unitId || '').split('|').length;
              return partsB - partsA; // prefer more parts
            });
            const found = candidates[0];
            if (found && found.unitId) evt._unitHash = found.unitId;
          }
        }
      } catch (_e) { /* swallow */ }
    }
  } catch (_e) { /* swallow */ }
}

module.exports = { parseMarkersAndBackfill };
