RegisterCollisionAvoider = (() => {
  const CHANNEL = 'registerCollision';
  const TIME_TOLERANCE_MS = 140;
  const COLLISION_SEMITONES = 5;

  /** @param {number} tick */
  function tickToMs(tick) {
    if (Number.isFinite(measureStart) && Number.isFinite(measureStartTime) && Number.isFinite(tpSec)) {
      return (measureStartTime + (tick - measureStart) / tpSec) * 1000;
    }
    return Number.isFinite(beatStartTime) ? beatStartTime * 1000 : 0;
  }

  /**
   * @param {string} layer
   * @param {number} midi
   * @param {number} tick
   */
  function recordNote(layer, midi, tick) {
    if (!Number.isFinite(midi)) throw new Error('RegisterCollisionAvoider.recordNote: midi must be finite');
    if (!Number.isFinite(tick)) throw new Error('RegisterCollisionAvoider.recordNote: tick must be finite');
    const absMs = tickToMs(tick);
    AbsoluteTimeGrid.post(CHANNEL, layer, absMs, { midi, tick });
  }

  /**
   * @param {string} layer
   * @param {number} midi
   * @param {number} tick
   * @returns {{ midi: number, adjusted: boolean }}
   */
  function avoid(layer, midi, tick) {
    if (!Number.isFinite(midi)) throw new Error('RegisterCollisionAvoider.avoid: midi must be finite');
    if (!Number.isFinite(tick)) throw new Error('RegisterCollisionAvoider.avoid: tick must be finite');

    const absMs = tickToMs(tick);
    const other = AbsoluteTimeGrid.findClosest(CHANNEL, absMs, TIME_TOLERANCE_MS, layer);
    if (!other || !Number.isFinite(other.midi)) return { midi, adjusted: false };
    if (Math.abs(other.midi - midi) >= COLLISION_SEMITONES) return { midi, adjusted: false };

    const lo = Math.max(0, OCTAVE.min * 12 - 1);
    const hi = OCTAVE.max * 12 - 1;
    const direction = midi <= other.midi ? -12 : 12;

    let candidate = clamp(midi + direction, lo, hi);
    if (Math.abs(candidate - other.midi) < COLLISION_SEMITONES) {
      candidate = clamp(midi - direction, lo, hi);
    }

    const adjusted = candidate !== midi;
    if (adjusted && typeof ExplainabilityBus !== 'undefined' && ExplainabilityBus && typeof ExplainabilityBus.emit === 'function') {
      ExplainabilityBus.emit('register-collision-avoided', layer, {
        sourceMidi: midi,
        otherMidi: other.midi,
        adjustedMidi: candidate,
        tick
      }, absMs);
    }

    return { midi: candidate, adjusted };
  }

  function reset() {
    // Stateless — nothing to clear for registerCollisionAvoider. No-op by design.
  }

  return { recordNote, avoid, reset };
})();
