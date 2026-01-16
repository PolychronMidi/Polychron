// voiceLeading/VoiceLeadingScore.js - Voice leading optimization and scoring
"use strict";

/**
 * VoiceLeadingScore - Evaluates voice leading quality using cost functions
 * Implements classical voice leading rules with configurable weights
 */
class VoiceLeadingScore {
  /**
   * @param {{
   *   smoothMotionWeight?: number,
   *   voiceRangeWeight?: number,
   *   leapRecoveryWeight?: number,
   *   voiceCrossingWeight?: number,
   *   parallelMotionWeight?: number,
   *   maxHistoryDepth?: number
   * }} options
   */
  constructor(options = {}) {
    // Configurable weights for different voice leading aspects
    this.weights = {
      smoothMotion: options.smoothMotionWeight ?? 1.0,
      voiceRange: options.voiceRangeWeight ?? 0.8,
      leapRecovery: options.leapRecoveryWeight ?? 0.6,
      voiceCrossing: options.voiceCrossingWeight ?? 2.0,
      parallelMotion: options.parallelMotionWeight ?? 1.5,
    };

    // Standard voice registers (MIDI note numbers)
    /** @type {Record<string, number[]>} */
    this.registers = {
      soprano: [60, 84],  // C4 to C6
      alto: [48, 72],     // C3 to C5
      tenor: [36, 60],    // C2 to C4
      bass: [24, 48],     // C1 to C3
    };

    // Track previous notes for leap recovery analysis
    /** @type {any[]} */
    this.prevNotes = [];
    /** @type {any[]} */
    this.prevIntervals = [];

    // Selection history tracking
    /** @type {any[]} */
    this.history = [];
    this.maxHistoryDepth = options.maxHistoryDepth || 8;
  }

  /**
   * Reset scorer state between compositions
   */
  reset() {
    this.prevNotes = [];
    this.prevIntervals = [];
    this.history = [];
  }

  /**
   * Score voice motion based on interval size
   * @private
   * @param {number} interval
   * @param {number} fromNote
   * @param {number} toNote
   */
  _scoreVoiceMotion(interval, fromNote, toNote) {
    const absInterval = Math.abs(interval);

    // Unison = perfect (0 cost)
    if (absInterval === 0) return 0;

    // Stepwise motion (1-2 semitones) = good (1 cost)
    if (absInterval <= 2) return 1;

    // Small leaps (3-5 semitones) = acceptable (3 cost)
    if (absInterval <= 5) return 3;

    // Tritone/sixth (6-7 semitones) = more costly (5 cost)
    if (absInterval <= 7) return 5;

    // Large leaps (>7 semitones) = avoid (10 cost)
    return 10;
  }

  /**
   * Score notes based on voice range
   * @private
   * @param {number} note
   * @param {number[]} range
   */
  _scoreVoiceRange(note, range) {
    const [min, max] = range;
    const rangeSize = max - min;
    const idealMin = min + rangeSize * 0.25;
    const idealMax = max - rangeSize * 0.25;

    // In ideal zone (middle 50%)
    if (note >= idealMin && note <= idealMax) return 0;

    // In range but not ideal
    if (note >= min && note <= max) return 2;

    // Out of range - penalty increases with distance
    if (note < min) {
      const distance = min - note;
      return 5 + distance * 0.5;
    }

    // Above range
    const distance = note - max;
    return 5 + distance * 0.5;
  }

  /**
   * Score leap recovery (leaps should be followed by step in opposite direction)
   * @private
   * @param {number} currentInterval
   * @param {number} previousInterval
   * @param {any[]} noteHistory
   */
  _scoreLeapRecovery(currentInterval, previousInterval, noteHistory) {
    const absCurrent = Math.abs(currentInterval);
    const absPrevious = Math.abs(previousInterval);

    // No penalty if previous motion was stepwise
    if (absPrevious <= 2) return 0;

    // Previous was a leap
    if (absPrevious > 4) {
      // Current is stepwise recovery
      if (absCurrent <= 2) {
        // Check if opposite direction
        if (noteHistory.length >= 3) {
          const direction1 = Math.sign(noteHistory[noteHistory.length - 1] - noteHistory[noteHistory.length - 2]);
          const direction2 = Math.sign(noteHistory[noteHistory.length - 2] - noteHistory[noteHistory.length - 3]);

          // Opposite direction = perfect recovery
          if (direction1 !== direction2) return 0;
        }
        return 1; // Step recovery but same direction
      }

      // Another leap after a leap = bad
      return 5;
    }

    return 0;
  }

