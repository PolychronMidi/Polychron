ConductorRegulationListener = (() => {
  const EVENTS = (typeof EventCatalog !== 'undefined' && EventCatalog && EventCatalog.names)
    ? EventCatalog.names
    : {
        CONDUCTOR_REGULATION: 'conductor-regulation',
        SECTION_BOUNDARY: 'section-boundary'
      };

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

    EventBus.on(EVENTS.CONDUCTOR_REGULATION, (data) => {
      if (!data || typeof data !== 'object') {
        throw new Error('ConductorRegulationListener: invalid conductor-regulation payload');
      }

      const avg = Number(data.avg);
      const densityBias = Number(data.densityBias);
      const crossModBias = Number(data.crossModBias);
      const profile = data.profile;

      state.avg = Number.isFinite(avg) ? clamp(avg, 0, 1) : state.avg;
      state.densityBias = Number.isFinite(densityBias) ? densityBias : state.densityBias;
      state.crossModBias = Number.isFinite(crossModBias) ? clamp(crossModBias, 0.5, 1.5) : state.crossModBias;
      state.profile = (typeof profile === 'string' && profile.length > 0) ? profile : state.profile;

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
