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

    // Tunable defaults (can be set via constructor config or updateConfig)
    this.commonToneWeight = typeof config.commonToneWeight === 'number' ? clamp(config.commonToneWeight, 0, 1) : 0;
    this.contraryMotionPreference = typeof config.contraryMotionPreference === 'number' ? clamp(config.contraryMotionPreference, 0, 1) : 0.4;
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
      score: this._scoreCandidate(note, lastNotes, registerRange, constraints, config),
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

    // Small preference for common-tone (same pitch-class); prefers per-call opts first, then scorer default
    const ctWeight = (opts && typeof opts.commonToneWeight === 'number') ? opts.commonToneWeight : this.commonToneWeight;
    if (typeof ctWeight === 'number' && ctWeight > 0) {
      const samePC = ((candidate % 12) + 12) % 12 === ((lastNote % 12) + 12) % 12;
      if (samePC) totalCost -= Math.min(8, ctWeight * 4); // reduce cost to favor common tones
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
        // Penalty scaled by contraryMotionPreference: higher preference means larger penalty for same-direction motion
        return 2 * (this.contraryMotionPreference ?? 0.4);
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
   * Joint voice selection helper.
   * Selects notes for multiple voices jointly using the existing single-voice
   * cost function and simple inter-voice penalties (crossing/parallel motion).
   * @param {number[][]} lastNotesByVoice - Array of per-voice history arrays (each voice -> [last, prev, ...])
   * @param {number[][]} candidatesPerVoice - Array of per-voice candidate arrays
   * @param {{ registers?: string[], commonToneWeight?: number }} [opts]
   * @returns {number[]} chosen notes (by voice index)
   */
  selectForVoices(lastNotesByVoice, candidatesPerVoice, opts = {}) {
    if (!Array.isArray(candidatesPerVoice) || candidatesPerVoice.length === 0) return [];

    const voices = candidatesPerVoice.length;
    const chosen = new Array(voices).fill(null);

    const registerForIndex = (idx) => {
      if (Array.isArray(opts.registers) && opts.registers[idx]) return opts.registers[idx];
      switch (idx) {
        case 0: return 'soprano';
        case 1: return 'alto';
        case 2: return 'tenor';
        case 3: return 'bass';
        default: return 'soprano';
      }
    };

    for (let i = 0; i < voices; i++) {
      const candidates = Array.isArray(candidatesPerVoice[i]) ? candidatesPerVoice[i] : [];
      if (candidates.length === 0) { chosen[i] = null; continue; }

      const register = registerForIndex(i);
      const lastNotes = Array.isArray(lastNotesByVoice[i]) ? lastNotesByVoice[i] : [];

      let bestCandidate = candidates[0];
      let bestScore = Infinity;

      for (const candidate of candidates) {
        // Base single-voice cost
        const baseCost = this._scoreCandidate(candidate, lastNotes, this.registers[register] || this.registers.soprano, [], { commonToneWeight: opts.commonToneWeight });

        // Crossing penalty vs higher voices already chosen
        let crossPenalty = 0;
        if (i > 0 && chosen[i - 1] !== null && typeof chosen[i - 1] === 'number') {
          // soprano should be >= alto, etc. If violated add a big penalty
          if (candidate <= chosen[i - 1]) crossPenalty += 6;
        }

        // Small penalty to discourage exact parallel motion with previous intervals
        let parallelPenalty = 0;
        if (this.history.length > 0 && lastNotes.length > 0) {
          const lastMotion = (lastNotes[0] - (lastNotes[1] || lastNotes[0]));
          const currentMotion = candidate - (lastNotes[0] || candidate);
          if ((currentMotion > 0 && lastMotion > 0) || (currentMotion < 0 && lastMotion < 0)) {
            parallelPenalty += 2;
          }
        }

        const total = baseCost + crossPenalty + parallelPenalty;
        if (total < bestScore) { bestScore = total; bestCandidate = candidate; }
      }

      chosen[i] = bestCandidate;
    }

    return chosen;
  }

  /**
   * Update scorer configuration at runtime. Accepts any subset of:
   * - weights: { smoothMotion, voiceRange, leapRecovery, voiceCrossing, parallelMotion }
   * - commonToneWeight
   * - contraryMotionPreference
   * - registers
   */
  updateConfig(cfg = {}) {
    if (typeof cfg !== 'object' || cfg === null) return;
    if (cfg.weights && typeof cfg.weights === 'object') {
      Object.assign(this.weights, cfg.weights);
    }
    if (typeof cfg.commonToneWeight === 'number') this.commonToneWeight = clamp(cfg.commonToneWeight, 0, 1);
    if (typeof cfg.contraryMotionPreference === 'number') this.contraryMotionPreference = clamp(cfg.contraryMotionPreference, 0, 1);
    if (cfg.registers && typeof cfg.registers === 'object') {
      this.registers = Object.assign({}, this.registers, cfg.registers);
    }
  }

  /**
   * Resets historical state (useful for starting new sections).
   */
  reset() {
    this.history = [];
  }
}

// Export for composition integration into centralized TEST hooks
let TEST;
try { TEST = require('../test-setup'); } catch (e) { TEST = null; }
try { if (TEST) TEST.VoiceLeadingScore = VoiceLeadingScore; } catch (e) { /* swallow */ }

// VoiceLeadingScore is exposed as a naked global via the assignment above
// (declared as `VoiceLeadingScore = class ...`) so requiring this file
// makes `VoiceLeadingScore` available to test scaffolding and runtime.
// Allow tests to `require()` this module and destructure the constructor.
/* eslint-disable-next-line no-restricted-syntax */
try { module.exports = { VoiceLeadingScore }; } catch (e) { /* swallow */ }
