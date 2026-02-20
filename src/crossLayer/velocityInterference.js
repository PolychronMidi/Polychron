// src/crossLayer/velocityInterference.js — Cross-layer velocity phase interference.
// Posts velocity contour snapshots to ATG 'velocity' channel. When both layers
// are crescendoing toward the same ms point, velocities reinforce. When one
// crescendos while the other decrescendos, spectral separation increases.

VelocityInterference = (() => {
  const V = Validator.create('VelocityInterference');
  const CHANNEL = 'velocity';
  const CONTOUR_WINDOW_MS = 400;
  const SYNC_TOLERANCE_MS = 300;

  /**
   * Post a velocity contour sample from the active layer.
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} velocity - current velocity 0-127
   * @param {number} delta - velocity change rate (positive = crescendo, negative = decrescendo)
   */
  function postVelocity(absTimeMs, layer, velocity, delta) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
      velocity: clamp(velocity, 0, 127),
      delta
    });
  }

  /**
   * Compute velocity delta from recent ATW note history.
   * @param {string} layer - layer to analyze
   * @param {number} absTimeSec - current absolute seconds
   * @returns {number} velocity delta (positive = getting louder)
   */
  function measureDelta(layer, absTimeSec) {
    const windowSec = CONTOUR_WINDOW_MS / 1000;
    const notes = AbsoluteTimeWindow.getNotes({
      layer,
      since: absTimeSec - windowSec,
      windowSeconds: windowSec
    });
    if (notes.length < 2) return 0;
    const first = notes[0];
    const last = notes[notes.length - 1];
    return (last.velocity || 0) - (first.velocity || 0);
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
    V.requireFinite(baseVelocity, 'baseVelocity');

    const other = AbsoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, SYNC_TOLERANCE_MS, activeLayer
    );
    if (!other || !Number.isFinite(other.delta)) {
      return { velocity: baseVelocity, mode: 'neutral' };
    }

    // Get our own recent delta
    const absTimeSec = absTimeMs / 1000;
    const ourDelta = measureDelta(activeLayer, absTimeSec);

    // Same direction = reinforcement, opposite = separation
    const sameDirection = (ourDelta >= 0 && other.delta >= 0) || (ourDelta < 0 && other.delta < 0);

    if (sameDirection) {
      // Reinforce: boost velocity proportional to alignment strength
      const alignment = Math.min(Math.abs(ourDelta), Math.abs(other.delta));
      const boost = clamp(alignment / 30, 0, 0.15); // max 15% boost
      const reinforced = Math.round(clamp(baseVelocity * (1 + boost), 1, MIDI_MAX_VALUE));
      return { velocity: reinforced, mode: 'reinforce' };
    }

    // Opposing dynamics: reduce velocity to create spectral space
    const opposition = Math.min(Math.abs(ourDelta), Math.abs(other.delta));
    const reduction = clamp(opposition / 50, 0, 0.1); // max 10% reduction
    const separated = Math.round(clamp(baseVelocity * (1 - reduction), 1, MIDI_MAX_VALUE));
    return { velocity: separated, mode: 'separate' };
  }

  return { postVelocity, measureDelta, applyInterference };
})();
