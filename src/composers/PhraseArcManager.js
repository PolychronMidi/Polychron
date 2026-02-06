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
    this.arcType = opts.arcType || 'arch';
    this.registerRange = opts.registerRange || 12;
    this.densityRange = (opts.densityRange && typeof opts.densityRange === 'object' && 'min' in opts.densityRange)
      ? opts.densityRange
      : { min: 0.85, max: 1.3 };

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
      console.warn('PhraseArcManager.getPhraseContext: globals not set (measureIndex, measuresPerPhrase, phraseIndex)');
    }

    const pos = measuresPerPhrase > 0 ? measureIndex / measuresPerPhrase : 0;
    const phase = this._getPhase(pos);
    const profile = this._arcProfiles[this.arcType];

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

  _getPhase(pos) {
    if (pos < 0.25) return 'opening';
    if (pos < 0.5) return 'development';
    if (pos < 0.75) return 'climax';
    return 'resolution';
  }

  /**
   * Generate arc profile functions for different arc types
   */
  _generateArcProfiles() {
    return {
      // Classic arch: rise to peak at 0.6, then fall
      arch: {
        register: (pos) => {
          // Parabolic arc peaking at 0.6
          const centered = (pos - 0.6) * 2;
          const height = 1 - centered * centered;
          return Math.max(0, height) * this.registerRange - this.registerRange / 2;
        },
        density: (pos) => {
          // Denser toward middle
          const centered = Math.abs(pos - 0.5) * 2;
          return this.densityRange.min + (1 - centered) * (this.densityRange.max - this.densityRange.min);
        },
        independence: (pos) => {
          // More independent voices in development
          return pos > 0.25 && pos < 0.75 ? 0.7 : 0.3;
        },
        dynamism: (pos) => {
          // Higher activity toward climax
          return 0.5 + Math.sin(pos * Math.PI) * 0.5;
        }
      },

      // Rise-fall: linear ascent, then descent
      'rise-fall': {
        register: (pos) => {
          const rise = pos < 0.5 ? pos * 2 : 2 - pos * 2;
          return rise * this.registerRange - this.registerRange / 2;
        },
        density: (pos) => {
          return this.densityRange.min + (1 - Math.abs(pos - 0.5) * 2) * (this.densityRange.max - this.densityRange.min);
        },
        independence: (pos) => {
          return pos > 0.3 && pos < 0.7 ? 0.6 : 0.4;
        },
        dynamism: (pos) => {
          return 0.4 + (1 - Math.abs(pos - 0.5) * 2) * 0.6;
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
          return pos > 0.4 && pos < 0.75 ? 0.8 : 0.3;
        },
        dynamism: (pos) => {
          return pos < 0.75 ? 0.3 + pos * 0.7 : 0.2;
        }
      },

      // Wave: continuous rise and fall
      'wave': {
        register: (pos) => {
          return Math.sin(pos * Math.PI * 2) * this.registerRange / 2;
        },
        density: (pos) => {
          const wave = (Math.sin(pos * Math.PI * 2) + 1) / 2;
          return this.densityRange.min + wave * (this.densityRange.max - this.densityRange.min);
        },
        independence: (pos) => {
          return 0.4 + Math.abs(Math.sin(pos * Math.PI * 2)) * 0.4;
        },
        dynamism: (pos) => {
          return 0.5 + Math.abs(Math.sin(pos * Math.PI * 2)) * 0.5;
        }
      }
    };
  }
}
