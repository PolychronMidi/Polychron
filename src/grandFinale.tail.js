// ensureTailMarker(args)
// Responsible for synthesized outro extension and final tail marker emission.
// Accepts an options object to avoid heavy dependencies and mutates buffer/unitsForLayer/emittedUnitRec.

function ensureTailMarker({ buffer, unitsForLayer, lastUnit, outroUnit, computedEndTick, emittedUnitRec, layerState, name, endTick, synthUnit, getPrimaryTargetEndSec }) {
  try {
    const lastEnd = lastUnit ? Number(lastUnit.endTick) : NaN;

    // When there is no outroUnit but we have a lastUnit and no outro, synthesize an outro marker at computedEndTick
    if (!outroUnit && lastUnit && Number.isFinite(computedEndTick) && computedEndTick >= Number(lastUnit.endTick || 0)) {
      const layerNum = name === 'primary' ? 1 : name === 'poly' ? 2 : 0;
      const outroKey = `layer${layerNum}outro`;
      const outroId = `${outroKey}|${computedEndTick}-${computedEndTick}`;
      outroUnit = { unitId: outroId, layer: name, startTick: computedEndTick, endTick: computedEndTick, startTime: 0, endTime: 0, raw: { outro: true } };
      if (typeof synthUnit === 'function') synthUnit({ unit: outroUnit, markerTick: computedEndTick, register: true, emitMarker: true });
    } else if (outroUnit && Number.isFinite(computedEndTick) && computedEndTick > Number(outroUnit.endTick || -Infinity)) {
      // extend existing outro unit
      const base = String(outroUnit.unitId).split('|')[0];
      const newId = `${base}|${Math.round(outroUnit.startTick)}-${computedEndTick}`;
      outroUnit.unitId = newId;
      outroUnit.endTick = computedEndTick;
      if (typeof synthUnit === 'function') synthUnit({ id: newId, markerTick: Math.round(outroUnit.startTick), register: false, emitMarker: true });
    }

    // Ensure there is always a tail unitRec marker at endTick. Prefer existing outroUnit or lastUnit if present, otherwise synthesize a final marker.
    try {
      const layerNum = name === 'primary' ? 1 : name === 'poly' ? 2 : 0;
      let finalId = null;
      if (outroUnit && outroUnit.unitId) finalId = outroUnit.unitId;
      else if (lastUnit && lastUnit.unitId) finalId = lastUnit.unitId;
      else finalId = `layer${layerNum}final|${endTick}-${endTick}`;

      let targetEndSec = null;
      try { targetEndSec = (typeof getPrimaryTargetEndSec === 'function') ? getPrimaryTargetEndSec() : null; } catch (_e) { /* swallow */ }

      if (finalId && !emittedUnitRec.has(finalId)) {
        let tailTick;
        if (name !== 'primary' && Number.isFinite(targetEndSec) && Number.isFinite(layerState.tpSec)) {
          tailTick = Math.round(Number(targetEndSec) * Number(layerState.tpSec));
        } else {
          tailTick = Math.round(Number((lastUnit && lastUnit.endTick) || endTick));
        }

        if (typeof synthUnit === 'function') synthUnit({ id: finalId, markerTick: tailTick, register: true, emitMarker: true });
      }
    } catch (_e) { /* swallow */ }
  } catch (_e) { /* swallow */ }

  return { outroUnit, computedEndTick };
}

module.exports = { ensureTailMarker };
