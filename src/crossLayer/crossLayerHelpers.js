// src/crossLayer/crossLayerHelpers.js - Shared layer, timing, and MIDI helpers.

crossLayerHelpers = (() => {
  const V = validator.create('crossLayerHelpers');

  function getOtherLayer(layer) {
    return layer === 'L1' ? 'L2' : 'L1';
  }

  function msToSyncTick(timeMs) {
    V.requireFinite(timeMs, 'timeMs');
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const syncTickRaw = m.round(measureStart + ((timeMs / 1000) - measureStartTime) * tpSec);
    return m.max(0, syncTickRaw);
  }

  function tickToAbsMs(tick, fallbackAbsMs) {
    V.requireFinite(tick, 'tick');
    if (Number.isFinite(measureStart) && Number.isFinite(measureStartTime) && Number.isFinite(tpSec)) {
      return (measureStartTime + (tick - measureStart) / tpSec) * 1000;
    }
    const fallback = V.optionalFinite(fallbackAbsMs, beatStartTime * 1000);
    return fallback;
  }

  function getOctaveBounds(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const lowOffset = V.optionalFinite(opts.lowOffset, -1);
    const clipToMidi = opts.clipToMidi === true;
    const anchorMidi = V.optionalFinite(opts.anchorMidi);
    const radius = V.optionalFinite(opts.radius);
    let lo = m.max(0, OCTAVE.min * 12 + lowOffset);
    let hi = OCTAVE.max * 12 - 1;
    if (clipToMidi) hi = m.min(127, hi);
    if (anchorMidi !== undefined && radius !== undefined) {
      lo = m.max(lo, anchorMidi - radius);
      hi = m.min(hi, anchorMidi + radius);
    }
    return { lo, hi };
  }

  return { getOtherLayer, msToSyncTick, tickToAbsMs, getOctaveBounds };
})();
