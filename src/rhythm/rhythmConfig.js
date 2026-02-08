// rhythmConfig.js - simple named rhythm profiles

rhythmConfig = (function() {
  const PROFILES = {
    straight: { swing: 0, velocityScale: 1 },
    swung: { swing: 0.2, velocityScale: 1 },
    laidBack: { swing: 0.15, velocityScale: 0.9 }
  };

  function getProfile(name) {
    if (!name || typeof name !== 'string') throw new Error('rhythmConfig.getProfile: invalid name');
    const p = PROFILES[name];
    if (!p) throw new Error(`rhythmConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  return { getProfile, PROFILES };
})();
