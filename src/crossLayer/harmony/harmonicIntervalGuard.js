// src/crossLayer/harmonicIntervalGuard.js - Cross-layer consonance/dissonance steering.
// Tracks which intervals appear simultaneously between layers.
// When intent calls for consonance, nudges cross-layer intervals toward
// perfect/imperfect consonances. When dissonance is desired, steers toward
// tritones, 2nds, and 7ths. Consumes feedbackOscillator.pitchBias (dead-end signal).

harmonicIntervalGuard = (() => {
  const V = validator.create('harmonicIntervalGuard');
  const MAX_HISTORY = 40;

  // Consonance table: interval class - consonance score 0-1
  // 0=unison, 1=m2, 2=M2, 3=m3, 4=M3, 5=P4, 6=tritone, 7=P5, 8=m6, 9=M6, 10=m7, 11=M7
  const CONSONANCE = Object.freeze([1, 0.1, 0.25, 0.6, 0.7, 0.85, 0.05, 0.95, 0.65, 0.7, 0.2, 0.15]);

  /** @type {{ midi: number, absTimeMs: number, layer: string }[]} */
  const history = [];

  /** @type {number[]} rolling interval class histogram (12 bins, raw counts) */
  const intervalHist = new Array(12).fill(0);
  let histTotal = 0;

  /**
   * Record a cross-layer interval observation.
   * @param {number} midiA
   * @param {number} midiB
   * @param {number} absTimeMs
   */
  function recordCrossInterval(midiA, midiB, absTimeMs) {
    V.requireFinite(midiA, 'midiA');
    V.requireFinite(midiB, 'midiB');
    V.requireFinite(absTimeMs, 'absTimeMs');
    const ic = ((midiA - midiB) % 12 + 12) % 12;
    intervalHist[ic]++;
    histTotal++;
    history.push({ midi: midiA, absTimeMs, layer: 'cross' });
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
  }

  /**
   * Measure current dissonance level from recent cross-layer intervals (0=consonant, 1=dissonant).
   * @returns {number}
   */
  function getDissonanceLevel() {
    if (histTotal === 0) return 0.5;
    let weightedCons = 0;
    for (let i = 0; i < 12; i++) {
      weightedCons += (intervalHist[i] / histTotal) * CONSONANCE[i];
    }
    return clamp(1 - weightedCons, 0, 1);
  }

  /**
   * Nudge a MIDI note to better fit the desired consonance/dissonance target.
   * Accepts pre-computed pitchBias to avoid re-calling feedbackOscillator.
   * @param {number} midi - original MIDI note
   * @param {string} activeLayer
   * @param {number} absTimeMs
   * @param {number} [externalPitchBias=-1] - pre-computed pitch bias from feedbackOscillator
   * @returns {{ midi: number, nudged: boolean, interval: number, otherMidi: number }}
   */
  function nudgePitch(midi, activeLayer, absTimeMs, externalPitchBias) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absTimeMs, 'absTimeMs');

    // Get dissonance target from intent
    const intent = sectionIntentCurves.getLastIntent();
    const dissonanceTarget = V.optionalFinite(intent.dissonanceTarget, 0.5);

    // Use pre-computed pitch bias if provided; avoids re-calling feedbackOscillator.applyFeedback
    const pitchBias = (typeof externalPitchBias === 'number' && Number.isFinite(externalPitchBias) && externalPitchBias >= 0)
      ? externalPitchBias
      : -1;

    // Find other layer's most recent note from ATW
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);
    let otherRecentMidi = -1;
    const lastNote = L0.getLast('note', {
      layer: otherLayer,
      since: (absTimeMs / 1000) - 1,
      windowSeconds: 1
    });
    if (lastNote) {
      otherRecentMidi = lastNote.midi || lastNote.note || -1;
    }

    if (otherRecentMidi < 0) return { midi, nudged: false, interval: -1, otherMidi: -1 };

    const currentIC = ((midi - otherRecentMidi) % 12 + 12) % 12;
    const currentConsonance = CONSONANCE[currentIC];

    // Should we nudge? Only if current consonance is far from target
    const desiredConsonance = 1 - dissonanceTarget;
    const error = currentConsonance - desiredConsonance;
    if (m.abs(error) < 0.25) return { midi, nudged: false, interval: currentIC, otherMidi: otherRecentMidi };

    // Apply nudge probability scaled by error magnitude
    if (rf() > m.abs(error) * 0.6) return { midi, nudged: false, interval: currentIC, otherMidi: otherRecentMidi };

    // Find best candidate within 3 semitones
    let bestNote = midi;
    let bestScore = Infinity;
    const { lo, hi } = crossLayerHelpers.getOctaveBounds({ lowOffset: 0, clipToMidi: true, anchorMidi: midi, radius: 3 });
    for (let candidate = lo; candidate <= hi; candidate++) {
      if (candidate === midi) continue;
      const candidateIC = ((candidate - otherRecentMidi) % 12 + 12) % 12;
      const candidateConsonance = CONSONANCE[candidateIC];
      const score = m.abs(candidateConsonance - desiredConsonance);
      // If pitchBias is set, prefer notes near that pitch class
      const pitchBiasBonus = (pitchBias >= 0 && (candidate % 12) === pitchBias) ? -0.15 : 0;
      if (score + pitchBiasBonus < bestScore) {
        bestScore = score + pitchBiasBonus;
        bestNote = candidate;
      }
    }

    if (bestNote !== midi) {
      const newIC = ((bestNote - otherRecentMidi) % 12 + 12) % 12;
      recordCrossInterval(bestNote, otherRecentMidi, absTimeMs);
      return { midi: bestNote, nudged: true, interval: newIC, otherMidi: otherRecentMidi };
    }

    return { midi, nudged: false, interval: currentIC, otherMidi: otherRecentMidi };
  }

  function reset() {
    history.length = 0;
    intervalHist.fill(0);
    histTotal = 0;
  }

  return { recordCrossInterval, getDissonanceLevel, nudgePitch, reset };
})();
crossLayerRegistry.register('harmonicIntervalGuard', harmonicIntervalGuard, ['all', 'section']);
