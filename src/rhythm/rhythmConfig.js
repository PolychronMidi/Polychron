// rhythmConfig.js - simple named rhythm profiles (delegate to RHYTHM_PROFILES in src/conductor/config.js)

rhythmConfig = (function() {
  const V = Validator.create('rhythmConfig');
  const LOCAL = {
    straight: { swing: 0, velocityScale: 1 },
    swung: { swing: 0.2, velocityScale: 1 },
    laidBack: { swing: 0.15, velocityScale: 0.9 },
    corpusAdaptive: { swing: 0.12, velocityScale: 1, useCorpusRhythmPriors: true, corpusRhythmStrength: 0.72 }
  };

  function getProfile(name) {
    V.assertNonEmptyString(name, 'name');
    const source = (typeof RHYTHM_PROFILES !== 'undefined' && RHYTHM_PROFILES) ? RHYTHM_PROFILES : (console.warn('Acceptable warning: rhythmConfig: using local defaults. For project-wide settings, define RHYTHM_PROFILES in src/conductor/config.js.'), LOCAL);
    const p = source[name];
    if (!p) throw new Error(`rhythmConfig.getProfile: unknown profile "${name}"`);
    return Object.assign({}, p);
  }

  return { getProfile };
})();
