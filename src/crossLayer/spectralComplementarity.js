// src/crossLayer/spectralComplementarity.js — Cross-layer spectral gap filling.
// Tracks running pitch-class histogram per layer. When one layer concentrates
// in a register, nudges the other to fill spectral gaps (bass or treble).
// Ensures combined output always has full-spectrum coverage.

SpectralComplementarity = (() => {
  const V = Validator.create('SpectralComplementarity');
  const CHANNEL = 'spectral';
  const REGISTER_BINS = 4; // bass(0-35), low-mid(36-59), high-mid(60-83), treble(84-108)
  const BIN_BOUNDARIES = [36, 60, 84, 109];
  const WINDOW_NOTES = 30; // rolling window size
  const NUDGE_STRENGTH = 0.4; // max probability of register nudge

  /** @type {Map<string, number[]>} recent MIDI notes per layer */
  const noteHistory = new Map();

  /**
   * Record a note from the active layer.
   * @param {number} midi - MIDI note number
   * @param {string} layer - 'L1' or 'L2'
   */
  function recordNote(midi, layer) {
    V.requireFinite(midi, 'midi');
    if (!noteHistory.has(layer)) noteHistory.set(layer, []);
    const hist = noteHistory.get(layer);
    if (!hist) throw new Error('SpectralComplementarity.recordNote: missing note history for layer ' + layer);
    hist.push(midi);
    if (hist.length > WINDOW_NOTES) hist.shift();
  }

  /**
   * Compute register histogram for a layer.
   * @param {string} layer
   * @returns {number[]} array of size REGISTER_BINS with normalized 0-1 densities
   */
  function getHistogram(layer) {
    const hist = noteHistory.get(layer);
    if (!hist || hist.length === 0) return new Array(REGISTER_BINS).fill(0);
    const bins = new Array(REGISTER_BINS).fill(0);
    for (let i = 0; i < hist.length; i++) {
      const note = hist[i];
      let bin = 0;
      for (let b = 0; b < BIN_BOUNDARIES.length; b++) {
        if (note < BIN_BOUNDARIES[b]) { bin = b; break; }
      }
      bins[bin]++;
    }
    const total = hist.length;
    return bins.map(b => b / total);
  }

  /**
   * Analyze spectral complement: find which register bins the other layer
   * is sparse in, so this layer can fill the gap.
   * @param {string} activeLayer - the layer being analyzed
   * @returns {{ gaps: number[], dominant: number[], gapWeight: number }}
   */
  function analyzeComplement(activeLayer) {
    const otherLayer = activeLayer === 'L1' ? 'L2' : 'L1';
    const otherHist = getHistogram(otherLayer);
    const ourHist = getHistogram(activeLayer);

    const gaps = [];
    const dominant = [];
    for (let i = 0; i < REGISTER_BINS; i++) {
      if (otherHist[i] < 0.15) gaps.push(i);
      if (otherHist[i] > 0.4) dominant.push(i);
    }

    // Weight: how unbalanced is the combined spectrum?
    const combined = ourHist.map((v, i) => v + otherHist[i]);
    const avg = combined.reduce((a, b) => a + b, 0) / REGISTER_BINS;
    const variance = combined.reduce((s, v) => s + (v - avg) * (v - avg), 0) / REGISTER_BINS;
    const gapWeight = clamp(Math.sqrt(variance) * 2, 0, 1);

    return { gaps, dominant, gapWeight };
  }

  /**
   * Nudge a MIDI note toward an under-represented register.
   * @param {number} midi - original MIDI note
   * @param {string} activeLayer - current layer
   * @returns {{ midi: number, nudged: boolean, targetBin: number }}
   */
  function nudgeToFillGap(midi, activeLayer) {
    V.requireFinite(midi, 'midi');
    const analysis = analyzeComplement(activeLayer);
    if (analysis.gaps.length === 0 || analysis.gapWeight < 0.2) {
      return { midi, nudged: false, targetBin: -1 };
    }
    // Roll probability: stronger gapWeight = more likely to nudge
    if (rf() > analysis.gapWeight * NUDGE_STRENGTH) {
      return { midi, nudged: false, targetBin: -1 };
    }

    // Pick a random gap bin and transpose the note into that register
    const targetBin = analysis.gaps[ri(analysis.gaps.length - 1)];
    const pc = midi % 12;
    let targetMidi;
    if (targetBin === 0) targetMidi = pc + 24; // bass: octave 2
    else if (targetBin === 1) targetMidi = pc + 48; // low-mid: octave 4
    else if (targetBin === 2) targetMidi = pc + 72; // high-mid: octave 6
    else targetMidi = pc + 84; // treble: octave 7

    // Clamp to OCTAVE range
    const lo = Math.max(0, OCTAVE.min * 12 - 1);
    const hi = OCTAVE.max * 12 - 1;
    targetMidi = clamp(targetMidi, lo, hi);

    return { midi: targetMidi, nudged: true, targetBin };
  }

  /**
   * Post spectral state to ATG for cross-layer visibility.
   * @param {number} absTimeMs
   * @param {string} layer
   */
  function postSpectralState(absTimeMs, layer) {
    const hist = getHistogram(layer);
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, { histogram: hist });
  }

  function reset() {
    noteHistory.clear();
  }

  return { recordNote, getHistogram, analyzeComplement, nudgeToFillGap, postSpectralState, reset };
})();
