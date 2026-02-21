// src/conductor/CadenceAdvisor.js - Detects structurally appropriate cadence points.
// Listens to HARMONIC_CHANGE events to track chord progressions and advises
// when a cadence is appropriate based on section phase and harmonic trajectory.

CadenceAdvisor = (() => {
  /** @type {Array<{ key: string, chords: any, tick: number, time: number }>} */
  const recentChanges = [];
  const MAX_HISTORY = 12;

  const V = Validator.create('CadenceAdvisor');

  /**
   * Wire up EventBus listener for harmonic-change events.
   * Must be called after EventBus and EVENTS are available.
   */
  function initialize() {
    const EVENTS = V.getEventsOrThrow();

    EventBus.on(EVENTS.HARMONIC_CHANGE, (data) => {
      V.requireDefined(data.key, 'HARMONIC_CHANGE.key');
      V.requireDefined(data.chords, 'HARMONIC_CHANGE.chords');
      V.requireFinite(data.tick, 'HARMONIC_CHANGE.tick');
      V.requireFinite(data.timestamp, 'HARMONIC_CHANGE.timestamp');
      recentChanges.push({
        key: data.key,
        chords: data.chords,
        tick: data.tick,
        time: data.timestamp
      });
      if (recentChanges.length > MAX_HISTORY) recentChanges.shift();

      // Also feed chord changes into AbsoluteTimeWindow for cross-layer analysis
      const layer = LM.activeLayer;
      V.requireFinite(beatStartTime, 'beatStartTime');
      AbsoluteTimeWindow.recordChord(data.chords, data.key, data.mode, layer, beatStartTime);
    });
  }

  /**
   * Advise whether the current moment is appropriate for a cadence.
   * Considers section phase, harmonic change density, and phrase position.
   * @returns {{ suggest: boolean, type: string, confidence: number }}
   */
  function shouldCadence() {
    const phase = HarmonicContext.getField('sectionPhase');

    // Resolution and conclusion phases strongly suggest cadence
    if (phase === 'resolution' || phase === 'conclusion') {
      return { suggest: true, type: 'authentic', confidence: 0.85 };
    }

    // Near phrase boundaries with sufficient harmonic motion → mild cadence suggestion
    const phraseCtx = ComposerFactory.sharedPhraseArcManager.getPhraseContext();

    if (phraseCtx && phraseCtx.position > 0.85 && recentChanges.length >= 3) {
      return { suggest: true, type: 'half', confidence: 0.55 };
    }

    return { suggest: false, type: 'none', confidence: 0 };
  }

  /**
   * Get a cadence-aware chord bias to guide chord selection.
   * Returns weight adjustments favoring cadential progressions.
   * @returns {{ dominantBias: number, tonicBias: number, phase: string }}
   */
  function getCadenceBias() {
    const phase = HarmonicContext.getField('sectionPhase');

    if (phase === 'resolution') {
      return { dominantBias: 0.7, tonicBias: 0.9, phase };
    }
    if (phase === 'climax') {
      return { dominantBias: 0.8, tonicBias: 0.3, phase };
    }
    if (phase === 'development') {
      return { dominantBias: 0.4, tonicBias: 0.3, phase };
    }
    return { dominantBias: 0.5, tonicBias: 0.5, phase };
  }

  /**
   * Get the density of recent harmonic changes (changes per second).
   * @returns {number}
   */
  function getHarmonicDensity() {
    if (recentChanges.length < 2) return 0;
    const first = recentChanges[0].time;
    const last = recentChanges[recentChanges.length - 1].time;
    const span = last - first;
    if (span <= 0) return 0;
    return (recentChanges.length - 1) / span;
  }

  /** Reset state. */
  function reset() {
    recentChanges.length = 0;
  }

  return {
    initialize,
    shouldCadence,
    getCadenceBias,
    getHarmonicDensity,
    reset
  };
})();
ConductorIntelligence.registerStateProvider('CadenceAdvisor', () => ({
  recentChanges: CadenceAdvisor.getHarmonicDensity()
}));
