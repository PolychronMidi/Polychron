// motifConfig.js - named motif profiles (delegates authoritative profiles to src/config.js)

motifConfig = (function() {
  const LOCAL = {
    default: { velocityScale: 1, timingOffset: 0 },
    sparse: { velocityScale: 0.8, timingOffset: 0.1 },
    dense: { velocityScale: 1.2, timingOffset: -0.05 }
  };

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('motifConfig.getProfile: invalid name');
    const source = (typeof MOTIF_PROFILES !== 'undefined' && MOTIF_PROFILES) ? MOTIF_PROFILES : (console.warn('Acceptable warning: motifConfig: using local defaults. For project-wide settings, define MOTIF_PROFILES in src/config.js.'), LOCAL);
    const p = source[name];
    if (!p) throw new Error(`motifConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  return { getProfile };
})();
