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

PhraseArcManager = class PhraseArcManager {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.arcType] - 'rise-fall', 'build-resolve', 'wave', 'arch' (default: 'arch')
   * @param {number} [opts.registerRange] - Semitones of register variation (default: 12)
   * @param {Object} [opts.densityRange] - Voice count multiplier range (default: {min: 0.85, max: 1.3})
   */
  constructor(opts = {}) {
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
    if (typeof measureIndex === 'undefined' || typeof measuresPerPhrase === 'undefined' || typeof phraseIndex === 'undefined') {
      throw new Error('PhraseArcManager.getPhraseContext: globals not set (measureIndex, measuresPerPhrase, phraseIndex)');
    }

    const breath = this._getBreathProfile();
    this.registerRange = this._registerRangeOverride !== null ? this._registerRangeOverride : breath.registerRange;
    this.densityRange = this._densityRangeOverride || breath.densityRange;

    const pos = measuresPerPhrase > 0 ? measureIndex / measuresPerPhrase : 0;
    const phase = this._getPhase(pos);

    let currentArcType = this.arcType;
    if (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField) {
      const sectionPhase = HarmonicContext.getField('sectionPhase');
      if (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getArcMapping === 'function') {
        currentArcType = ConductorConfig.getArcMapping(sectionPhase);
      }
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
    if (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getPhraseBreathParams === 'function') {
      const p = ConductorConfig.getPhraseBreathParams();
      if (p && typeof p === 'object') {
        return p;
      }
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
   * Generate arc profile functions for different arc types
   * Uses PHRASES_ARC_CURVES from config if available, otherwise falls back to internal defaults.
   */
  _generateArcProfiles() {
    // If centralized curves are defined, use them (adapted to local instance ranges where applicable)
    if (typeof PHRASES_ARC_CURVES !== 'undefined') {
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

    return {
      // Classic arch: rise to peak at 0.6, then fall
      arch: {
        register: (pos) => {
          // Parabolic arc peaking at 0.6
          const centered = (pos - 0.6) * 2;
          const height = 1 - centered * centered;
          return m.max(0, height) * this.registerRange - this.registerRange / 2;
        },
        density: (pos) => {
          // Denser toward middle
          const centered = m.abs(pos - 0.5) * 2;
          return this.densityRange.min + (1 - centered) * (this.densityRange.max - this.densityRange.min);
        },
        independence: (pos) => {
          // More independent voices in development
          const p = this._getBreathProfile().independence;
          return pos > 0.25 && pos < 0.75 ? p.archInner : p.archOuter;
        },
        dynamism: (pos) => {
          // Higher activity toward climax
          const p = this._getBreathProfile().dynamism;
          return p.archBase + m.sin(pos * m.PI) * p.archAmplitude;
        }
      },

      // Rise-fall: linear ascent, then descent
      'rise-fall': {
        register: (pos) => {
          const rise = pos < 0.5 ? pos * 2 : 2 - pos * 2;
          return rise * this.registerRange - this.registerRange / 2;
        },
        density: (pos) => {
          return this.densityRange.min + (1 - m.abs(pos - 0.5) * 2) * (this.densityRange.max - this.densityRange.min);
        },
        independence: (pos) => {
          const p = this._getBreathProfile().independence;
          return pos > 0.3 && pos < 0.7 ? p.riseFallInner : p.riseFallOuter;
        },
        dynamism: (pos) => {
          const p = this._getBreathProfile().dynamism;
          return p.riseFallBase + (1 - m.abs(pos - 0.5) * 2) * p.riseFallAmplitude;
        }
      },

      // Build-resolve: gradual build to peak, quick resolution
      'build-resolve': {
        register: (pos) => {
          const build = pos < 0.75 ? pos / 0.75 : (1 - pos) / 0.25;
          return build * this.registerRange - this.registerRange / 2;
        },
        density: (pos) => {
          const build = pos < 0.75 ? pos / 0.75 : 0.5;
          return this.densityRange.min + build * (this.densityRange.max - this.densityRange.min);
        },
        independence: (pos) => {
          const p = this._getBreathProfile().independence;
          return pos > 0.4 && pos < 0.75 ? p.buildResolveInner : p.buildResolveOuter;
        },
        dynamism: (pos) => {
          const p = this._getBreathProfile().dynamism;
          return pos < 0.75 ? p.buildResolveBase + pos * p.buildResolveSlope : p.buildResolveEnd;
        }
      },

      // Wave: continuous rise and fall
      'wave': {
        register: (pos) => {
          return m.sin(pos * m.PI * 2) * this.registerRange / 2;
        },
        density: (pos) => {
          const wave = (m.sin(pos * m.PI * 2) + 1) / 2;
          return this.densityRange.min + wave * (this.densityRange.max - this.densityRange.min);
        },
        independence: (pos) => {
          const p = this._getBreathProfile().independence;
          return p.waveBase + m.abs(m.sin(pos * m.PI * 2)) * p.waveAmplitude;
        },
        dynamism: (pos) => {
          const p = this._getBreathProfile().dynamism;
          return p.waveBase + m.abs(m.sin(pos * m.PI * 2)) * p.waveAmplitude;
        }
      }
    };
  }
}
