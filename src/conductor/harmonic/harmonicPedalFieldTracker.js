// src/conductor/harmonicPedalFieldTracker.js - Sustained harmonic field tracker.
// Detects extended harmonic stasis (pedal/drone zones) by measuring how long
// the same pitch class dominates the bass register. Tension bias encourages
// movement after sustained fields or allows settling during instability.
// Stateful - recordBass() accumulates samples; getPedalFieldSignal() reads streak.
//
// Complementary to pedalPointDetector (texture/) which is stateless and measures
// bass PC dominance ratio for compositional advice. This tracker feeds the
// derivedTension product chain; pedalPointDetector feeds pedalSuggestion.
// Both are consumed by globalConductor for different purposes.

moduleLifecycle.declare({
  name: 'harmonicPedalFieldTracker',
  subsystem: 'conductor',
  deps: ['L0', 'conductorIntelligence', 'validator'],
  provides: ['harmonicPedalFieldTracker'],
  init: (deps) => {
  const L0 = deps.L0;
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('harmonicPedalFieldTracker');
  const MAX_SAMPLES = 16;
  /** @type {Array<{ bassPC: number, time: number }>} */
  const bassSamples = [];

  // Beat-level cache: getPedalFieldSignal is called 2x per beat (tensionBias + stateProvider)
  const harmonicPedalFieldTrackerCache = beatCache.create(() => harmonicPedalFieldTrackerGetPedalFieldSignal());

  /**
   * Record the current bass pitch class.
   * @param {number} absTime
   */
  function recordBass(absTime) {
    V.requireFinite(absTime, 'absTime');

    const notes = L0.query(L0_CHANNELS.note, { windowSeconds: 2 });
    const midis = analysisHelpers.extractMidiArray(notes, 127);

    // Find lowest recent note as "bass"
    let lowestMidi = 127;
    for (let i = 0; i < midis.length; i++) {
      const midi = midis[i];
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
  function getPedalFieldSignal() { return harmonicPedalFieldTrackerCache.get(); }

  /** @private */
  function harmonicPedalFieldTrackerGetPedalFieldSignal() {
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

    // Continuous ramp based on pedalDuration and streak stability.
    // Long pedal - increase tension to encourage harmonic movement;
    // very unstable bass - decrease tension to allow settling.
    let tensionBias = 1;
    if (pedalDuration > 0) {
      // Pedal forming - ramp tension up: duration 0-12 maps to 1.0-1.15
      // R21 E4: Faster ramp 20s->12s. Encourages harmonic motion sooner
      // in pedal-heavy sections without increasing maximum bias.
      tensionBias = 1.0 + clamp(pedalDuration / 12, 0, 1) * 0.15;
    } else if (bassSamples.length >= 5) {
      // No pedal - ramp settling bias from streak instability
      const instability = 1 - (streak / bassSamples.length);
      tensionBias = 1.0 - clamp(instability, 0, 1) * 0.05;
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

  conductorIntelligence.registerTensionBias('harmonicPedalFieldTracker', () => harmonicPedalFieldTracker.getTensionBias(), 0.9, 1.15);
  conductorIntelligence.registerRecorder('harmonicPedalFieldTracker', (ctx) => { harmonicPedalFieldTracker.recordBass(ctx.absTime); });
  conductorIntelligence.registerStateProvider('harmonicPedalFieldTracker', () => {
    const s = harmonicPedalFieldTracker.getPedalFieldSignal();
    return { pedalFieldStable: s ? s.fieldStable : false };
  });
  conductorIntelligence.registerModule('harmonicPedalFieldTracker', { reset }, ['section']);

  return {
    recordBass,
    getPedalFieldSignal,
    getTensionBias,
    reset
  };
  },
});
