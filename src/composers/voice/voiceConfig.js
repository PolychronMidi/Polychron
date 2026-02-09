// voiceConfig.js - small voice-related presets

voiceConfig = (function() {
  const PROFILES = {
    default: { baseVelocity: 90 },
    soft: { baseVelocity: 70 },
    loud: { baseVelocity: 110 }
  };
  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('voiceConfig.getProfile: invalid name');
    const p = PROFILES[name];
    if (!p) throw new Error(`voiceConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }
  return { getProfile, PROFILES };
})();
