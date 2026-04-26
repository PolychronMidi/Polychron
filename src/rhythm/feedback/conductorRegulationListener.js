moduleLifecycle.declare({
  name: 'conductorRegulationListener',
  subsystem: 'rhythm',
  deps: ['eventBus', 'journeyRhythmCoupler', 'validator'],
  provides: ['conductorRegulationListener'],
  // crossLayerScopes manifest field replaces the inline crossLayerRegistry.register call.
  crossLayerScopes: ['section'],
  init: (deps) => {
  const eventBus = deps.eventBus;
  const journeyRhythmCoupler = deps.journeyRhythmCoupler;
  const V = deps.validator.create('conductorRegulationListener');

  const state = {
    avg: 0,
    densityBias: 0,
    crossModBias: 1,
    profile: 'default'
  };

  function applyJourneyBias(crossModBias) {
    journeyRhythmCoupler.setExternalBias(crossModBias);
    return true;
  }

  function resetSection() {
    state.avg = 0;
    state.densityBias = 0;
    state.crossModBias = 1;
    applyJourneyBias(1);
  }

  function getState() {
    return Object.assign({}, state);
  }

  // Wire eventBus subscription inline (deps guaranteed bound).
  const EVENTS = V.getEventsOrThrow();
  eventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
    const avg = V.requireFinite(data.avg, 'conductor-regulation.avg');
    const densityBias = V.requireFinite(data.densityBias, 'conductor-regulation.densityBias');
    const crossModBias = V.requireFinite(data.crossModBias, 'conductor-regulation.crossModBias');
    const profile = data.profile;
    V.assertNonEmptyString(profile, 'conductor-regulation.profile');

    state.avg = clamp(avg, 0, 1);
    state.densityBias = densityBias;
    state.crossModBias = clamp(crossModBias, 0.5, 1.5);
    state.profile = profile;

    applyJourneyBias(state.crossModBias);
  });

  return {
    getState,
    resetSection,
    reset: resetSection
  };
  },
});
