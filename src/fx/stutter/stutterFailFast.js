// stutterFailFast.js - shared dependency and payload checks for stutter modules

StutterFailFast = (() => {
  const V = Validator.create('StutterFailFast');

  function requireEventInfra(caller) {
    if (typeof EventBus === 'undefined' || !EventBus || typeof EventBus.emit !== 'function') {
      throw new Error(`${caller}: EventBus.emit is not available`);
    }
    const eventName = V.getEventsOrThrow().STUTTER_APPLIED;
    return { eventName, eventBus: EventBus };
  }

  function requireChannelArrays(caller) {
    if (typeof reflection === 'undefined' || !Array.isArray(reflection)) {
      throw new Error(`${caller}: reflection channel array is not available`);
    }
    if (typeof bass === 'undefined' || !Array.isArray(bass)) {
      throw new Error(`${caller}: bass channel array is not available`);
    }
    return { reflectionChannels: reflection, bassChannels: bass };
  }

  function assertModulationXY(mod, label) {
    if (!mod || !Number.isFinite(Number(mod.x)) || !Number.isFinite(Number(mod.y))) {
      throw new Error(`StutterFailFast: ${label} modulation must have finite x/y`);
    }
    return mod;
  }

  function inferProfile(channel, reflectionChannels, bassChannels) {
    if (reflectionChannels.includes(channel)) return 'reflection';
    if (bassChannels.includes(channel)) return 'bass';
    return 'source';
  }

  return {
    requireEventInfra,
    requireChannelArrays,
    assertModulationXY,
    inferProfile
  };
})();
