// src/conductor/texture/restDensityTracker.js - Tracks rest-to-onset ratio across layers.
// Flags over-saturation (wall of sound) or sparse deserts.
// Also detects phrase breathing points - merged from PhraseBreathingAdvisor.
// Pure query API - biases rhythm onset probability and phrase breathing.

restDensityTracker = (() => {
  const V = validator.create('restDensityTracker');
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
    const bounds = L0.getBounds('note', { layer, windowSeconds: ws });
    if (bounds.count < 2) {
      return { notesPerSecond: 0, saturated: false, sparse: true };
    }

    const first = bounds.first;
    const last = bounds.last;
    if (!first || !last) return { notesPerSecond: 0, saturated: false, sparse: true };

    const span = last.time - first.time;
    if (span <= 0) return { notesPerSecond: 0, saturated: false, sparse: true };

    const nps = bounds.count / span;
    return {
      notesPerSecond: nps,
      saturated: nps > 12,
      sparse: nps < 1.5
    };
  }

  /**
   * Bias factor for rhythm onset probability.
   * Continuous ramp: sparse - boost, dense - suppress.
    * Output range matches registered clamp [0.90, 1.15] - no boundary pinning.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
    * @returns {number} - 0.90 to 1.15
   */
  function getOnsetBias(opts) {
    const density = getOnsetDensity(opts);
    const nps = density.notesPerSecond;
    // Sparse zone: nps 0-3 - bias 1.15-1.0
    if (nps <= 3) {
      const ramp = clamp((3 - nps) / 3, 0, 1);
      return 1.0 + ramp * 0.15;
    }
    // Dense zone: nps 15-40 - bias 1.0-0.88
    if (nps >= 15) {
      const ramp = clamp((nps - 15) / 25, 0, 1);
      return 1.0 - ramp * 0.10;
    }
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

  // Breathing analysis (merged from PhraseBreathingAdvisor)

  /**
   * Analyze breathing density (inter-onset gaps) in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ breathCount: number, avgGap: number, maxGap: number, breathless: boolean, airy: boolean }}
   */
  function getBreathingProfile(opts = {}) {
    const notes = analysisHelpers.getWindowNotes(V, opts, 6);
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
   * Continuous ramp based on breath ratio: few breaths - suppress, many - boost.
    * Output range matches registered clamp [0.90, 1.15].
   * @param {Object} [opts]
   * @param {string} [opts.layer]
    * @returns {number} - 0.90 to 1.15
   */
  function getBreathingDensityBias(opts) {
    const profile = getBreathingProfile(opts);
    if (profile.breathCount === 0 && profile.avgGap === 0) return 1.0;
    // breathRatio: fraction of inter-onset gaps that are "breaths" (>0.3s)
    // Low ratio = wall of sound, high ratio = airy
    const noteCount = profile.breathCount + 1; // approximate
    const breathRatio = noteCount > 1 ? profile.breathCount / noteCount : 0;
    // Breathless zone: ratio 0-0.05 - bias 0.88-1.0
    if (breathRatio <= 0.05) {
      const ramp = clamp((0.05 - breathRatio) / 0.05, 0, 1);
      return 1.0 - ramp * 0.10;
    }
    // Airy zone: ratio 0.35-0.60 - bias 1.0-1.15
    if (breathRatio >= 0.35) {
      const ramp = clamp((breathRatio - 0.35) / 0.25, 0, 1);
      return 1.0 + ramp * 0.15;
    }
    return 1.0;
  }

  // Single combined registration: onset and breathing were separate registrations
  // both pinned at 0.85 floor, giving 0.85^2 = 0.7225 from one module. Merged
  // into a geometric mean so the module has one voice in the density product.
  conductorIntelligence.registerDensityBias('restDensityTracker', () => {
    const onset = restDensityTracker.getOnsetBias();
    const breathing = restDensityTracker.getBreathingDensityBias();
    return m.sqrt(onset * breathing);
  }, 0.90, 1.20);

  return {
    getOnsetDensity,
    getOnsetBias,
    getCrossLayerBalance,
    getBreathingProfile,
    getBreathingDensityBias
  };
})();
