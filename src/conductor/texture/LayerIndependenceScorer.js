// src/conductor/LayerIndependenceScorer.js - Combined rhythmic + melodic independence.
// Measures how independent L1 and L2 are in pitch and rhythm.
// Too locked = boring homophony; too diverged = incoherent.
// Pure query API â€” nudges density toward balance between coupling and independence.

LayerIndependenceScorer = (() => {
  const V = Validator.create('layerIndependenceScorer');
  const WINDOW_SECONDS = 4;

  /**
   * Compute a combined independence score between layers.
   * @param {number} [windowSeconds]
   * @returns {{ rhythmIndependence: number, pitchIndependence: number, combined: number, tooLocked: boolean, tooDiverged: boolean }}
   */
  function getIndependenceProfile(windowSeconds) {
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const l1Notes = AbsoluteTimeWindow.getNotes({ layer: 'L1', windowSeconds: ws });
    const l2Notes = AbsoluteTimeWindow.getNotes({ layer: 'L2', windowSeconds: ws });
    if (l1Notes.length < 3 || l2Notes.length < 3) {
      return { rhythmIndependence: 0.5, pitchIndependence: 0.5, combined: 0.5, tooLocked: false, tooDiverged: false };
    }

    // Rhythm independence: compare IOI patterns
    const l1IOIs = [];
    const l2IOIs = [];
    for (let i = 1; i < l1Notes.length; i++) {
      l1IOIs.push(l1Notes[i].time - l1Notes[i - 1].time);
    }
    for (let i = 1; i < l2Notes.length; i++) {
      l2IOIs.push(l2Notes[i].time - l2Notes[i - 1].time);
    }

    // Compare IOI sequences â€” lower correlation = more independent
    const minIOILen = m.min(l1IOIs.length, l2IOIs.length);
    let ioiMatchCount = 0;
    for (let i = 0; i < minIOILen; i++) {
      // Within 10% = matched
      const ratio = l1IOIs[i] > 0 ? l2IOIs[i] / l1IOIs[i] : 0;
      if (m.abs(ratio - 1) < 0.15) ioiMatchCount++;
    }
    const rhythmIndependence = minIOILen > 0 ? 1 - (ioiMatchCount / minIOILen) : 0.5;

    // Pitch independence: compare pitch-class usage distributions
    const { counts: l1PCs } = pitchClassHelpers.buildFromNotes(l1Notes);
    const { counts: l2PCs } = pitchClassHelpers.buildFromNotes(l2Notes);

    // Cosine distance of PC distributions
    let dot = 0;
    let mag1 = 0;
    let mag2 = 0;
    for (let i = 0; i < 12; i++) {
      dot += l1PCs[i] * l2PCs[i];
      mag1 += l1PCs[i] * l1PCs[i];
      mag2 += l2PCs[i] * l2PCs[i];
    }
    const cosine = (mag1 > 0 && mag2 > 0) ? dot / (m.sqrt(mag1) * m.sqrt(mag2)) : 1;
    const pitchIndependence = clamp(1 - cosine, 0, 1);

    const combined = (rhythmIndependence * 0.6 + pitchIndependence * 0.4);

    return {
      rhythmIndependence,
      pitchIndependence,
      combined,
      tooLocked: combined < 0.2,
      tooDiverged: combined > 0.75
    };
  }

  /**
   * Get a density bias to balance layer coupling.
   * Too locked â†’ thin slightly to allow differentiation.
   * Too diverged â†’ boost slightly the sparser layer.
   * @returns {number} - 0.9 to 1.15
   */
  function getDensityBias() {
    const profile = getIndependenceProfile();
    if (profile.tooLocked) return 0.92;
    if (profile.tooDiverged) return 1.1;
    return 1.0;
  }

  ConductorIntelligence.registerDensityBias('LayerIndependenceScorer', () => LayerIndependenceScorer.getDensityBias(), 0.9, 1.15);

  return {
    getIndependenceProfile,
    getDensityBias
  };
})();

