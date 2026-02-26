// src/conductor/phraseArcProfiler.js
// Pure arc profile helpers extracted from PhraseArcManager.
// Provides breath profile, phase classification, and arc profile generation.

phraseArcProfiler = (() => {
  /**
   * Get phrase breath parameters from conductorConfig with built-in fallback.
   * @returns {Object} breath profile with registerRange, densityRange, independence, dynamism
   */
  function getBreathProfile() {
    const bp = conductorConfig.getPhraseBreathParams();
    if (bp && typeof bp === 'object') {
      return bp;
    }
    return {
      registerRange: 12,
      densityRange: { min: 0.85, max: 1.3 },
      independence: {
        archInner: 0.7,
        archOuter: 0.3,
        riseFallInner: 0.6,
        riseFallOuter: 0.4,
        buildResolveInner: 0.8,
        buildResolveOuter: 0.3,
        waveBase: 0.4,
        waveAmplitude: 0.4
      },
      dynamism: {
        archBase: 0.5,
        archAmplitude: 0.5,
        riseFallBase: 0.4,
        riseFallAmplitude: 0.6,
        buildResolveBase: 0.3,
        buildResolveSlope: 0.7,
        buildResolveEnd: 0.2,
        waveBase: 0.5,
        waveAmplitude: 0.5
      }
    };
  }

  /**
   * Get phase label from normalized phrase position.
   * @param {number} pos - 0-1
   * @returns {string}
   */
  function getPhase(pos) {
    if (pos < 0.25) return 'opening';
    if (pos < 0.5) return 'development';
    if (pos < 0.75) return 'climax';
    return 'resolution';
  }

  /**
   * Generate arc profile functions from PHRASES_ARC_CURVES global.
   * Throws if the global is missing — arc curves must be centralized in config.
   * @returns {Object.<string, {register:Function, density:Function, independence:Function, dynamism:Function}>}
   */
  function generateArcProfiles() {
    if (!PHRASES_ARC_CURVES) {
      throw new Error('phraseArcProfiler.generateArcProfiles: PHRASES_ARC_CURVES global is not defined — ensure conductorConfig is loaded first');
    }
    /** @type {{ [key: string]: { register: Function, density: Function, independence: Function, dynamism: Function } }} */
    const adapted = {};
    for (const [key, curve] of Object.entries(PHRASES_ARC_CURVES)) {
      adapted[key] = {
        register: (pos) => (curve.register ? curve.register(pos) : 0),
        density: (pos) => (curve.density ? curve.density(pos) : 1),
        independence: (pos) => (curve.independence ? curve.independence(pos) : 0.5),
        dynamism: (pos) => (curve.dynamism ? curve.dynamism(pos) : 1.0)
      };
    }
    return adapted;
  }

  return { getBreathProfile, getPhase, generateArcProfiles };
})();
