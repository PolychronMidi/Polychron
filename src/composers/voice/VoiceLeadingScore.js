// VoiceLeadingScore.js - Voice leading optimization with cost function scoring

/**
 * @typedef {Object} VoiceLeadingScoreOpts
 * @property {string} [register] - Register name
 * @property {number} [commonToneWeight] - Weight for common tones
 * @property {any} [weight] - Weight configuration
 * @property {boolean} [useCorpusVoiceLeadingPriors] - Whether to apply corpus priors
 * @property {number} [corpusVoiceLeadingStrength] - Strength of corpus priors
 * @property {string} [phase] - Phrase phase
 * @property {Object} [phraseContext] - Phrase context object
 * @property {string} [quality] - Harmonic quality
 * @property {string} [tonic] - Tonic key
 */

/**
 * @typedef {Object} VoiceLeadingScoreConfig
 * @property {string} [register] - Register name
 * @property {string[]} [constraints] - Applied constraints
 * @property {Object} [candidateWeights] - Weight bonuses for specific notes
 * @property {number} [commonToneWeight] - Weight for common tones
 * @property {boolean} [useCorpusVoiceLeadingPriors] - Whether to apply corpus priors
 * @property {number} [corpusVoiceLeadingStrength] - Strength of corpus priors
 * @property {boolean} [useCorpusMelodicPriors] - Whether to apply melodic priors
 * @property {number} [corpusMelodicStrength] - Strength of melodic priors
 * @property {string} [phase] - Phrase phase
 * @property {Object} [phraseContext] - Phrase context object
 * @property {string} [quality] - Harmonic quality
 * @property {string} [tonic] - Tonic key
 */

/**
 * Voice leading cost function optimizer.
 * Implements soft constraints for smooth voice motion, voice range limits,
 * and leap recovery rules using weighted penalty scoring.
 * @class
 */
