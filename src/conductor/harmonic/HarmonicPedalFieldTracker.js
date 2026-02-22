// src/conductor/HarmonicPedalFieldTracker.js - Sustained harmonic field tracker.
// Detects extended harmonic stasis (pedal/drone zones) by measuring how long
// the same pitch class dominates the bass register. Tension bias encourages
// movement after sustained fields or allows settling during instability.
// Stateful — recordBass() accumulates samples; getPedalFieldSignal() reads streak.
//
// Complementary to PedalPointDetector (texture/) which is stateless and measures
// bass PC dominance ratio for compositional advice. This tracker feeds the
// derivedTension product chain; PedalPointDetector feeds pedalSuggestion.
// Both are consumed by GlobalConductor for different purposes.

HarmonicPedalFieldTracker = (() => {
  const V = Validator.create('HarmonicPedalFieldTracker');
  const MAX_SAMPLES = 16;
  /** @type {Array<{ bassPC: number, time: number }>} */
  const bassSamples = [];

  // Beat-level cache: getPedalFieldSignal is called 2x per beat (tensionBias + stateProvider)
  const _cache = beatCache.create(() => _getPedalFieldSignal());

  /**
   * Record the current bass pitch class.
   * @param {number} absTime
   */
  function recordBass(absTime) {
    V.requireFinite(absTime, 'absTime');

    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: 2 });

    // Find lowest recent note as "bass"
    let lowestMidi = 127;
    for (let i = 0; i < notes.length; i++) {
      const midi = (typeof notes[i].midi === 'number') ? notes[i].midi : 127;
      if (midi < lowestMidi) lowestMidi = midi;
    }

    if (lowestMidi > 126) return; // no valid bass
    bassSamples.push({ bassPC: lowestMidi % 12, time: absTime });
    if (bassSamples.length > MAX_SAMPLES) bassSamples.shift();
  }

  /**
   * Detect pedal field duration and get tension bias.
   * @returns {{ pedalDuration: number, tensionBias: number, fieldStable: boolean }}
   */
  function getPedalFieldSignal() { return _cache.get(); }

  /** @private */
  function _getPedalFieldSignal() {
    if (bassSamples.length < 3) {
      return { pedalDuration: 0, tensionBias: 1, fieldStable: false };
    }

    // Count how many recent samples share the same bass PC
    const currentPC = bassSamples[bassSamples.length - 1].bassPC;
    let streak = 0;
    for (let i = bassSamples.length - 1; i >= 0; i--) {
      if (bassSamples[i].bassPC === currentPC) streak++;
      else break;
    }

    // Duration estimate from timestamps
    let pedalDuration = 0;
    if (streak >= 2) {
      const startIdx = bassSamples.length - streak;
      pedalDuration = bassSamples[bassSamples.length - 1].time - bassSamples[startIdx].time;
    }

    const fieldStable = streak >= 4;

    // Tension bias: long pedal → increase tension to encourage harmonic movement;
    // very short/unstable → decrease tension to allow settling
    let tensionBias = 1;
    if (pedalDuration > 15) {
      tensionBias = 1.12; // very long pedal → strong push for change
    } else if (pedalDuration > 8) {
      tensionBias = 1.06; // moderate pedal
    } else if (streak <= 1 && bassSamples.length >= 5) {
      tensionBias = 0.95; // bass constantly changing → allow settling
    }

    return { pedalDuration, tensionBias, fieldStable };
  }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getPedalFieldSignal().tensionBias;
  }

  /** Reset tracking. */
  function reset() {
    bassSamples.length = 0;
  }

  ConductorIntelligence.registerTensionBias('HarmonicPedalFieldTracker', () => HarmonicPedalFieldTracker.getTensionBias(), 0.9, 1.15);
  ConductorIntelligence.registerRecorder('HarmonicPedalFieldTracker', (ctx) => { HarmonicPedalFieldTracker.recordBass(ctx.absTime); });
  ConductorIntelligence.registerStateProvider('HarmonicPedalFieldTracker', () => {
    const s = HarmonicPedalFieldTracker.getPedalFieldSignal();
    return { pedalFieldStable: s ? s.fieldStable : false };
  });
  ConductorIntelligence.registerModule('HarmonicPedalFieldTracker', { reset }, ['section']);

  return {
    recordBass,
    getPedalFieldSignal,
    getTensionBias,
    reset
  };
})();
