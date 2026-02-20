RegisterCollisionAvoider = (() => {
  const V = Validator.create('RegisterCollisionAvoider');
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
    V.requireFinite(midi, 'midi');
    V.requireFinite(tick, 'tick');
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
    V.requireFinite(midi, 'midi');
    V.requireFinite(tick, 'tick');

    const lo = Math.max(0, OCTAVE.min * 12);
    const hi = Math.min(127, OCTAVE.max * 12 - 1);
    const boundedMidi = clamp(midi, lo, hi);

    const absMs = tickToMs(tick);
    const other = AbsoluteTimeGrid.findClosest(CHANNEL, absMs, TIME_TOLERANCE_MS, layer);
    if (!other || !Number.isFinite(other.midi)) return { midi: boundedMidi, adjusted: boundedMidi !== midi };
    if (Math.abs(other.midi - boundedMidi) >= COLLISION_SEMITONES) return { midi: boundedMidi, adjusted: boundedMidi !== midi };

    const direction = boundedMidi <= other.midi ? -12 : 12;

    let candidate = clamp(boundedMidi + direction, lo, hi);
    if (Math.abs(candidate - other.midi) < COLLISION_SEMITONES) {
      candidate = clamp(boundedMidi - direction, lo, hi);
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
CrossLayerRegistry.register('RegisterCollisionAvoider', RegisterCollisionAvoider, ['all', 'phrase']);
