// src/crossLayer/velocityInterference.js - Cross-layer velocity phase interference.
// Posts velocity contour snapshots to ATG 'velocity' channel. When both layers
// are crescendoing toward the same ms point, velocities reinforce. When one
// crescendos while the other decrescendos, spectral separation increases.

velocityInterference = (() => {
  const V = validator.create('velocityInterference');
  const CHANNEL = 'velocity';
  const CONTOUR_WINDOW_MS = 400;
  const SYNC_TOLERANCE_MS = 300;
  const VIZ_CC = 102; // CC 102 = undefined in GM, safe for automation lane
  const VIZ_REINFORCE = 100; // CC value for reinforcement
  const VIZ_SEPARATE = 27;   // CC value for separation
  const VIZ_NEUTRAL = 64;    // CC value for neutral
  const MODE_SET = new Set(['reinforce', 'separate', 'neutral']);

  /**
   * Post a velocity contour sample from the active layer.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} velocity - current velocity 0-127
   * @param {number} delta - velocity change rate (positive = crescendo, negative = decrescendo)
   */
  function postVelocity(absTimeMs, layer, velocity, delta) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.assertNonEmptyString(layer, 'layer');
    const velocityN = V.requireFinite(velocity, 'velocity');
    const deltaN = V.requireFinite(delta, 'delta');
    absoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
      velocity: clamp(velocityN, 0, 127),
      delta: deltaN
    });
  }

  /**
   * Compute velocity delta from recent ATW note history.
   * @param {string} layer - layer to analyze
   * @param {number} absTimeSec - current absolute seconds
   * @returns {number} velocity delta (positive = getting louder)
   */
  function measureDelta(layer, absTimeSec) {
    V.assertNonEmptyString(layer, 'layer');
    const at = V.requireFinite(absTimeSec, 'absTimeSec');
    const windowSec = CONTOUR_WINDOW_MS / 1000;
    const bounds = absoluteTimeWindow.getNoteBounds({
      layer,
      since: at - windowSec,
      windowSeconds: windowSec
    });
    if (bounds.count < 2) return 0;
    const first = bounds.first;
    const last = bounds.last;
    V.assertObject(first, 'measureDelta.first');
    V.assertObject(last, 'measureDelta.last');
    const firstVelocity = V.requireFinite(first.velocity, 'measureDelta.first.velocity');
    const lastVelocity = V.requireFinite(last.velocity, 'measureDelta.last.velocity');
    return lastVelocity - firstVelocity;
  }

  /**
   * Compute interference modifier for a note's velocity.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @param {number} baseVelocity - the note's original velocity
   * @returns {{ velocity: number, mode: 'reinforce' | 'separate' | 'neutral' }}
   */
  function applyInterference(absTimeMs, activeLayer, baseVelocity) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const baseVelocityN = V.requireFinite(baseVelocity, 'baseVelocity');

    const other = absoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, SYNC_TOLERANCE_MS, activeLayer
    );
    if (!other) {
      writeVizCC(activeLayer, 'neutral');
      return { velocity: baseVelocityN, mode: 'neutral' };
    }
    V.assertObject(other, 'applyInterference.other');
    const otherDelta = V.requireFinite(other.delta, 'applyInterference.other.delta');

    // Get our own recent delta
    const absTimeSec = absTimeMs / 1000;
    const ourDelta = measureDelta(activeLayer, absTimeSec);

    // Same direction = reinforcement, opposite = separation
    const sameDirection = (ourDelta >= 0 && otherDelta >= 0) || (ourDelta < 0 && otherDelta < 0);

    if (sameDirection) {
      // Reinforce: boost velocity proportional to alignment strength
      const alignment = Math.min(Math.abs(ourDelta), Math.abs(otherDelta));
      const boost = clamp(alignment / 30, 0, 0.15); // max 15% boost
      const reinforced = Math.round(clamp(baseVelocityN * (1 + boost), 1, MIDI_MAX_VALUE));
      writeVizCC(activeLayer, 'reinforce');
      return { velocity: reinforced, mode: 'reinforce' };
    }

    // Opposing dynamics: reduce velocity to create spectral space
    const opposition = Math.min(Math.abs(ourDelta), Math.abs(otherDelta));
    const reduction = clamp(opposition / 50, 0, 0.1); // max 10% reduction
    const separated = Math.round(clamp(baseVelocityN * (1 - reduction), 1, MIDI_MAX_VALUE));
    writeVizCC(activeLayer, 'separate');
    return { velocity: separated, mode: 'separate' };
  }

  /**
   * Write a MIDI CC event for DAW visualization of interference mode.
   * @param {string} layer
   * @param {'reinforce'|'separate'|'neutral'} mode
   */
  function writeVizCC(layer, mode) {
    V.assertNonEmptyString(layer, 'writeVizCC.layer');
    V.assertInSet(mode, MODE_SET, 'writeVizCC.mode');
    if (!Array.isArray(c)) {
      throw new Error('velocityInterference.writeVizCC: c must be a note event array');
    }
    const startTick = V.requireFinite(beatStart, 'writeVizCC.beatStart');
    const ch = (layer === 'L1') ? cCH1 : cCH2;
    const val = mode === 'reinforce' ? VIZ_REINFORCE : mode === 'separate' ? VIZ_SEPARATE : VIZ_NEUTRAL;
    c.push({ tick: startTick, type: 'control_c', vals: [ch, VIZ_CC, val] });
  }

  return { postVelocity, measureDelta, applyInterference, reset() { /* stateless - no per-scope state to clear */ } };
})();
crossLayerRegistry.register('velocityInterference', velocityInterference, ['all']);
