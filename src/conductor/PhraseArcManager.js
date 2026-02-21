/**
 * PhraseArcManager
 *
 * Stateless phrase arc profiler - reads from existing global state.
 * Uses measureIndex, measuresPerPhrase, phraseIndex from main.js loops.
 * Generates arc profiles for:
 * - Register trajectory (pitch height over time)
 * - Density profile (voice count variations)
 * - Voice independence (contrapuntal vs homophonic)
 * - Dynamism scaling (rhythmic activity)
 */

const V = Validator.create('PhraseArcManager');

PhraseArcManager = class PhraseArcManager {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.arcType] - 'rise-fall', 'build-resolve', 'wave', 'arch' (default: 'arch')
   * @param {number} [opts.registerRange] - Semitones of register variation (default: 12)
   * @param {Object} [opts.densityRange] - Voice count multiplier range (default: {min: 0.85, max: 1.3})
   */
  constructor(opts = {}) {
    V.assertPlainObject(opts, 'opts');
    const validArcTypes = ['arch', 'rise-fall', 'build-resolve', 'wave'];
    if (opts.arcType === undefined) {
      this.arcType = 'arch';
    } else if (typeof opts.arcType !== 'string' || !validArcTypes.includes(opts.arcType)) {
      throw new Error('PhraseArcManager: invalid arcType');
    } else {
      this.arcType = opts.arcType;
    }
    this._registerRangeOverride = Number.isFinite(Number(opts.registerRange)) ? Number(opts.registerRange) : null;
    if (opts.densityRange !== undefined) {
      if (!opts.densityRange || typeof opts.densityRange !== 'object' || !('min' in opts.densityRange && 'max' in opts.densityRange)) {
        throw new Error('PhraseArcManager: densityRange must be an object with {min,max}');
      }
      this._densityRangeOverride = opts.densityRange;
    } else {
      this._densityRangeOverride = null;
    }

    const breath = this._getBreathProfile();
    this.registerRange = this._registerRangeOverride !== null ? this._registerRangeOverride : breath.registerRange;
    this.densityRange = this._densityRangeOverride || breath.densityRange;

    // Arc profiles cache
    this._arcProfiles = this._generateArcProfiles();
  }

  /**
   * Get phrase context using current global state
   * @returns {Object} { position, phase, registerBias, densityMultiplier, voiceIndependence, dynamism, atBoundary }
   */
  getPhraseContext() {
    // Read directly from globals set in main.js loops
    if (measureIndex === undefined || measuresPerPhrase === undefined || phraseIndex === undefined) {
      throw new Error('PhraseArcManager.getPhraseContext: globals not set (measureIndex, measuresPerPhrase, phraseIndex)');
    }

    const breath = this._getBreathProfile();
    this.registerRange = this._registerRangeOverride !== null ? this._registerRangeOverride : breath.registerRange;
    this.densityRange = this._densityRangeOverride || breath.densityRange;

    const pos = TimeStream.normalizedProgress('measure');
    const phase = this._getPhase(pos);

    let currentArcType = this.arcType;
    if (HarmonicContext && HarmonicContext.getField) {
      const sectionPhase = HarmonicContext.getField('sectionPhase');
      currentArcType = ConductorConfig.getArcMapping(sectionPhase);
    }

    // Fallback to configured arcType if mapped one is missing (though defaults cover it)
    const profile = this._arcProfiles[currentArcType] || this._arcProfiles[this.arcType];

    return {
      position: pos,
      phase: phase,
      measureInPhrase: measureIndex,
      phraseNumber: phraseIndex,
      registerBias: profile.register(pos),
      densityMultiplier: profile.density(pos),
      voiceIndependence: profile.independence(pos),
      dynamism: profile.dynamism(pos),
      atBoundary: measureIndex === 0 || measureIndex === measuresPerPhrase - 1,
      atStart: measureIndex === 0,
      atEnd: measureIndex === measuresPerPhrase - 1
    };
  }

  /**
   * Get normalized phrase position in [0, 1).
   * @returns {number}
   */
  getPosition() {
    return this.getPhraseContext().position;
  }

  /**
   * Get current phrase phase label.
   * @returns {string}
   */
  getPhase() {
    return this.getPhraseContext().phase;
  }

  /**
   * Whether current measure is at phrase start or end.
   * @returns {boolean}
   */
  isAtBoundary() {
    return this.getPhraseContext().atBoundary;
  }

  /**
   * Whether current measure is phrase end.
   * @returns {boolean}
   */
  isAtEnd() {
    return this.getPhraseContext().atEnd;
  }

  /**
   * Whether current measure is phrase start.
   * @returns {boolean}
   */
  isAtStart() {
    return this.getPhraseContext().atStart;
  }

  /**
   * Reset hook for compatibility with FactoryManager lifecycle.
   * PhraseArcManager is stateless relative to measure globals.
   */
  reset() {
    return true;
  }

  _getBreathProfile() {
    const p = ConductorConfig.getPhraseBreathParams();
    if (p && typeof p === 'object') {
      return p;
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

  _getPhase(pos) {
    if (pos < 0.25) return 'opening';
    if (pos < 0.5) return 'development';
    if (pos < 0.75) return 'climax';
    return 'resolution';
  }

  /**
   * Generate arc profile functions from PHRASES_ARC_CURVES global (defined in ConductorConfig).
   * Fail-fast if the global is missing — arc curves must be centralized in config.
   */
  _generateArcProfiles() {
    if (!PHRASES_ARC_CURVES) {
      throw new Error('PhraseArcManager: PHRASES_ARC_CURVES global is not defined — ensure ConductorConfig is loaded first');
    }

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
}
