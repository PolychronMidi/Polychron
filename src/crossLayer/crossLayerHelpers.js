// src/crossLayer/crossLayerHelpers.js - Shared layer, timing, and MIDI helpers.

moduleLifecycle.declare({
  name: 'crossLayerHelpers',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['crossLayerHelpers'],
  init: (deps) => {
  const V = deps.validator.create('crossLayerHelpers');

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

  function syncOffset(timeInSeconds) {
    V.requireFinite(timeInSeconds, 'timeInSeconds');
    V.requireFinite(measureStartTime, 'measureStartTime');
    return m.max(0, timeInSeconds - measureStartTime);
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

  return { createLayerPair, getOtherLayer, scaleVelocity, syncOffset, getOctaveBounds };
  },
});
