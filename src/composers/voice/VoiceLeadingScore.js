// VoiceLeadingScore.js - Voice leading optimization with cost function scoring

/**
 * Voice leading cost function optimizer.
 * Implements soft constraints for smooth voice motion, voice range limits,
 * and leap recovery rules using weighted penalty scoring.
 * @class
 */
VoiceLeadingScore = class VoiceLeadingScore {
  constructor(config = {}) {
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
    this.dynamism = typeof config.dynamism === 'number' ? clamp(config.dynamism, 0, 1) : 0.3;

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
    this.commonToneWeight = typeof config.commonToneWeight === 'number' ? clamp(config.commonToneWeight, 0, 1) : 0;
    this.contraryMotionPreference = typeof config.contraryMotionPreference === 'number' ? clamp(config.contraryMotionPreference, 0, 1) : 0.4;
  }

  /**
   * Scores all available notes and returns the best candidate.
   * @param {number[]} lastNotes - Previous notes [soprano, alto, tenor, bass]
   * @param {number[]} availableNotes - Pool of candidate notes to evaluate
   * @param {{ register?: string, constraints?: string[], candidateWeights?: Object, commonToneWeight?: number }} [config] - Voice context
   * @returns {number} Best scoring note
   */
  selectNextNote(lastNotes, availableNotes, config = {}) {
    if (!availableNotes || availableNotes.length === 0) {
      throw new Error(`VoiceLeadingScore.selectNextNote: availableNotes is empty - check scale or candidate filtering`);
    }

    const register = config.register || 'soprano';
    const constraints = config.constraints || [];
    const registerRange = this.registers[register] || this.registers.soprano;

    // Score each candidate
    const scores = availableNotes.map((note) => ({
      note,
      score: this._scoreCandidate(note, lastNotes, registerRange, constraints, {
        commonToneWeight: config.commonToneWeight,
        weight: config.candidateWeights ? Number(config.candidateWeights[note]) || 0 : 0
      }),
    }));

    // Sort by score (lower is better) and return best
    scores.sort((a, b) => a.score - b.score);
    const bestNote = scores[0].note;

    // Track history for context
    this._updateHistory(bestNote, register);

    return bestNote;
  }

  /**
   * Computes total cost for a candidate note.
   * @private
   * @param {number} candidate - MIDI note to evaluate
   * @param {number[]} lastNotes - Previous notes per voice
   * @param {number[]} registerRange - Valid register [min, max]
   * @param {string[]} constraints - Applied constraints
   * @returns {number} Total weighted cost (lower is better)
   */
  _scoreCandidate(candidate, lastNotes, registerRange, constraints, opts = {}) {
    let totalCost = 0;

    // Voice motion smoothness (stepwise vs leap)
    if (!lastNotes || lastNotes.length === 0) {
      throw new Error('VoiceLeadingScore._scoreCandidate: lastNotes is empty - voice history corrupted or not initialized');
    }
    const lastNote = lastNotes[0];
    const interval = Math.abs(candidate - lastNote);
    const currentRegister = opts.register || 'soprano';

    // Build context for noise helper
    const currentTime = (typeof beatStart !== 'undefined' ? beatStart : 0);
    const voiceId = candidate + (lastNote * 17);
    const noiseContext = { currentTime, voiceId };

    // Apply noise-modulated weight multipliers via helper
    const smoothMotionMod = applyVoiceLeadingWeightNoise(1.0, 'smoothMotion', noiseContext);
    totalCost += this._scoreVoiceMotion(interval, lastNote, candidate) * this.weights.smoothMotion * smoothMotionMod;

    const intervalQualityMod = applyVoiceLeadingWeightNoise(1.0, 'intervalQuality', noiseContext);
    totalCost += this._scoreIntervalQuality(interval, lastNote, candidate) * this.weights.intervalQuality * intervalQualityMod;

    // Consecutive leap prevention (with dynamism allowing occasional runs)
    totalCost += this._scoreConsecutiveLeaps(interval, lastNotes) * this.weights.consecutiveLeaps;

    // Directional bias per register
    totalCost += this._scoreDirectionalBias(candidate, lastNote, currentRegister) * this.weights.directionalBias;

    // Max leap constraint (soft penalty)
    totalCost += this._scoreMaxLeap(interval, currentRegister) * this.weights.maxLeap;

    // Register boundaries (prefer middle, penalize extremes)
    totalCost += this._scoreVoiceRange(candidate, registerRange) * this.weights.voiceRange;

    // Leap recovery: if previous motion was a leap, prefer stepwise recovery (scaled by leap size)
    if (lastNotes.length >= 2) {
      const prevInterval = Math.abs(lastNotes[0] - lastNotes[1]);
      totalCost += this._scoreLeapRecovery(interval, prevInterval, lastNotes, candidate) * this.weights.leapRecovery;
    }

    // Voice crossing detection (soft constraint for multi-voice context)
    if (lastNotes.length > 1) {
      totalCost += this._scoreVoiceCrossing(candidate, lastNotes) * this.weights.voiceCrossing;
    }

    // Parallel motion avoidance (soft constraint)
    if (this.history.length > 0) {
      const lastHistory = this.history[this.history.length - 1];
      const lastMotion = (lastHistory && typeof lastHistory.interval === 'number') ? lastHistory.interval : 0;
      totalCost += this._scoreParallelMotion(candidate - lastNote, lastMotion) * this.weights.parallelMotion;
    }

    // Small preference for common-tone (same pitch-class); prefers per-call opts first, then scorer default
    const baseCtWeight = (opts && typeof opts.commonToneWeight === 'number') ? opts.commonToneWeight : this.commonToneWeight;
    const ctWeightMod = applyVoiceLeadingWeightNoise(1.0, 'commonTone', noiseContext);
    const ctWeight = baseCtWeight * ctWeightMod;
    if (typeof ctWeight === 'number' && ctWeight > 0) {
      const samePC = ((candidate % 12) + 12) % 12 === ((lastNote % 12) + 12) % 12;
      if (samePC) totalCost -= Math.min(8, ctWeight * 4); // reduce cost to favor common tones
    }

    // Candidate weight bias (lower cost is preferred)
    if (opts && typeof opts.weight === 'number' && opts.weight > 0) {
      totalCost -= Math.min(8, opts.weight * 4);
    }

    // Apply hard constraints if provided
    if (constraints.includes('avoidsStrident') && interval > 7) {
      totalCost += 5; // Penalize large leaps
    }
    if (constraints.includes('stepsOnly') && interval > 2) {
      totalCost += 10; // Force stepwise motion
    }

    return totalCost;
  }

  /**
   * Scores voice motion smoothness: small intervals cost less than large leaps.
   * @private
   * @param {number} interval - Semitone distance
   * @param {number} fromNote - Previous note
   * @param {number} toNote - Candidate note
   * @returns {number} Motion cost (0-10)
   */
  _scoreVoiceMotion(interval, fromNote, toNote) {
    // Stepwise motion (1-2 semitones) is preferred
    if (interval === 0) return 0;    // Unison
    if (interval <= 2) return 1;     // Step
    if (interval <= 5) return 3;     // Small leap
    if (interval <= 7) return 5;     // Tritone or sixth
    return 10;                       // Large leap
  }

  /**
   * Scores register appropriateness: penalizes extreme high/low values.
   * @private
   * @param {number} note - MIDI note to evaluate
   * @param {number[]} range - [min, max] register bounds
   * @returns {number} Range cost (0-8)
   */
  _scoreVoiceRange(note, range) {
    const [min, max] = range;
    const mid = (min + max) / 2;
    const width = max - min;

    // Ideal zone: middle half of range
    if (note >= min + width / 4 && note <= max - width / 4) {
      return 0;
    }

    // Acceptable zone: within range
    if (note >= min && note <= max) {
      return 2;
    }

    // Outside range: linear penalty based on distance
    const distance = note < min ? min - note : note - max;
    return Math.min(8, 2 + distance * 0.5);
  }

  /**
   * Scores leap recovery: leaps should be followed by stepwise motion in opposite direction.
   * @private
   * @param {number} currentInterval - Current semitone distance
   * @param {number} prevInterval - Previous semitone distance
   * @param {number[]} lastNotes - [n-1, n-2, ...] to check direction
   * @returns {number} Recovery cost (0-5)
   */
  _scoreLeapRecovery(currentInterval, prevInterval, lastNotes, candidate) {
    // Only apply if previous motion was a leap (>2 semitones)
    if (prevInterval <= 2) return 0;

    // Scale recovery pressure by leap size (larger leaps demand stronger recovery)
    const leapScale = Math.min(2.5, prevInterval / 5.0);

    // Dynamism allows occasional leap chains
    const dynamismReduction = this.dynamism * 0.4;

    // Current motion should be stepwise (1-2 semitones)
    if (currentInterval > 2) {
      return Math.max(0, (5 * leapScale) - dynamismReduction); // Penalize: large leap not followed by step
    }

    // Check if direction reversal is present (preferred recovery)
    if (lastNotes.length >= 2) {
      const prevDirection = lastNotes[0] - lastNotes[1];
      const currentDirection = candidate - lastNotes[0];
      const sameDirection = (prevDirection > 0 && currentDirection > 0) || (prevDirection < 0 && currentDirection < 0);

      if (sameDirection) {
        // Penalty scaled by contraryMotionPreference and leap size
        const basePenalty = 2 * (this.contraryMotionPreference ?? 0.4) * leapScale;
        return Math.max(0, basePenalty - dynamismReduction);
      }
    }

    return 0; // Good: leap followed by step in opposite direction
  }

  /**
   * Detects voice crossing in multi-voice context.
   * @private
   * @param {number} candidate - Soprano candidate
   * @param {number[]} lastNotes - Last notes [soprano, alto, tenor, bass]
   * @returns {number} Crossing cost (0-6)
   */
  _scoreVoiceCrossing(candidate, lastNotes) {
    if (lastNotes.length < 2) return 0;

    const alto = lastNotes[1] ?? 60;
    // Soprano should stay above or at alto line
    if (candidate < alto) {
      return 6;
    }

    if (lastNotes.length >= 4) {
      const tenor = lastNotes[2];
      const bass = lastNotes[3];
      // Check full voice crossing
      if ((candidate < alto && alto < tenor) || (tenor < alto && alto < candidate)) {
        return 4;
      }
    }

    return 0;
  }

  /**
   * Detects parallel motion in same direction across consecutive intervals.
   * @private
   * @param {number} currentMotion - Current interval direction and size
   * @param {number} lastMotion - Previous interval from history
   * @returns {number} Parallel motion cost (0-3)
   */
  _scoreParallelMotion(currentMotion, lastMotion) {
    // Same direction motion
    if ((currentMotion > 0 && lastMotion > 0) || (currentMotion < 0 && lastMotion < 0)) {
      // Parallel motion is mildly discouraged in voice leading
      return 3;
    }
    return 0;
  }

  /**
   * Scores melodic interval quality - favors consonant leaps with occasional dissonance.
   * @private
   * @param {number} interval - Semitone distance
   * @param {number} fromNote - Previous note
   * @param {number} toNote - Candidate note
   * @returns {number} Interval quality cost (0-6)
   */
  _scoreIntervalQuality(interval, fromNote, toNote) {
    if (interval <= 2) return 0; // Steps are always good

    // Classify interval class (normalize to within octave)
    const intervalClass = interval % 12;

    // Dynamism allows occasional harsh intervals
    const dynamismBonus = this.dynamism * 2;

    // Consonant leaps (preferred) - minor penalty
    if ([3, 4, 5, 7, 9].includes(intervalClass)) {
      // m3, M3, P4, P5, M6
      return Math.max(0, 1 - dynamismBonus * 0.5);
    }

    // Mildly dissonant but usable
    if ([2, 10].includes(intervalClass)) {
      // M2, m7
      return Math.max(0, 3 - dynamismBonus);
    }

    // Harsh intervals (occasional color tones)
    if ([1, 6, 11].includes(intervalClass)) {
      // m2, tritone, M7
      return Math.max(0, 5 - dynamismBonus * 1.5);
    }

    // Very large intervals
    return Math.max(0, 4 - dynamismBonus);
  }

  /**
   * Prevents too many consecutive leaps - allows occasional runs.
   * @private
   * @param {number} currentInterval - Current semitone distance
   * @param {number[]} lastNotes - Previous notes for history check
   * @returns {number} Consecutive leap cost (0-8)
   */
  _scoreConsecutiveLeaps(currentInterval, lastNotes) {
    if (currentInterval <= 2) return 0; // Not a leap

    let consecutiveLeaps = 1; // Current one counts

    // Count consecutive leaps in history
    for (let i = 0; i < Math.min(lastNotes.length - 1, 3); i++) {
      const histInterval = Math.abs(lastNotes[i] - lastNotes[i + 1]);
      if (histInterval > 2) {
        consecutiveLeaps++;
      } else {
        break; // Step breaks the sequence
      }
    }

    // Dynamism allows occasional leap sequences
    const dynamismReduction = this.dynamism * 3;

    if (consecutiveLeaps === 2) {
      return Math.max(0, 3 - dynamismReduction * 0.6); // Mild penalty
    } else if (consecutiveLeaps === 3) {
      return Math.max(0, 6 - dynamismReduction); // Strong penalty
    } else if (consecutiveLeaps >= 4) {
      return Math.max(0, 8 - dynamismReduction); // Very strong penalty
    }

    return 0;
  }

  /**
   * Applies register-specific directional preference.
   * @private
   * @param {number} candidate - Candidate note
   * @param {number} lastNote - Previous note
   * @param {string} register - Voice register
   * @returns {number} Directional bias cost (0-2)
   */
  _scoreDirectionalBias(candidate, lastNote, register) {
    const direction = candidate - lastNote;
    if (direction === 0) return 0; // No motion

    const ascending = direction > 0;

    // Apply subtle bias based on register
    switch (register) {
      case 'soprano':
        // Slight ascending bias (vocal brightness)
        return ascending ? 0 : 0.5;
      case 'bass':
        // Slight descending bias (harmonic foundation)
        return ascending ? 0.5 : 0;
      case 'alto':
      case 'tenor':
      default:
        // Neutral
        return 0;
    }
  }

  /**
   * Penalizes excessively large leaps beyond register-appropriate limits.
   * @private
   * @param {number} interval - Semitone distance
   * @param {string} register - Voice register
   * @returns {number} Max leap cost (0-10)
   */
  _scoreMaxLeap(interval, register) {
    const maxLeap = this.maxLeapSize[register] || 12;

    if (interval <= maxLeap) return 0;

    // Soft exponential penalty beyond max
    const excess = interval - maxLeap;
    const dynamismReduction = this.dynamism * 4;

    return Math.max(0, Math.min(10, excess * 1.5) - dynamismReduction);
  }

  /**
   * Updates historical tracking of voice motions for context.
   * @private
   * @param {number} note - Current note selected
   * @param {string} register - Voice register
   */
  _updateHistory(note, register) {
    const lastNote = this.history.length > 0
      ? this.history[this.history.length - 1].note
      : note;

    this.history.push({
      note,
      register,
      interval: note - lastNote,
      timestamp: Date.now(),
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
    if (noteSequence.length < 2) {
      return { smoothness: 0, avgRange: 0, leapRecoveries: 0 };
    }

    let totalCost = 0;
    let leapCount = 0;
    let recoveryCount = 0;

    for (let i = 1; i < noteSequence.length; i++) {
      const interval = Math.abs(noteSequence[i] - noteSequence[i - 1]);
      const motionCost = this._scoreVoiceMotion(interval, noteSequence[i - 1], noteSequence[i]);
      totalCost += motionCost;

      if (interval > 2) leapCount++;
      if (i >= 2 && interval <= 2 && Math.abs(noteSequence[i - 1] - noteSequence[i - 2]) > 2) {
        recoveryCount++;
      }
    }

    return {
      smoothness: totalCost / (noteSequence.length - 1),
      avgRange: noteSequence.reduce((a, b) => a + b, 0) / noteSequence.length,
      leapRecoveries: leapCount > 0 ? recoveryCount / leapCount : 1.0,
    };
  }

  /**
   * Update scorer configuration at runtime. Accepts any subset of:
   * - weights: { smoothMotion, voiceRange, leapRecovery, voiceCrossing, parallelMotion }
   * - commonToneWeight
   * - contraryMotionPreference
   * - registers
   */
  updateConfig(cfg = {}) {
    if (typeof cfg !== 'object' || cfg === null) { console.warn('VoiceLeadingScore.updateConfig: invalid config provided — expected object'); return; }
    const cfgAny = /** @type {any} */ (cfg);
    if (cfgAny.weights && typeof cfgAny.weights === 'object') {
      Object.assign(this.weights, cfgAny.weights);
    }
    if (typeof cfgAny.commonToneWeight === 'number') this.commonToneWeight = clamp(cfgAny.commonToneWeight, 0, 1);
    if (typeof cfgAny.contraryMotionPreference === 'number') this.contraryMotionPreference = clamp(cfgAny.contraryMotionPreference, 0, 1);
    if (typeof cfgAny.dynamism === 'number') this.dynamism = clamp(cfgAny.dynamism, 0, 1);
    if (cfgAny.registers && typeof cfgAny.registers === 'object') {
      this.registers = Object.assign({}, this.registers, cfgAny.registers);
    }
    if (cfgAny.maxLeapSize && typeof cfgAny.maxLeapSize === 'object') {
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
