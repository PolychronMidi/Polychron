HarmonicRhythmTracker = (() => {
  const V = Validator.create('HarmonicRhythmTracker');

  let initialized = false;
  let lastTick = null;
  let harmonicRhythm = 0;
  let changesInSection = 0;

  function normalizeTick(tick) {
    const n = Number(tick);
    if (Number.isFinite(n)) return n;
    if (Number.isFinite(Number(beatStart))) return Number(beatStart);
    return 0;
  }

  function tickDistanceToRate(currentTick) {
    if (lastTick === null) return 0.35;
    const delta = m.max(1, m.abs(currentTick - lastTick));
    const measureTicks = Number.isFinite(Number(tpMeasure)) ? m.max(1, Number(tpMeasure)) : 1;
    return clamp(measureTicks / (measureTicks + delta), 0, 1);
  }

  function resetSection() {
    harmonicRhythm *= 0.5;
    changesInSection = 0;
    lastTick = null;
  }

  function initialize() {
    if (initialized) return;
    const EVENTS = V.getEventsOrThrow();

    ConductorIntelligence.registerModule('HarmonicRhythmTracker', { reset: resetSection }, ['section']);

    EventBus.on(EVENTS.HARMONIC_CHANGE, (data) => {
      const tick = normalizeTick(data.tick);
      const instant = tickDistanceToRate(tick);
      const changedFields = data.changedFields;
      const chordBonus = changedFields.includes('chords') ? 0.08 : 0;

      harmonicRhythm = clamp(harmonicRhythm * 0.74 + (instant + chordBonus) * 0.26, 0, 1);
      lastTick = tick;
      changesInSection++;
    });

    initialized = true;
  }

  function getHarmonicRhythm() {
    return clamp(harmonicRhythm, 0, 1);
  }

  function getMetrics() {
    return {
      harmonicRhythm: clamp(harmonicRhythm, 0, 1),
      changesInSection,
      lastTick
    };
  }

  function reset() {
    lastTick = null;
    harmonicRhythm = 0;
    changesInSection = 0;
  }

  return {
    initialize,
    getHarmonicRhythm,
    getMetrics,
    reset
  };
})();
