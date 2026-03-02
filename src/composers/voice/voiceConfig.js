// voiceConfig.js - voice-related presets (delegates authoritative profiles to src/conductor/config.js)

voiceConfig = (function() {
  const V = validator.create('voiceConfig');
  function getProfile(name) {
    V.assertNonEmptyString(name, 'getProfile.name');
    // Prefer centralized VOICE_PROFILES if provided in src/conductor/config.js
    const source = VOICE_PROFILES;
    const p = source[name];
    if (!p) throw new Error(`voiceConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }
  return { getProfile };
})();
