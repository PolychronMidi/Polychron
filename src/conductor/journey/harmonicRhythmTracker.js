moduleLifecycle.declare({
  name: 'harmonicRhythmTracker',
  subsystem: 'conductor',
  // eventBus + validator are legacy globals (still IIFE-loaded); listed in
  // deps so the registry resolves them via namespace lookup. conductorScopes
  // replaces the manual conductorIntelligence.registerModule call from the
  // old initialize() function.
  deps: ['validator', 'eventBus'],
  provides: ['harmonicRhythmTracker'],
  conductorScopes: ['section'],
  init: (deps) => {
    const V = deps.validator.create('harmonicRhythmTracker');
    let lastTick = null;
    let harmonicRhythm = 0;
    let changesInSection = 0;

    function normalizeTick(tick) {
      return V.requireFinite(Number(tick), 'tick');
    }

    function tickDistanceToRate(currentTick) {
      if (lastTick === null) return 0.35;
      const delta = m.max(1, m.abs(currentTick - lastTick));
      const measureSecs = m.max(0.001, V.requireFinite(spMeasure, 'spMeasure'));
      return clamp(measureSecs / (measureSecs + delta), 0, 1);
    }

    // resetSection is what conductorIntelligence calls at section boundaries
    // (registered automatically via the conductorScopes manifest field).
    function resetSection() {
      harmonicRhythm *= 0.5;
      changesInSection = 0;
      lastTick = null;
    }

    function getHarmonicRhythm() {
      return clamp(harmonicRhythm, 0, 1);
    }

    function getMetrics() {
      return {
        harmonicRhythm: clamp(harmonicRhythm, 0, 1),
        changesInSection,
        lastTick,
      };
    }

    function reset() {
      lastTick = null;
      harmonicRhythm = 0;
      changesInSection = 0;
    }

    // What used to live in initialize() runs here -- deps are guaranteed.
    const EVENTS = V.getEventsOrThrow();
    deps.eventBus.on(EVENTS.HARMONIC_CHANGE, (data) => {
      const tick = normalizeTick(data.tick);
      const instant = tickDistanceToRate(tick);
      const changedFields = data.changedFields;
      const chordBonus = changedFields.includes('chords') ? 0.08 : 0;

      harmonicRhythm = clamp(harmonicRhythm * 0.74 + (instant + chordBonus) * 0.26, 0, 1);
      lastTick = tick;
      changesInSection++;
    });

    return {
      // Conductor section reset — wired automatically via conductorScopes.
      reset: resetSection,
      getHarmonicRhythm,
      getMetrics,
      // Public reset (used by external callers, distinct from the section-scoped
      // resetSection that decays harmonicRhythm by half rather than zeroing it).
      hardReset: reset,
    };
  },
});
