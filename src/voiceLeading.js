// voiceLeading.js - Voice leading optimization with cost function scoring
// minimalist comments, details at: voiceLeading.md

/**
 * Voice leading cost function optimizer.
 * Implements soft constraints for smooth voice motion, voice range limits,
 * and leap recovery rules using weighted penalty scoring.
 * @class
 */
class VoiceLeadingScore {
  constructor(config = {}) {
    // Tuning weights for different voice leading rules
    this.weights = {
      smoothMotion: config.smoothMotionWeight ?? 1.0,     // Preference for stepwise motion
      voiceRange: config.voiceRangeWeight ?? 0.8,         // Penalty for extreme register
      leapRecovery: config.leapRecoveryWeight ?? 0.6,     // Constraint: leaps should reverse direction
      voiceCrossing: config.voiceCrossingWeight ?? 0.4,   // Soft constraint: prefer no crossing
      parallelMotion: config.parallelMotionWeight ?? 0.3, // Soft constraint: avoid parallel motion
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
    this.maxHistoryDepth = 4;
  }

  /**
   * Scores all available notes and returns the best candidate.
   * @param {number[]} lastNotes - Previous notes [soprano, alto, tenor, bass]
   * @param {number[]} availableNotes - Pool of candidate notes to evaluate
   * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
   * @returns {number} Best scoring note
   */
  selectNextNote(lastNotes, availableNotes, config = {}) {
    if (!availableNotes || availableNotes.length === 0) {
      return lastNotes[0] ?? 60; // Fallback to C4
    }

    const register = config.register || 'soprano';
    const constraints = config.constraints || [];
    const registerRange = this.registers[register] || this.registers.soprano;

    // Score each candidate
    const scores = availableNotes.map((note) => ({
      note,
      score: this._scoreCandidate(note, lastNotes, registerRange, constraints),
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
  _scoreCandidate(candidate, lastNotes, registerRange, constraints) {
    let totalCost = 0;

    // Voice motion smoothness (stepwise vs leap)
    const lastNote = lastNotes[0] ?? 60;
    const interval = Math.abs(candidate - lastNote);
    totalCost += this._scoreVoiceMotion(interval, lastNote, candidate) * this.weights.smoothMotion;

    // Register boundaries (prefer middle, penalize extremes)
    totalCost += this._scoreVoiceRange(candidate, registerRange) * this.weights.voiceRange;

    // Leap recovery: if previous motion was a leap, prefer stepwise recovery
    if (lastNotes.length >= 2) {
      const prevInterval = Math.abs(lastNotes[0] - lastNotes[1]);
      totalCost += this._scoreLeapRecovery(interval, prevInterval, lastNotes) * this.weights.leapRecovery;
    }

    // Voice crossing detection (soft constraint for multi-voice context)
    if (lastNotes.length > 1) {
      totalCost += this._scoreVoiceCrossing(candidate, lastNotes) * this.weights.voiceCrossing;
    }

    // Parallel motion avoidance (soft constraint)
    if (this.history.length > 0) {
      const lastMotion = this.history[this.history.length - 1];
      totalCost += this._scoreParallelMotion(candidate - lastNote, lastMotion) * this.weights.parallelMotion;
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
  _scoreLeapRecovery(currentInterval, prevInterval, lastNotes) {
    // Only apply if previous motion was a leap (>2 semitones)
    if (prevInterval <= 2) return 0;

    // Current motion should be stepwise (1-2 semitones)
    if (currentInterval > 2) {
      return 5; // Penalize: large leap not followed by step
    }

    // Check if direction reversal is present (preferred recovery)
    if (lastNotes.length >= 3) {
      const upPrev = lastNotes[0] > lastNotes[1];
      const upCurrent = lastNotes[1] > lastNotes[2];
      if (upPrev === upCurrent) {
        return 2; // Mild penalty: same direction instead of reversing
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
   * Resets historical state (useful for starting new sections).
   */
  reset() {
    this.history = [];
  }
}

// Export globally for composition integration
globalThis.VoiceLeadingScore = VoiceLeadingScore;
