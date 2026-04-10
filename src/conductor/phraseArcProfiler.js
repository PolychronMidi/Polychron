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
   * Throws if the global is missing - arc curves must be centralized in config.
   * @returns {Object.<string, {register:Function, density:Function, independence:Function, dynamism:Function}>}
   */
  // R29 E1: regime-responsive independence modulation on top of profile values.
  // Exploring: +0.10 (more contrapuntal searching), coherent: -0.08 (more unified).
  // R47: Raised exploring 0.10->0.15. flicker-phase became dominant coupling pair
  // in R46 (legendary). Amplifies contrapuntal searching during the 52.7% exploring
  // phase -- more independent phrase arcs = richer xenolinguistic character.
  // R48: exploring 0.15->0.20 (wider arc contrast -- 31% exploring needs stronger
  // independence signal to maintain xenolinguistic quality at lower share).
  // coherent -0.08->-0.10 (tighter unified feel, within KB-recommended ceiling).
  const INDEPENDENCE_REGIME_MOD = { exploring: 0.20, evolving: 0.0, coherent: -0.10 };

  function generateArcProfiles() {
    if (!PHRASES_ARC_CURVES) {
      throw new Error('phraseArcProfiler.generateArcProfiles: PHRASES_ARC_CURVES global is not defined - ensure conductorConfig is loaded first');
    }
    const bp = getBreathProfile();
    const ind = bp.independence || {};
    const dyn = bp.dynamism || {};
    // R29 E1: wire dormant phraseBreath.independence config into arc curves.
    // Profile values provide per-arc-type base; regime modulation adapts dynamically.
    const indFns = {
      'arch': (pos) => (ind.archOuter || 0.3) + ((ind.archInner || 0.7) - (ind.archOuter || 0.3)) * m.sin(Number(pos) * m.PI),
      'wave': (pos) => (ind.waveBase || 0.4) + (ind.waveAmplitude || 0.4) * m.sin(Number(pos) * m.PI * 2),
      'rise-fall': (pos) => (ind.riseFallOuter || 0.4) + ((ind.riseFallInner || 0.6) - (ind.riseFallOuter || 0.4)) * Number(pos),
      'build-resolve': (pos) => (ind.buildResolveOuter || 0.3) + ((ind.buildResolveInner || 0.8) - (ind.buildResolveOuter || 0.3)) * Number(pos)
    };
    // R29 E1: wire dormant phraseBreath.dynamism config into arc curves.
    // R62: added 0.20*sin(pos*4pi) micro-oscillation to arch/rise-fall/build-resolve (2 cycles/phrase)
    // and doubled wave to sin(pos*4pi) for micro-term dense/atmospheric variation.
    // Values may briefly exceed [0,1] -- dynamismEngine clamps before use.
    const dynFns = {
      'arch': (pos) => (dyn.archBase || 0.5) + (dyn.archAmplitude || 0.40) * m.sin(Number(pos) * m.PI) + 0.20 * m.sin(Number(pos) * m.PI * 4),
      'wave': (pos) => (dyn.waveBase || 0.5) + (dyn.waveAmplitude || 0.5) * m.sin(Number(pos) * m.PI * 4),
      'rise-fall': (pos) => (dyn.riseFallBase || 0.4) + (dyn.riseFallAmplitude || 0.45) * Number(pos) + 0.20 * m.sin(Number(pos) * m.PI * 4),
      'build-resolve': (pos) => (dyn.buildResolveBase || 0.3) + (dyn.buildResolveSlope || 0.55) * m.min(Number(pos), (dyn.buildResolveEnd || 0.2) + 0.8) + 0.20 * m.sin(Number(pos) * m.PI * 4)
    };
    /** @type {{ [key: string]: { register: Function, density: Function, independence: Function, dynamism: Function, spectralDensity: Function } }} */
    const adapted = {};
    for (const [key, curve] of Object.entries(PHRASES_ARC_CURVES)) {
      const indFn = indFns[key];
      const dynFn = dynFns[key];
      adapted[key] = {
        register: (pos) => (curve.register ? curve.register(pos) : 0),
        density: (pos) => (curve.density ? curve.density(pos) : 1),
        independence: indFn
          ? (pos) => {
            const base = indFn(pos);
            const reg = regimeClassifier.getLastRegime();
            const mod = INDEPENDENCE_REGIME_MOD[reg] || 0;
            return clamp(base + mod, 0.05, 0.95);
          }
          : (pos) => (curve.independence ? curve.independence(pos) : 0.5),
        dynamism: dynFn || ((pos) => (curve.dynamism ? curve.dynamism(pos) : 1.0)),
        spectralDensity: (pos) => (curve.spectralDensity ? curve.spectralDensity(pos) : 0.5)
      };
    }
    return adapted;
  }

  return { getBreathProfile, getPhase, generateArcProfiles };
})();