  /**
   * Detect and penalize voice crossing
   * @private
   * @param {number} sopranoNote
   * @param {any[]} otherVoices
   */
  _scoreVoiceCrossing(sopranoNote, otherVoices) {
    // Soprano should be at or above all other voices
    for (const voice of otherVoices) {
      if (voice > sopranoNote) {
        return 10; // Heavy penalty for voice crossing
      }
    }
    return 0;
  }

  /**
   * Detect parallel fifths and octaves, and penalize same-direction motion
   * @private
   * @param {number} interval1
   * @param {number} interval2
   */
  _scoreParallelMotion(interval1, interval2) {
    // Parallel octaves or fifths (intervals of 12, 7, or 0) - heavy penalty
    const forbidden = [0, 7, 12];
    if (forbidden.includes(Math.abs(interval1 % 12)) &&
        forbidden.includes(Math.abs(interval2 % 12)) &&
        interval1 === interval2) {
      return 15; // Very heavy penalty
    }

    // Light penalty for same-direction motion (not forbidden intervals)
    if (Math.sign(interval1) === Math.sign(interval2) && interval1 !== 0 && interval2 !== 0) {
      return 1;
    }

    return 0;
  }

  /**
   * Calculate total voice leading cost for a set of notes
   * @param {any[]} currentNotes
   * @param {any[]|null} previousNotes
   * @param {string} register
   */
  calculateCost(currentNotes, previousNotes = null, register = 'soprano') {
    let totalCost = 0;
    /** @type {number[]} */
    const range = /** @type {number[]} */ (this.registers[register] || this.registers.soprano);

    // Score each voice
    for (let i = 0; i < currentNotes.length; i++) {
      const current = currentNotes[i];

      // Voice range cost
      totalCost += this._scoreVoiceRange(current, range) * this.weights.voiceRange;

      if (previousNotes && previousNotes[i] !== undefined) {
        const previous = previousNotes[i];
        const interval = current - previous;

        // Voice motion cost
        totalCost += this._scoreVoiceMotion(interval, previous, current) * this.weights.smoothMotion;

        // Leap recovery cost
        if (this.prevIntervals[i] !== undefined) {
          totalCost += this._scoreLeapRecovery(
            interval,
            this.prevIntervals[i],
            [this.prevNotes[i], previous, current]
          ) * this.weights.leapRecovery;
        }

        // Track for next iteration
        this.prevIntervals[i] = interval;
      }

      this.prevNotes[i] = current;
    }

    // Voice crossing cost (compare first note with others)
    if (currentNotes.length > 1) {
      totalCost += this._scoreVoiceCrossing(currentNotes[0], currentNotes.slice(1)) * this.weights.voiceCrossing;
    }

    // Parallel motion cost (between consecutive voice pairs)
    if (previousNotes && currentNotes.length > 1 && previousNotes.length > 1) {
      for (let i = 0; i < currentNotes.length - 1; i++) {
        const interval1 = previousNotes[i] - previousNotes[i + 1];
        const interval2 = currentNotes[i] - currentNotes[i + 1];
        totalCost += this._scoreParallelMotion(interval1, interval2) * this.weights.parallelMotion;
      }
    }

    return totalCost;
  }

  /**
   * Find the best voice leading between two sets of notes
   * @param {any[]} targetNotes
   * @param {any[]} previousNotes
   * @param {string} register
   */
  findBestVoicing(targetNotes, previousNotes, register = 'soprano') {
    if (!previousNotes || previousNotes.length === 0) {
      return targetNotes; // No optimization needed
    }

    // Generate permutations and find lowest cost
    const permutations = this._generatePermutations(targetNotes);
    let bestVoicing = targetNotes;
    let bestCost = Infinity;

    for (const voicing of permutations) {
      const cost = this.calculateCost(voicing, previousNotes, register);
      if (cost < bestCost) {
        bestCost = cost;
        bestVoicing = voicing;
      }
    }

    return bestVoicing;
  }

  /**
   * Generate all permutations of notes
   * @private
   * @param {any[]} array
   * @returns {any[][]}
   */
  _generatePermutations(array) {
    if (array.length <= 1) return [array];

    const permutations = [];
    for (let i = 0; i < array.length; i++) {
      const current = array[i];
      const remaining = array.slice(0, i).concat(array.slice(i + 1));
      /** @type {any[][]} */
      const subPermutations = this._generatePermutations(remaining);

      for (const sub of subPermutations) {
        permutations.push([current, ...sub]);
      }
    }

    return permutations;
  }

