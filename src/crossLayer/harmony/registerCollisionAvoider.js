registerCollisionAvoider = (() => {
  const V = validator.create('registerCollisionAvoider');
  const CHANNEL = 'registerCollision';
  const TIME_TOLERANCE_SEC = 0.140;
  const COLLISION_SEMITONES = 5;
  const octaveBounds = crossLayerHelpers.getOctaveBounds({ lowOffset: 0, clipToMidi: true });

  /**
   * @param {string} layer
   * @param {number} midi
   * @param {number} absoluteSeconds
   */
  function recordNote(layer, midi, absoluteSeconds) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    L0.post(CHANNEL, layer, absoluteSeconds, { midi, timeInSeconds: absoluteSeconds });
  }

  /**
   * @param {string} activeLayer
   * @param {number} midi
   * @param {number} absoluteSeconds
   * @returns {{ midi: number, adjusted: boolean }}
   */
  function avoid(activeLayer, midi, absoluteSeconds) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    const { lo, hi } = octaveBounds;
    const boundedMidi = clamp(midi, lo, hi);

    const other = L0.findClosest(CHANNEL, absoluteSeconds, TIME_TOLERANCE_SEC, activeLayer);
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
      // Neither direction fully clears - pick the one in a sparser bin, breaking ties by distance
      const hist = spectralComplementarity.getHistogram(activeLayer);
      const upBin = upCandidate < 36 ? 0 : upCandidate < 60 ? 1 : upCandidate < 84 ? 2 : 3;
      const downBin = downCandidate < 36 ? 0 : downCandidate < 60 ? 1 : downCandidate < 84 ? 2 : 3;
      if (hist[upBin] !== hist[downBin]) {
        candidate = hist[upBin] < hist[downBin] ? upCandidate : downCandidate;
      } else {
        candidate = m.abs(upCandidate - other.midi) >= m.abs(downCandidate - other.midi)
          ? upCandidate : downCandidate;
      }
    }

    const adjusted = candidate !== midi;
    if (adjusted) {
      explainabilityBus.emit('register-collision-avoided', activeLayer, {
        sourceMidi: midi,
        otherMidi: other.midi,
        adjustedMidi: candidate,
        absoluteSeconds
      }, absoluteSeconds);
    }

    return { midi: candidate, adjusted };
  }

  function reset() {
    // Stateless - nothing to clear for registerCollisionAvoider. No-op by design.
  }

  return { recordNote, avoid, reset };
})();
crossLayerRegistry.register('registerCollisionAvoider', registerCollisionAvoider, ['all', 'phrase']);
