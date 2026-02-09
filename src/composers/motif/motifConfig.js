// motifConfig.js - named motif profiles

motifConfig = (function() {
  const PROFILES = {
    default: { velocityScale: 1, timingOffset: 0 },
    sparse: { velocityScale: 0.8, timingOffset: 0.1 },
    dense: { velocityScale: 1.2, timingOffset: -0.05 }
  };

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('motifConfig.getProfile: invalid name');
    const p = PROFILES[name];
    if (!p) throw new Error(`motifConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  return { getProfile, PROFILES };
})();