VoiceLeadingScore = class VoiceLeadingScore {
  constructor(config = {}) {
    const V = validator.create('VoiceLeadingScore');
    // Tuning weights for different voice leading rules
    this.weights = {
      smoothMotion: config.smoothMotionWeight ?? 1.0,     // Preference for stepwise motion
      voiceRange: config.voiceRangeWeight ?? 0.8,         // Penalty for extreme register
      leapRecovery: config.leapRecoveryWeight ?? 0.6,     // Constraint: leaps should reverse direction
      voiceCrossing: config.voiceCrossingWeight ?? 0.4,   // Soft constraint: prefer no crossing
      parallelMotion: config.parallelMotionWeight ?? 0.3, // Soft constraint: avoid parallel motion
      intervalQuality: config.intervalQualityWeight ?? 0.5, // Melodic interval consonance preference
      consecutiveLeaps: config.consecutiveLeapsWeight ?? 0.7, // Prevent too many consecutive leaps
      directionalBias: config.directionalBiasWeight ?? 0.2, // Register-based directional preference
      maxLeap: config.maxLeapWeight ?? 0.9, // Penalize very large leaps
    };

    // Dynamism: 0-1 scale controlling rule-breaking frequency (higher = more variation)
    this.dynamism = V.optionalFinite(config.dynamism, 0.3);

    // Max leap sizes per register (semitones) - soft boundaries
    this.maxLeapSize = {
      soprano: 12,  // Octave
      alto: 12,
      tenor: 14,    // Slightly larger for male voices
      bass: 16,     // Bass can leap further for harmonic foundation
    };

    // Register bounds [min, max] in MIDI note numbers
    this.registers = {
      soprano: [60, 84],   // C4 to C6
      alto: [48, 72],      // C3 to C5
      tenor: [36, 60],     // C2 to C4
      bass: [24, 48],      // C1 to C3
    };

    // Historical tracking for context-aware scoring
    this.history = [];
    this.maxHistoryDepth = 8; // Increased for consecutive leap tracking

    // Tunable defaults (can be set via constructor config or updateConfig)
    this.commonToneWeight = V.optionalFinite(config.commonToneWeight, 0);
    this.contraryMotionPreference = V.optionalFinite(config.contraryMotionPreference, 0.4);
  }

  /**
   * Scores all available notes and returns the best candidate.
   * @param {number[]} lastNotes - Previous notes [soprano, alto, tenor, bass]
   * @param {number[]} availableNotes - Pool of candidate notes to evaluate
   * @param {VoiceLeadingScoreConfig} [config] - Voice context
   * @returns {number} Best scoring note
   */
  selectNextNote(lastNotes, availableNotes, config = {}) {
    return voiceLeadingSelectNextNote(this, lastNotes, availableNotes, config);
  }

  /**
   * Computes total cost for a candidate note.
   * @private
   * @param {number} candidate - MIDI note to evaluate
   * @param {number[]} lastNotes - Previous notes per voice
   * @param {number[]} registerRange - Valid register [min, max]
   * @param {string[]} constraints - Applied constraints
   * @param {VoiceLeadingScoreOpts} opts - Additional options
   * @returns {number} Total weighted cost (lower is better)
   */
  // @ts-ignore: referenced dynamically via vls._scoreCandidate in other modules
  _scoreCandidate(candidate, lastNotes, registerRange, constraints, opts = {}) {
    return voiceLeadingCore.computeCandidateScore(this, candidate, lastNotes, registerRange, constraints, opts);
  }

  /**
   * Scores voice motion smoothness: small intervals cost less than large leaps.
   * @private
   * @param {number} interval - Semitone distance
   * @param {number} fromNote - Previous note
   * @param {number} toNote - Candidate note
   * @returns {number} Motion cost (0-10)
   */
  // @ts-ignore: referenced dynamically via vls._scoreVoiceMotion in other modules
  _scoreVoiceMotion(interval, fromNote, toNote) {
    return voiceLeadingScorers.scoreVoiceMotion(interval, fromNote, toNote);
  }

  /**
   * Scores register appropriateness: penalizes extreme high/low values.
   * @private
   * @param {number} note - MIDI note to evaluate
   * @param {number[]} range - [min, max] register bounds
   * @returns {number} Range cost (0-8)
   */
  // @ts-ignore: referenced dynamically via vls._scoreVoiceRange in other modules
  _scoreVoiceRange(note, range) {
    return voiceLeadingScorers.scoreVoiceRange(note, range);
  }

  /**
   * Scores leap recovery: leaps should be followed by stepwise motion in opposite direction.
   * @private
   * @param {number} currentInterval - Current semitone distance
   * @param {number} prevInterval - Previous semitone distance
   * @param {number[]} lastNotes - [n-1, n-2, ...] to check direction
   * @returns {number} Recovery cost (0-5)
   */
  // @ts-ignore: referenced dynamically via vls._scoreLeapRecovery in other modules
  _scoreLeapRecovery(currentInterval, prevInterval, lastNotes, candidate) {
    return voiceLeadingScorers.scoreLeapRecovery(this, currentInterval, prevInterval, lastNotes, candidate);
  }

  /**
   * Detects voice crossing in multi-voice context.
   * @private
   * @param {number} candidate - Soprano candidate
   * @param {number[]} lastNotes - Last notes [soprano, alto, tenor, bass]
   * @returns {number} Crossing cost (0-6)
   */
  // @ts-ignore: referenced dynamically via vls._scoreVoiceCrossing in other modules
  _scoreVoiceCrossing(candidate, lastNotes) {
    return voiceLeadingScorers.scoreVoiceCrossing(candidate, lastNotes);
  }

  /**
   * Detects parallel motion in same direction across consecutive intervals.
   * @private
   * @param {number} currentMotion - Current interval direction and size
   * @param {number} lastMotion - Previous interval from history
   * @returns {number} Parallel motion cost (0-3)
   */
  // @ts-ignore: referenced dynamically via vls._scoreParallelMotion in other modules
  _scoreParallelMotion(currentMotion, lastMotion) {
    return voiceLeadingScorers.scoreParallelMotion(currentMotion, lastMotion);
  }

  /**
   * Scores melodic interval quality - favors consonant leaps with occasional dissonance.
   * @private
   * @param {number} interval - Semitone distance
   * @param {number} fromNote - Previous note
   * @param {number} toNote - Candidate note
   * @returns {number} Interval quality cost (0-6)
   */
  // @ts-ignore: referenced dynamically via vls._scoreIntervalQuality in other modules
  _scoreIntervalQuality(interval, fromNote, toNote) {
    return voiceLeadingScorers.scoreIntervalQuality(interval, fromNote, toNote, this.dynamism);
  }

  /**
   * Prevents too many consecutive leaps - allows occasional runs.
   * @private
   * @param {number} currentInterval - Current semitone distance
   * @param {number[]} lastNotes - Previous notes for history check
   * @returns {number} Consecutive leap cost (0-8)
   */
  // @ts-ignore: referenced dynamically via vls._scoreConsecutiveLeaps in other modules
  _scoreConsecutiveLeaps(currentInterval, lastNotes) {
    return voiceLeadingScorers.scoreConsecutiveLeaps(currentInterval, lastNotes, this.dynamism);
  }

  /**
   * Applies register-specific directional preference.
   * @private
   * @param {number} candidate - Candidate note
   * @param {number} lastNote - Previous note
   * @param {string} register - Voice register
   * @returns {number} Directional bias cost (0-2)
   */
  // @ts-ignore: referenced dynamically via vls._scoreDirectionalBias in other modules
  _scoreDirectionalBias(candidate, lastNote, register) {
    return voiceLeadingScorers.scoreDirectionalBias(candidate, lastNote, register);
  }

  /**
   * Penalizes excessively large leaps beyond register-appropriate limits.
   * @private
   * @param {number} interval - Semitone distance
   * @param {string} register - Voice register
   * @returns {number} Max leap cost (0-10)
   */
  // @ts-ignore: referenced dynamically via vls._scoreMaxLeap in other modules
  _scoreMaxLeap(interval, register) {
    return voiceLeadingScorers.scoreMaxLeap(interval, register, this.maxLeapSize, this.dynamism);
  }

  /**
   * Updates historical tracking of voice motions for context.
   * @private
   * @param {number} note - Current note selected
   * @param {string} register - Voice register
   */
  // @ts-ignore: referenced dynamically via vls._updateHistory in other modules
  _updateHistory(note, register) {
    const lastNote = this.history.length > 0
      ? this.history[this.history.length - 1].note
      : note;

    this.history.push({
      note,
      register,
      interval: note - lastNote,
    });

    // Trim history to max depth
    if (this.history.length > this.maxHistoryDepth) {
      this.history.shift();
    }
  }

  /**
   * Analyzes voice leading quality of a sequence.
   * Useful for post-hoc validation or constraint scoring.
   * @param {number[]} noteSequence - Sequence of notes to analyze
   * @returns {{ smoothness: number, avgRange: number, leapRecoveries: number }}
   */
  analyzeQuality(noteSequence) {
    return voiceLeadingAnalyzeQuality(this, noteSequence);
  }

  /**
   * Update scorer configuration at runtime. Accepts any subset of:
   * - weights: { smoothMotion, voiceRange, leapRecovery, voiceCrossing, parallelMotion }
   * - commonToneWeight
   * - contraryMotionPreference
   * - registers
   */
  updateConfig(cfg = {}) {
    const V = validator.create('VoiceLeadingScore');
    V.assertPlainObject(cfg, 'updateConfig.cfg');
    const cfgAny = /** @type {any} */ (cfg);
    if (cfgAny.weights) {
      V.assertPlainObject(cfgAny.weights, 'updateConfig.weights');
      Object.assign(this.weights, cfgAny.weights);
    }
    if (typeof cfgAny.commonToneWeight === 'number') this.commonToneWeight = clamp(cfgAny.commonToneWeight, 0, 1);
    if (typeof cfgAny.contraryMotionPreference === 'number') this.contraryMotionPreference = clamp(cfgAny.contraryMotionPreference, 0, 1);
    if (typeof cfgAny.dynamism === 'number') this.dynamism = clamp(cfgAny.dynamism, 0, 1);
    if (cfgAny.registers) {
      V.assertPlainObject(cfgAny.registers, 'updateConfig.registers');
      this.registers = Object.assign({}, this.registers, cfgAny.registers);
    }
    if (cfgAny.maxLeapSize) {
      V.assertPlainObject(cfgAny.maxLeapSize, 'updateConfig.maxLeapSize');
      this.maxLeapSize = Object.assign({}, this.maxLeapSize, cfgAny.maxLeapSize);
    }
  }

  /**
   * Resets historical state (useful for starting new sections).
   */
  reset() {
    this.history = [];
  }
}

// Ensure private-class helper methods are treated as "used" by TypeScript when
// callers access them dynamically (e.g. voiceLeadingCore or external scoring helpers).
