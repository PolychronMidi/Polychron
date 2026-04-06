// src/crossLayer/spectralComplementarity.js - Cross-layer spectral gap filling.
// Tracks running pitch-class histogram per layer. When one layer concentrates
// in a register, nudges the other to fill spectral gaps (bass or treble).
// Ensures combined output always has full-spectrum coverage.

spectralComplementarity = (() => {
  const V = validator.create('spectralComplementarity');
  const CHANNEL = 'spectral';
  const REGISTER_BINS = 4; // bass(0-35), low-mid(36-59), high-mid(60-83), treble(84-108)
  const WINDOW_NOTES = 30; // rolling window size
  // R10 E4: Raised from 0.4 to 0.55 for stronger spectral gap filling.
  // Wider register separation between layers enriches harmonic texture by
  // ensuring combined output covers bass-to-treble more completely.
  const NUDGE_STRENGTH = 0.55; // max probability of register nudge
  let cimScale = 0.5;

  /** @type {Map<string, number[]>} recent MIDI notes per layer */
  const noteHistory = new Map();
  /** @type {Map<string, number[]>} cached raw bin counts per layer - updated incrementally */
  const binCountsByLayer = new Map();

  /** Map a MIDI note to its register bin index (0-3). */
  function noteToBin(midi) {
    if (midi < 36) return 0;
    if (midi < 60) return 1;
    if (midi < 84) return 2;
    return 3;
  }

  /**
   * Record a note from the active layer.
   * @param {number} midi - MIDI note number
   * @param {string} layer - 'L1' or 'L2'
   */
  function recordNote(midi, layer) {
    V.requireFinite(midi, 'midi');
    if (!noteHistory.has(layer)) {
      noteHistory.set(layer, []);
      binCountsByLayer.set(layer, new Array(REGISTER_BINS).fill(0));
    }
    const hist = noteHistory.get(layer);
    if (!hist) throw new Error('spectralComplementarity.recordNote: missing note history for layer ' + layer);
    const bins = binCountsByLayer.get(layer);
    if (!bins) throw new Error('spectralComplementarity.recordNote: missing bin counts for layer ' + layer);
    hist.push(midi);
    bins[noteToBin(midi)]++;
    if (hist.length > WINDOW_NOTES) {
      bins[noteToBin(hist[0])]--;
      hist.shift();
    }
  }

  /**
   * Compute register histogram for a layer.
   * O(1) - reads cached bin counts instead of re-scanning noteHistory.
   * @param {string} layer
   * @returns {number[]} array of size REGISTER_BINS with normalized 0-1 densities
   */
  function getHistogram(layer) {
    const bins = binCountsByLayer.get(layer);
    if (!bins) return new Array(REGISTER_BINS).fill(0);
    const hist = noteHistory.get(layer);
    const total = (hist && hist.length > 0) ? hist.length : 1;
    return [bins[0] / total, bins[1] / total, bins[2] / total, bins[3] / total];
  }

  /**
   * Analyze spectral complement: find which register bins the other layer
   * is sparse in, so this layer can fill the gap.
   * Zero-allocation: reuses cached histograms and avoids .map()/.reduce().
   * @param {string} activeLayer - the layer being analyzed
   * @returns {{ gaps: number[], dominant: number[], gapWeight: number }}
   */
  function analyzeComplement(activeLayer) {
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);
    const otherHist = getHistogram(otherLayer);
    const ourHist = getHistogram(activeLayer);

    const gaps = [];
    const dominant = [];
    let combinedSum = 0;
    for (let i = 0; i < REGISTER_BINS; i++) {
      if (otherHist[i] < 0.15) gaps.push(i);
      if (otherHist[i] > 0.4) dominant.push(i);
      combinedSum += ourHist[i] + otherHist[i];
    }

    // Weight: how unbalanced is the combined spectrum?
    const avg = combinedSum / REGISTER_BINS;
    let variance = 0;
    for (let i = 0; i < REGISTER_BINS; i++) {
      const diff = (ourHist[i] + otherHist[i]) - avg;
      variance += diff * diff;
    }
    variance /= REGISTER_BINS;
    const gapWeight = clamp(m.sqrt(variance) * 2, 0, 1);

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
    // Lab R4+R5: reduce nudge when dissonance is desired so pitch corrections
    // don't normalize intentionally dissonant output. R5 raised scaling from
    // 0.7 to 0.95: sketch showed full bypass still sounds good, so near-zero
    // nudging at high dissonance is correct.
    const intentDissonance = sectionIntentCurves.getLastIntent()
      ? V.optionalFinite(sectionIntentCurves.getLastIntent().dissonanceTarget, 0)
      : 0;
    // Melodic coupling: contourShape modulates register gap-filling aggressiveness.
    // Rising contour -> amplify nudge (build spreads across registers).
    // Falling contour -> soften nudge (spectrum thins as phrases descend).
    const melodicCtxSC = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const contourNudgeScale = melodicCtxSC
      ? (melodicCtxSC.contourShape === 'rising' ? 1.15 : melodicCtxSC.contourShape === 'falling' ? 0.82 : 1.0)
      : 1.0;
    // CIM: coordinated = stronger gap-filling, independent = each layer owns spectrum
    const effectiveNudge = NUDGE_STRENGTH * (1 - intentDissonance * 0.95) * (0.4 + cimScale * 1.2) * contourNudgeScale;
    if (rf() > analysis.gapWeight * effectiveNudge) {
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
  const { lo, hi } = crossLayerHelpers.getOctaveBounds();
    targetMidi = clamp(targetMidi, lo, hi);

    return { midi: targetMidi, nudged: true, targetBin };
  }

  /**
   * Post spectral state to ATG for cross-layer visibility.
   * @param {number} absoluteSeconds
   * @param {string} layer
   */
  function postSpectralState(absoluteSeconds, layer) {
    const hist = getHistogram(layer);
    L0.post(CHANNEL, layer, absoluteSeconds, { histogram: hist });
  }

  function reset() {
    noteHistory.clear();
    binCountsByLayer.clear();
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  return { recordNote, getHistogram, analyzeComplement, nudgeToFillGap, postSpectralState, setCoordinationScale, reset };
})();
crossLayerRegistry.register('spectralComplementarity', spectralComplementarity, ['all', 'section']);
