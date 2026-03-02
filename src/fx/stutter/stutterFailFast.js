// stutterFailFast.js - shared dependency and payload checks for stutter modules

stutterFailFast = (() => {
  const V = validator.create('stutterFailFast');

  function requireEventInfra() {
    const eventName = V.getEventsOrThrow().STUTTER_APPLIED;
    return { eventName };
  }

  function requireChannelArrays() {
    V.assertArray(reflection, 'reflection');
    V.assertArray(bass, 'bass');
    return { reflectionChannels: reflection, bassChannels: bass };
  }

  function assertModulationXY(mod) {
    V.assertObject(mod, 'mod');
    V.requireFinite(mod.x, 'mod.x');
    V.requireFinite(mod.y, 'mod.y');
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
