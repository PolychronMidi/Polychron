// src/conductor/cadenceAdvisor.js -- Detects structurally appropriate cadence points.
// Listens to HARMONIC_CHANGE events to track chord progressions and advises
// when a cadence is appropriate based on section phase and harmonic trajectory.

moduleLifecycle.declare({
  name: 'cadenceAdvisor',
  subsystem: 'conductor',
  // eventBus is needed at init time for the HARMONIC_CHANGE subscription;
  // listed in deps so the registry defers until eventBus is loaded. The
  // remaining cross-subsystem references (LM, L0, harmonicContext,
  // FactoryManager) live inside method bodies that run post-boot.
  deps: ['L0', 'eventBus', 'validator'],
  lazyDeps: ['harmonicContext'],
  provides: ['cadenceAdvisor'],
  conductorScopes: ['section'],
  init: (deps) => {
    const L0 = deps.L0;
    /** @type {Array<{ key: string, chords: any, tick: number, time: number }>} */
    const recentChanges = [];
    const MAX_HISTORY = 12;

    const V = deps.validator.create('cadenceAdvisor');

    function shouldCadence() {
      const phase = harmonicContext.getField('sectionPhase');
      if (phase === 'resolution' || phase === 'conclusion') {
        return { suggest: true, type: 'authentic', confidence: 0.85 };
      }
      const phraseCtx = FactoryManager.sharedPhraseArcManager.getPhraseContext();
      const harmonicEntry = L0.getLast(L0_CHANNELS.harmonic, { layer: 'both' });
      const excursion = harmonicEntry ? V.optionalFinite(harmonicEntry.excursion, 0) : 0;
      const excursionBoost = excursion > 3 ? 0.15 : excursion > 1 ? 0.05 : 0;
      if (phraseCtx && phraseCtx.position > 0.85 && recentChanges.length >= 3) {
        return { suggest: true, type: 'half', confidence: clamp(0.55 + excursionBoost, 0, 1) };
      }
      if (excursion > 4 && phraseCtx && phraseCtx.position > 0.6) {
        return { suggest: true, type: 'deceptive', confidence: clamp(0.35 + excursionBoost, 0, 1) };
      }
      return { suggest: false, type: 'none', confidence: 0 };
    }

    function getCadenceBias() {
      const phase = harmonicContext.getField('sectionPhase');
      if (phase === 'resolution')   return { dominantBias: 0.7, tonicBias: 0.9, phase };
      if (phase === 'climax')       return { dominantBias: 0.8, tonicBias: 0.3, phase };
      if (phase === 'development')  return { dominantBias: 0.4, tonicBias: 0.3, phase };
      return { dominantBias: 0.5, tonicBias: 0.5, phase };
    }

    function getHarmonicDensity() {
      if (recentChanges.length < 2) return 0;
      const first = recentChanges[0].time;
      const last = recentChanges[recentChanges.length - 1].time;
      const span = last - first;
      if (span <= 0) return 0;
      return (recentChanges.length - 1) / span;
    }

    function reset() {
      recentChanges.length = 0;
    }

    // Wire up the HARMONIC_CHANGE subscription -- runs once at init.
    const EVENTS = V.getEventsOrThrow();
    deps.eventBus.on(EVENTS.HARMONIC_CHANGE, (data) => {
      V.requireDefined(data.key, 'HARMONIC_CHANGE.key');
      V.requireDefined(data.chords, 'HARMONIC_CHANGE.chords');
      V.requireFinite(data.tick, 'HARMONIC_CHANGE.tick');
      V.requireFinite(data.timestamp, 'HARMONIC_CHANGE.timestamp');
      recentChanges.push({ key: data.key, chords: data.chords, tick: data.tick, time: data.timestamp });
      if (recentChanges.length > MAX_HISTORY) recentChanges.shift();
      if (LM.activeLayer && typeof LM.activeLayer === 'string') {
        L0.post(L0_CHANNELS.chord, LM.activeLayer, beatStartTime, { chords: data.chords, key: data.key, mode: data.mode });
      }
    });

    return { shouldCadence, getCadenceBias, getHarmonicDensity, reset };
  },
  stateProvider: () => ({ recentChanges: cadenceAdvisor.getHarmonicDensity() }),
});
