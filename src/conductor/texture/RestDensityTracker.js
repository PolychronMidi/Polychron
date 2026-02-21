// src/conductor/texture/RestDensityTracker.js - Tracks rest-to-onset ratio across layers.
// Flags over-saturation (wall of sound) or sparse deserts.
// Also detects phrase breathing points — merged from PhraseBreathingAdvisor.
// Pure query API — biases rhythm onset probability and phrase breathing.

RestDensityTracker = (() => {
  const V = Validator.create('RestDensityTracker');
  const WINDOW_SECONDS = 4;
  const BREATH_THRESHOLD = 0.3; // gaps >0.3s count as breaths

  /**
   * Get onset density: notes per second in the recent window.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ notesPerSecond: number, saturated: boolean, sparse: boolean }}
   */
  function getOnsetDensity(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 2) {
      return { notesPerSecond: 0, saturated: false, sparse: true };
    }

    const first = notes[0];
    const last = notes[notes.length - 1];
    if (!first || !last) return { notesPerSecond: 0, saturated: false, sparse: true };

    const span = last.time - first.time;
    if (span <= 0) return { notesPerSecond: 0, saturated: false, sparse: true };

    const nps = notes.length / span;
    return {
      notesPerSecond: nps,
      saturated: nps > 12,
      sparse: nps < 1.5
    };
  }

  /**
   * Bias factor for rhythm onset probability.
   * Saturated → reduce onsets; sparse → boost onsets.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.7 to 1.3
   */
  function getOnsetBias(opts) {
    const density = getOnsetDensity(opts);
    if (density.saturated) return 0.75;
    if (density.sparse) return 1.25;
    return 1.0;
  }

  /**
   * Compare density across layers. Returns which layer is denser.
   * @returns {{ denser: string, ratio: number }}
   */
  function getCrossLayerBalance() {
    const l1 = getOnsetDensity({ layer: 'L1' });
    const l2 = getOnsetDensity({ layer: 'L2' });
    const l1nps = l1.notesPerSecond;
    const l2nps = l2.notesPerSecond;
    if (l1nps === 0 && l2nps === 0) return { denser: 'equal', ratio: 1 };
    if (l2nps === 0) return { denser: 'L1', ratio: 2 };
    if (l1nps === 0) return { denser: 'L2', ratio: 2 };
    const ratio = l1nps / l2nps;
    if (ratio > 1.5) return { denser: 'L1', ratio };
    if (ratio < 0.67) return { denser: 'L2', ratio: 1 / ratio };
    return { denser: 'equal', ratio };
  }

  // --- Breathing analysis (merged from PhraseBreathingAdvisor) ---

  /**
   * Analyze breathing density (inter-onset gaps) in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ breathCount: number, avgGap: number, maxGap: number, breathless: boolean, airy: boolean }}
   */
  function getBreathingProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, 6);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { breathCount: 0, avgGap: 0, maxGap: 0, breathless: false, airy: false };
    }

    let gapSum = 0;
    let maxGap = 0;
    let breathCount = 0;
    let gapCount = 0;

    for (let i = 1; i < notes.length; i++) {
      const gap = notes[i].time - notes[i - 1].time;
      if (gap > 0) {
        gapSum += gap;
        gapCount++;
        if (gap > maxGap) maxGap = gap;
        if (gap >= BREATH_THRESHOLD) breathCount++;
      }
    }

    const avgGap = gapCount > 0 ? gapSum / gapCount : 0;
    const breathless = breathCount === 0 && notes.length > 8;
    const airy = breathCount > notes.length * 0.4;

    return { breathCount, avgGap, maxGap, breathless, airy };
  }

  /**
   * Density bias to enforce breathing room.
   * Breathless → reduce density; airy → boost density.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.8 to 1.2
   */
  function getBreathingDensityBias(opts) {
    const profile = getBreathingProfile(opts);
    if (profile.breathless) return 0.85;
    if (profile.airy) return 1.15;
    return 1.0;
  }

  ConductorIntelligence.registerDensityBias('RestDensityTracker:onset', () => RestDensityTracker.getOnsetBias(), 0.7, 1.3);
  ConductorIntelligence.registerDensityBias('RestDensityTracker:breathing', () => RestDensityTracker.getBreathingDensityBias(), 0.8, 1.2);

  return {
    getOnsetDensity,
    getOnsetBias,
    getCrossLayerBalance,
    getBreathingProfile,
    getBreathingDensityBias
  };
})();
