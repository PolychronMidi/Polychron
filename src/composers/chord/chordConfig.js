// chordConfig.js - named voicing/progression profiles (delegates to src/conductor/config.js)

chordConfig = (function() {
  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('chordConfig.getProfile: invalid name');
    const source = CHORD_PROFILES;
    const p = source[name];
    if (!p) throw new Error(`chordConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  return { getProfile };
})();