  /**
   * Select the best next note from candidates based on voice leading
   * @param {any[]} previousNotes - Previous notes in the voice
   * @param {any[]} candidates - Candidate notes to choose from
   * @param {{ register?: string, constraints?: any[] }} options - Selection options (register, constraints)
   * @returns {number} Selected note
   */
  selectNextNote(previousNotes, candidates, options = {}) {
    // Fallback if no candidates
    if (!candidates || candidates.length === 0) {
      return previousNotes && previousNotes.length > 0 ? previousNotes[previousNotes.length - 1] : 60;
    }

    // If no previous notes, just pick from candidates (prefer middle)
    if (!previousNotes || previousNotes.length === 0) {
      /** @type {string} */
      const register = /** @type {string} */ ((options && options.register) || 'soprano');
      /** @type {number[]} */
      const range = /** @type {number[]} */ (this.registers[register] || this.registers.soprano);

      // Filter by register
      let validCandidates = candidates.filter(note => note >= range[0] && note <= range[1]);
      if (validCandidates.length === 0) {
        validCandidates = candidates; // Use all candidates if none in range
      }

      // Pick a candidate (prefer first for consistency)
      const selected = validCandidates[0];

      // Track in history
      this.history.push(selected);
      if (this.history.length > this.maxHistoryDepth) {
        this.history.shift();
      }

      return selected;
    }

    /** @type {string} */
    const register = /** @type {string} */ ((options && options.register) || 'soprano');
    /** @type {any[]} */
    const constraints = /** @type {any[]} */ ((options && options.constraints) || []);
    /** @type {number[]} */
    const range = /** @type {number[]} */ (this.registers[register] || this.registers.soprano);

    // Filter candidates by register if specified
    let validCandidates = candidates.filter(note => note >= range[0] && note <= range[1]);

    // If no candidates in range, use all candidates
    if (validCandidates.length === 0) {
      validCandidates = candidates;
    }

    const prevNote = previousNotes[previousNotes.length - 1];

    // Apply hard constraints
    if (constraints.includes('avoidsStrident')) {
      // Avoid large leaps (> 7 semitones)
      const filtered = validCandidates.filter(note => Math.abs(note - prevNote) <= 7);
      if (filtered.length > 0) validCandidates = filtered;
    }

    if (constraints.includes('stepsOnly')) {
      // Only allow stepwise motion (≤ 2 semitones)
      const filtered = validCandidates.filter(note => Math.abs(note - prevNote) <= 2);
      if (filtered.length > 0) validCandidates = filtered;
    }

    // If no valid candidates after constraints, fall back to previous note
    if (validCandidates.length === 0) {
      return prevNote;
    }

    // Score each candidate and select the best
    let bestNote = validCandidates[0];
    let bestCost = Infinity;

    for (const candidate of validCandidates) {
      const cost = this.calculateCost([candidate], [prevNote], register);
      if (cost < bestCost) {
        bestCost = cost;
        bestNote = candidate;
      }
    }

    // Track in history
    this.history.push(bestNote);
    if (this.history.length > this.maxHistoryDepth) {
      this.history.shift();
    }

    return bestNote;
  }

  /**
   * Analyze the quality of a note sequence
   * @param {any[]} sequence - Array of notes to analyze
   * @returns {Object} Quality metrics (smoothness, leapRecoveries, avgRange)
   */
  analyzeQuality(sequence) {
    if (!sequence || sequence.length < 2) {
      return { smoothness: 0, leapRecoveries: 0, avgRange: sequence[0] || 60 };
    }

    let totalCost = 0;
    let leapRecoveries = 0;
    let previousInterval = 0;

    for (let i = 1; i < sequence.length; i++) {
      const interval = sequence[i] - sequence[i - 1];
      const absInterval = Math.abs(interval);

      // Add motion cost
      totalCost += this._scoreVoiceMotion(interval, sequence[i - 1], sequence[i]);

      // Check for leap recovery
      if (i >= 2 && Math.abs(previousInterval) > 4 && absInterval <= 2) {
        // Check if recovery is in opposite direction
        if (Math.sign(interval) !== Math.sign(previousInterval)) {
          leapRecoveries++;
        }
      }

      previousInterval = interval;
    }

    // Calculate average smoothness per note
    const smoothness = totalCost / (sequence.length - 1);

    // Calculate average range
    const sum = sequence.reduce((a, b) => a + b, 0);
    const avgRange = sum / sequence.length;

    return {
      smoothness,
      leapRecoveries,
      avgRange
    };
  }
}

// Export to global scope
globalThis.VoiceLeadingScore = VoiceLeadingScore;

module.exports = VoiceLeadingScore;