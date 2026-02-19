ConductorRegulationListener = (() => {
  const { getEventsOrThrow } = Validator;

  let initialized = false;

  const state = {
    avg: 0,
    densityBias: 0,
    crossModBias: 1,
    profile: 'default'
  };

  function applyJourneyBias(crossModBias) {
    if (typeof JourneyRhythmCoupler === 'undefined' || !JourneyRhythmCoupler || typeof JourneyRhythmCoupler.setExternalBias !== 'function') {
      throw new Error('ConductorRegulationListener.applyJourneyBias: JourneyRhythmCoupler.setExternalBias is not available');
    }
    JourneyRhythmCoupler.setExternalBias(crossModBias);
    return true;
  }

  function initialize() {
    if (initialized) return;
    if (typeof EventBus === 'undefined' || !EventBus || typeof EventBus.on !== 'function') {
      throw new Error('ConductorRegulationListener.initialize: EventBus not available');
    }
    const EVENTS = getEventsOrThrow('ConductorRegulationListener');

    EventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
      if (!data || typeof data !== 'object') {
        throw new Error('ConductorRegulationListener: invalid conductor-regulation payload');
      }

      const avg = Number(data.avg);
      const densityBias = Number(data.densityBias);
      const crossModBias = Number(data.crossModBias);
      const profile = data.profile;

      if (!Number.isFinite(avg) || !Number.isFinite(densityBias) || !Number.isFinite(crossModBias)) {
        throw new Error('ConductorRegulationListener: avg/densityBias/crossModBias must be finite numbers');
      }
      if (typeof profile !== 'string' || profile.length === 0) {
        throw new Error('ConductorRegulationListener: profile must be a non-empty string');
      }

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
