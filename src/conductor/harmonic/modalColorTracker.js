// src/conductor/modalColorTracker.js - Tracks which scale degrees are actually sounding.
// Detects "vanilla" (1-3-5 heavy) vs. colorful (2, 4, 6, 7) pitch usage.
// Pure query API - biases note selection toward underused color tones.

moduleLifecycle.declare({
  name: 'modalColorTracker',
  subsystem: 'conductor',
  deps: ['L0', 'conductorIntelligence', 'validator'],
  lazyDeps: ['pitchClassHelpers'],
  provides: ['modalColorTracker'],
  init: (deps) => {
  const L0 = deps.L0;
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('modalColorTracker');
  const WINDOW_SECONDS = 6;
  // Scale-degree categories
  const CHORD_TONES = new Set([0, 4, 7]); // root, major 3rd, perfect 5th (approx)
  const COLOR_TONES = new Set([1, 2, 3, 5, 6, 8, 9, 10, 11]); // everything else

  /**
   * Analyze pitch-class distribution in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ pcDistribution: Array<number>, chordToneRatio: number, colorToneRatio: number, vanilla: boolean, colorful: boolean }}
   */
  function getModalProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const { counts: pcCounts, total } = pitchClassHelpers.getPitchClassHistogram(ws, layer);

    if (total < 3) {
      return { pcDistribution: pcCounts, chordToneRatio: 0, colorToneRatio: 0, vanilla: false, colorful: false };
    }

    let chordToneCount = 0;
    let colorToneCount = 0;
    for (let i = 0; i < 12; i++) {
      if (CHORD_TONES.has(i)) chordToneCount += pcCounts[i];
      if (COLOR_TONES.has(i)) colorToneCount += pcCounts[i];
    }

    const toneTotal = chordToneCount + colorToneCount;
    const chordToneRatio = toneTotal > 0 ? chordToneCount / toneTotal : 0;
    const colorToneRatio = toneTotal > 0 ? colorToneCount / toneTotal : 0;

    return {
      pcDistribution: pcCounts,
      chordToneRatio,
      colorToneRatio,
      vanilla: chordToneRatio > 0.75,
      colorful: colorToneRatio > 0.6
    };
  }

  /**
   * Get a note-selection bias to encourage modal variety.
   * Vanilla - boost color tones; overly colorful - stabilize with chord tones.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ colorBias: number, stabilityBias: number }}
   */
  function getColorBias(opts) {
    const profile = getModalProfile(opts);
    if (profile.vanilla) {
      return { colorBias: 1.3, stabilityBias: 0.85 };
    }
    if (profile.colorful) {
      return { colorBias: 0.8, stabilityBias: 1.2 };
    }
    return { colorBias: 1.0, stabilityBias: 1.0 };
  }

  /**
   * Get underused pitch classes to suggest to composers.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {Array<number>} - pitch classes (0-11) that are underrepresented
   */
  function getUnderusedPitchClasses(opts) {
    const profile = getModalProfile(opts);
    const total = profile.pcDistribution.reduce((a, b) => a + b, 0);
    if (total < 6) return [];

    const expected = total / 12;
    const underused = [];
    for (let i = 0; i < 12; i++) {
      if (profile.pcDistribution[i] < expected * 0.3) {
        underused.push(i);
      }
    }
    return underused;
  }

  conductorIntelligence.registerStateProvider('modalColorTracker', () => {
    const b = modalColorTracker.getColorBias();
    return { modalColorBias: b ? b.colorBias : 1, modalStabilityBias: b ? b.stabilityBias : 1 };
  });
  // Xenolinguistic L1: post underused pitch classes to L0 for voice selection diversity
  conductorIntelligence.registerRecorder('modalColorTracker', (ctx) => {
    const underused = modalColorTracker.getUnderusedPitchClasses();
    if (underused.length > 0) {
      L0.post(L0_CHANNELS.underusedPitchClasses, 'both', ctx.absTime, { pitchClasses: underused });
    }
  });

  function reset() {}
  conductorIntelligence.registerModule('modalColorTracker', { reset }, ['section']);

  return {
    getModalProfile,
    getColorBias,
    getUnderusedPitchClasses
  };
  },
});
