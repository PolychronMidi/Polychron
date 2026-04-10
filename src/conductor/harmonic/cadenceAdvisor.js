// src/conductor/cadenceAdvisor.js - Detects structurally appropriate cadence points.
// Listens to HARMONIC_CHANGE events to track chord progressions and advises
// when a cadence is appropriate based on section phase and harmonic trajectory.

cadenceAdvisor = (() => {
  /** @type {Array<{ key: string, chords: any, tick: number, time: number }>} */
  const recentChanges = [];
  const MAX_HISTORY = 12;

  const V = validator.create('cadenceAdvisor');

  /**
   * Wire up eventBus listener for harmonic-change events.
   * Must be called after eventBus and EVENTS are available.
   */
  function initialize() {
    const EVENTS = V.getEventsOrThrow();

    eventBus.on(EVENTS.HARMONIC_CHANGE, (data) => {
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

      // Feed chord changes into L0 for cross-layer analysis (skip if no layer active yet)
      if (LM.activeLayer && typeof LM.activeLayer === 'string') {
        L0.post(L0_CHANNELS.chord, LM.activeLayer, beatStartTime, { chords: data.chords, key: data.key, mode: data.mode });
      }
    });
  }

  /**
   * Advise whether the current moment is appropriate for a cadence.
   * Considers section phase, harmonic change density, and phrase position.
   * @returns {{ suggest: boolean, type: string, confidence: number }}
   */
  function shouldCadence() {
    const phase = harmonicContext.getField('sectionPhase');

    // Resolution and conclusion phases strongly suggest cadence
    if (phase === 'resolution' || phase === 'conclusion') {
      return { suggest: true, type: 'authentic', confidence: 0.85 };
    }

    // Near phrase boundaries with sufficient harmonic motion - mild cadence suggestion
    const phraseCtx = FactoryManager.sharedPhraseArcManager.getPhraseContext();

    // Distant keys need stronger cadence resolution
    const harmonicEntry = L0.getLast(L0_CHANNELS.harmonic, { layer: 'both' });
    const excursion = harmonicEntry ? V.optionalFinite(harmonicEntry.excursion, 0) : 0;
    const excursionBoost = excursion > 3 ? 0.15 : excursion > 1 ? 0.05 : 0;

    if (phraseCtx && phraseCtx.position > 0.85 && recentChanges.length >= 3) {
      return { suggest: true, type: 'half', confidence: clamp(0.55 + excursionBoost, 0, 1) };
    }

    // Distant keys mid-phrase can also trigger cadence suggestion
    if (excursion > 4 && phraseCtx && phraseCtx.position > 0.6) {
      return { suggest: true, type: 'deceptive', confidence: clamp(0.35 + excursionBoost, 0, 1) };
    }

    return { suggest: false, type: 'none', confidence: 0 };
  }

  /**
   * Get a cadence-aware chord bias to guide chord selection.
   * Returns weight adjustments favoring cadential progressions.
   * @returns {{ dominantBias: number, tonicBias: number, phase: string }}
   */
  function getCadenceBias() {
    const phase = harmonicContext.getField('sectionPhase');

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

  moduleLifecycle.registerInitializer('cadenceAdvisor', initialize);

  return {
    initialize,
    shouldCadence,
    getCadenceBias,
    getHarmonicDensity,
    reset
  };
})();
conductorIntelligence.registerStateProvider('cadenceAdvisor', () => ({
  recentChanges: cadenceAdvisor.getHarmonicDensity()
}));
conductorIntelligence.registerModule('cadenceAdvisor', { reset: cadenceAdvisor.reset }, ['section']);
