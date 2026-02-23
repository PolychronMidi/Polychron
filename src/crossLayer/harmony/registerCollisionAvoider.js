RegisterCollisionAvoider = (() => {
  const V = Validator.create('registerCollisionAvoider');
  const CHANNEL = 'registerCollision';
  const TIME_TOLERANCE_MS = 140;
  const COLLISION_SEMITONES = 5;

  /** @param {number} tick */
  function tickToMs(tick) {
    if (Number.isFinite(measureStart) && Number.isFinite(measureStartTime) && Number.isFinite(tpSec)) {
      return (measureStartTime + (tick - measureStart) / tpSec) * 1000;
    }
    return beatStartTime * 1000;
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
   * @param {string} activeLayer
   * @param {number} midi
   * @param {number} tick
   * @returns {{ midi: number, adjusted: boolean }}
   */
  function avoid(activeLayer, midi, tick) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(tick, 'tick');

    const lo = Math.max(0, OCTAVE.min * 12);
    const hi = Math.min(127, OCTAVE.max * 12 - 1);
    const boundedMidi = clamp(midi, lo, hi);

    const absMs = tickToMs(tick);
    const other = AbsoluteTimeGrid.findClosest(CHANNEL, absMs, TIME_TOLERANCE_MS, activeLayer);
    if (!other || !Number.isFinite(other.midi)) return { midi: boundedMidi, adjusted: boundedMidi !== midi };
    if (Math.abs(other.midi - boundedMidi) >= COLLISION_SEMITONES) return { midi: boundedMidi, adjusted: boundedMidi !== midi };

    // Choose octave displacement that favors spectrally sparse bins
    const upCandidate = clamp(boundedMidi + 12, lo, hi);
    const downCandidate = clamp(boundedMidi - 12, lo, hi);
    const upClearsCollision = Math.abs(upCandidate - other.midi) >= COLLISION_SEMITONES;
    const downClearsCollision = Math.abs(downCandidate - other.midi) >= COLLISION_SEMITONES;

    let candidate;
    if (upClearsCollision && downClearsCollision) {
      // Both directions clear — pick the one in a sparser spectral bin
      const hist = SpectralComplementarity.getHistogram(activeLayer);
      const upBin = upCandidate < 36 ? 0 : upCandidate < 60 ? 1 : upCandidate < 84 ? 2 : 3;
      const downBin = downCandidate < 36 ? 0 : downCandidate < 60 ? 1 : downCandidate < 84 ? 2 : 3;
      candidate = (hist[upBin] <= hist[downBin]) ? upCandidate : downCandidate;
    } else if (upClearsCollision) {
      candidate = upCandidate;
    } else if (downClearsCollision) {
      candidate = downCandidate;
    } else {
      // Neither direction fully clears — pick the one farther from other.midi
      candidate = Math.abs(upCandidate - other.midi) >= Math.abs(downCandidate - other.midi)
        ? upCandidate : downCandidate;
    }

    const adjusted = candidate !== midi;
    if (adjusted) {
      ExplainabilityBus.emit('register-collision-avoided', activeLayer, {
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
