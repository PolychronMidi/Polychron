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

const V = validator.create('PhraseArcManager');

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
    } else {
      V.requireType(opts.arcType, 'string', 'opts.arcType');
      if (!validArcTypes.includes(opts.arcType)) {
        throw new Error('PhraseArcManager: invalid arcType');
      }
      this.arcType = opts.arcType;
    }
    this._registerRangeOverride = (opts.registerRange !== undefined) ? V.requireFinite(Number(opts.registerRange), 'opts.registerRange') : null;
    if (opts.densityRange !== undefined) {
      if (!opts.densityRange) throw new Error('PhraseArcManager: densityRange must be an object with {min,max}');
      V.assertObject(opts.densityRange, 'opts.densityRange');
      if (!('min' in opts.densityRange && 'max' in opts.densityRange)) {
        throw new Error('PhraseArcManager: densityRange must be an object with {min,max}');
      }
      this._densityRangeOverride = opts.densityRange;
    } else {
      this._densityRangeOverride = null;
    }

    const breath = phraseArcProfiler.getBreathProfile();
    this.registerRange = this._registerRangeOverride !== null ? this._registerRangeOverride : breath.registerRange;
    this.densityRange = this._densityRangeOverride || breath.densityRange;

    // Arc profiles cache; per-beat context cache (keyed on beatCount)
    this._arcProfiles = phraseArcProfiler.generateArcProfiles();
    this._contextCache = beatCache.create(() => this._computePhraseContext());
  }

  /**
   * Get phrase context using current global state.
   * Result is cached per beat (keyed on beatCount) since globals don't change within a beat.
   * @returns {Object} { position, phase, registerBias, densityMultiplier, voiceIndependence, dynamism, atBoundary }
   */
  getPhraseContext() {
    return this._contextCache.get();
  }

  _computePhraseContext() {
    const breath = phraseArcProfiler.getBreathProfile();
    this.registerRange = this._registerRangeOverride !== null ? this._registerRangeOverride : breath.registerRange;
    this.densityRange = this._densityRangeOverride || breath.densityRange;

    const pos = timeStream.normalizedProgress('measure');
    const phase = phraseArcProfiler.getPhase(pos);

    let currentArcType = this.arcType;
    const sectionPhase = harmonicContext.getField('sectionPhase');
    currentArcType = conductorConfig.getArcMapping(sectionPhase);

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

}
