// voiceConfig.js - voice-related presets (delegates authoritative profiles to central config.js)

voiceConfig = (function() {
  const LOCAL = {
    default: { baseVelocity: 90 },
    soft: { baseVelocity: 70 },
    loud: { baseVelocity: 110 }
  };

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('voiceConfig.getProfile: invalid name');
    // Prefer centralized VOICE_PROFILES if provided in config.js
    const source = (typeof VOICE_PROFILES !== 'undefined' && VOICE_PROFILES) ? VOICE_PROFILES : (console.warn('Acceptable warning: voiceConfig: using local defaults. For project-wide settings, define VOICE_PROFILES in src/config.js.'), LOCAL);
    const p = source[name];
    if (!p) throw new Error(`voiceConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }
  return { getProfile };
})();
