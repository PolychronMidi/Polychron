// chordConfig.js - named voicing/progression profiles for chords

chordConfig = (function() {
  const PROFILES = {
    pop: { voices: 4, velocityScale: 1, inversion: 0, baseVelocity: 100 },
    jazz: { voices: 4, velocityScale: 0.9, inversion: 1, baseVelocity: 90 },
    ambient: { voices: 3, velocityScale: 0.6, inversion: 0, baseVelocity: 70 }
  };

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('chordConfig.getProfile: invalid name');
    const p = PROFILES[name];
    if (!p) throw new Error(`chordConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  return { getProfile, PROFILES };
})();
