// src/crossLayer/crossLayerHelpers.js - Shared layer, timing, and MIDI helpers.

crossLayerHelpers = (() => {
  const V = validator.create('crossLayerHelpers');

  function createLayerPair(l1Value, l2Value) {
    return {
      L1: l1Value,
      L2: l2Value === undefined ? l1Value : l2Value
    };
  }

  function getOtherLayer(layer) {
    return layer === 'L1' ? 'L2' : 'L1';
  }

  function scaleVelocity(velocity, factor) {
    V.requireFinite(velocity, 'velocity');
    V.requireFinite(factor, 'factor');
    return m.round(clamp(velocity * factor, 1, MIDI_MAX_VALUE));
  }

  function msToSyncTick(timeMs) {
    V.requireFinite(timeMs, 'timeMs');
    V.requireFinite(measureStartTime, 'measureStartTime');
    // Returns offset in seconds from measure start (replaces tick-based sync position)
    return m.max(0, (timeMs / 1000) - measureStartTime);
  }

  function tickToAbsMs(tick, fallbackAbsMs) {
    V.requireFinite(tick, 'tick');
    // tick is now a time value in seconds; convert to ms
    if (Number.isFinite(tick)) {
      return tick * 1000;
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

  return { createLayerPair, getOtherLayer, scaleVelocity, msToSyncTick, tickToAbsMs, getOctaveBounds };
})();
