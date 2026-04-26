moduleLifecycle.declare({
  name: 'registerCollisionAvoider',
  subsystem: 'crossLayer',
  deps: ['L0', 'validator'],
  lazyDeps: ['crossLayerHelpers', 'emergentMelodicEngine', 'explainabilityBus', 'spectralComplementarity'],
  provides: ['registerCollisionAvoider'],
  crossLayerScopes: ['all', 'phrase'],
  init: (deps) => {
  const L0 = deps.L0;
  const V = deps.validator.create('registerCollisionAvoider');
  const CHANNEL = 'registerCollision';
  const TIME_TOLERANCE_SEC = 0.140;
  const octaveBounds = crossLayerHelpers.getOctaveBounds({ lowOffset: 0, clipToMidi: true });

  let cimScale = 0.5;

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

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
    if (!other || V.optionalFinite(other.midi) === undefined) return { midi: boundedMidi, adjusted: boundedMidi !== midi };
    // Melodic coupling: intervalFreshness scales collision tolerance.
    // Fresh intervals -> wider tolerance (novel dissonances are expressive, let them through).
    // Stale intervals -> tighter (muddy register collisions need harder avoidance).
    const melodicCtxRCA = emergentMelodicEngine.getContext();
    const intervalFreshness = melodicCtxRCA ? V.optionalFinite(melodicCtxRCA.intervalFreshness, 0.5) : 0.5;
    const freshnessAdjust = (intervalFreshness - 0.5) * 2; // [-1 stale ... +1 fresh]
    // R77 E8: hotspots coupling -- dense rhythmic bursts widen collision tolerance (intentional cluster dissonance)
    const rhythmEntryRCA = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const hotspotsRCA = rhythmEntryRCA && Array.isArray(rhythmEntryRCA.hotspots) ? rhythmEntryRCA.hotspots.length : 0;
    const hotspotWidenRCA = clamp(hotspotsRCA / 16, 0, 1) * 2.0; // up to +2 semitones at max hotspot density
    const effectiveCollisionSemitones = clamp(m.round(2 + (1 - cimScale) * 5 + freshnessAdjust + hotspotWidenRCA), 1, 10);
    if (m.abs(other.midi - boundedMidi) >= effectiveCollisionSemitones) return { midi: boundedMidi, adjusted: boundedMidi !== midi };

    // Choose octave displacement that favors spectrally sparse bins
    const upCandidate = clamp(boundedMidi + 12, lo, hi);
    const downCandidate = clamp(boundedMidi - 12, lo, hi);
    const upClearsCollision = m.abs(upCandidate - other.midi) >= effectiveCollisionSemitones;
    const downClearsCollision = m.abs(downCandidate - other.midi) >= effectiveCollisionSemitones;

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

  return { recordNote, avoid, setCoordinationScale, reset };
  },
});
