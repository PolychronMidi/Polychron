ConductorRegulationListener = (() => {
  const V = Validator.create('ConductorRegulationListener');

  let initialized = false;

  const state = {
    avg: 0,
    densityBias: 0,
    crossModBias: 1,
    profile: 'default'
  };

  function applyJourneyBias(crossModBias) {
    V.requireDefined(JourneyRhythmCoupler, 'JourneyRhythmCoupler');
    JourneyRhythmCoupler.setExternalBias(crossModBias);
    return true;
  }

  function initialize() {
    if (initialized) return;
    const EVENTS = V.getEventsOrThrow();

    EventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
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

    EventBus.on(EVENTS.SECTION_BOUNDARY, () => {
      state.avg = 0;
      state.densityBias = 0;
      state.crossModBias = 1;
      applyJourneyBias(1);
    });

    initialized = true;
  }

  function getState() {
    return Object.assign({}, state);
  }

  return {
    initialize,
    getState
  };
})();
