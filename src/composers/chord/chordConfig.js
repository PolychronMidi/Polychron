// chordConfig.js - named voicing/progression profiles (delegates to src/conductor/config.js)

chordConfig = (function() {
  const LOCAL = {
    pop: { voices: 4, velocityScale: 1, inversion: 0, baseVelocity: 100 },
    jazz: { voices: 4, velocityScale: 0.9, inversion: 1, baseVelocity: 90 },
    ambient: { voices: 3, velocityScale: 0.6, inversion: 0, baseVelocity: 70 }
  };

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('chordConfig.getProfile: invalid name');
    const source = (typeof CHORD_PROFILES !== 'undefined' && CHORD_PROFILES) ? CHORD_PROFILES : (console.warn('Acceptable warning: chordConfig: using local defaults. For project-wide settings, define CHORD_PROFILES in src/conductor/config.js.'), LOCAL);
    const p = source[name];
    if (!p) throw new Error(`chordConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  return { getProfile };
})();
