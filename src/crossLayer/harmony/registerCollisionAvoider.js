registerCollisionAvoider = (() => {
  const V = validator.create('registerCollisionAvoider');
  const CHANNEL = 'registerCollision';
  const TIME_TOLERANCE_MS = 140;
  const COLLISION_SEMITONES = 5;
  const octaveBounds = crossLayerHelpers.getOctaveBounds({ lowOffset: 0, clipToMidi: true });

  /** @param {number} tick @param {number | undefined} absMs */
  function tickToMs(tick, absMs) {
    return V.optionalFinite(absMs, crossLayerHelpers.tickToAbsMs(tick));
  }

  /**
   * @param {string} layer
   * @param {number} midi
   * @param {number} tick
   * @param {number} [absMs]
   */
  function recordNote(layer, midi, tick, absMs) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(tick, 'tick');
    const resolvedAbsMs = tickToMs(tick, absMs);
    L0.post(CHANNEL, layer, resolvedAbsMs / 1000, { midi, timeInSeconds: resolvedAbsMs / 1000 });
  }

  /**
   * @param {string} activeLayer
   * @param {number} midi
   * @param {number} tick
   * @param {number} [absMs]
   * @returns {{ midi: number, adjusted: boolean }}
   */
  function avoid(activeLayer, midi, tick, absMs) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(tick, 'tick');

    const { lo, hi } = octaveBounds;
    const boundedMidi = clamp(midi, lo, hi);

    const resolvedAbsMs = tickToMs(tick, absMs);
    const other = L0.findClosest(CHANNEL, resolvedAbsMs / 1000, TIME_TOLERANCE_MS / 1000, activeLayer);
    if (!other || !Number.isFinite(other.midi)) return { midi: boundedMidi, adjusted: boundedMidi !== midi };
    if (m.abs(other.midi - boundedMidi) >= COLLISION_SEMITONES) return { midi: boundedMidi, adjusted: boundedMidi !== midi };

    // Choose octave displacement that favors spectrally sparse bins
    const upCandidate = clamp(boundedMidi + 12, lo, hi);
    const downCandidate = clamp(boundedMidi - 12, lo, hi);
    const upClearsCollision = m.abs(upCandidate - other.midi) >= COLLISION_SEMITONES;
    const downClearsCollision = m.abs(downCandidate - other.midi) >= COLLISION_SEMITONES;

    let candidate;
    if (upClearsCollision && downClearsCollision) {
      // Both directions clear - pick the one in a sparser spectral bin
      const hist = spectralComplementarity.getHistogram(activeLayer);
      const upBin = upCandidate < 36 ? 0 : upCandidate < 60 ? 1 : upCandidate < 84 ? 2 : 3;
      const downBin = downCandidate < 36 ? 0 : downCandidate < 60 ? 1 : downCandidate < 84 ? 2 : 3;
      candidate = (hist[upBin] <= hist[downBin]) ? upCandidate : downCandidate;
    } else if (upClearsCollision) {
      candidate = upCandidate;
    } else if (downClearsCollision) {
      candidate = downCandidate;
    } else {
      // Neither direction fully clears - pick the one farther from other.midi
      candidate = m.abs(upCandidate - other.midi) >= m.abs(downCandidate - other.midi)
        ? upCandidate : downCandidate;
    }

    const adjusted = candidate !== midi;
    if (adjusted) {
      explainabilityBus.emit('register-collision-avoided', activeLayer, {
        sourceMidi: midi,
        otherMidi: other.midi,
        adjustedMidi: candidate,
        tick
      }, resolvedAbsMs);
    }

    return { midi: candidate, adjusted };
  }

  function reset() {
    // Stateless - nothing to clear for registerCollisionAvoider. No-op by design.
  }

  return { recordNote, avoid, reset };
})();
crossLayerRegistry.register('registerCollisionAvoider', registerCollisionAvoider, ['all', 'phrase']);
