// VoiceLeadingCore.js - core candidate scoring logic delegated from VoiceLeadingScore

VoiceLeadingCore = {
  /**
   * Compute the total cost for a candidate note, delegating to stateless scorer helpers.
   * @param {object} scorer - VoiceLeadingScore instance (for weights, history, etc.)
   * @param {number} candidate
   * @param {number[]} lastNotes
   * @param {number[]} registerRange
   * @param {string[]} constraints
   * @param {object} opts
   */
  computeCandidateScore(scorer, candidate, lastNotes, registerRange, constraints, opts = {}) {
    // Validate inputs
    if (!scorer || typeof scorer !== 'object') throw new Error('VoiceLeadingCore.computeCandidateScore: scorer instance required');
    if (!Array.isArray(lastNotes) || lastNotes.length === 0) throw new Error('VoiceLeadingCore.computeCandidateScore: lastNotes must be non-empty array');
    if (!Number.isFinite(Number(candidate))) throw new Error('VoiceLeadingCore.computeCandidateScore: candidate must be a finite number');
    for (let i = 0; i < lastNotes.length; i++) if (!Number.isFinite(Number(lastNotes[i]))) throw new Error(`VoiceLeadingCore.computeCandidateScore: lastNotes[${i}] must be finite number`);

    const lastNote = Number(lastNotes[0]);
    const interval = Math.abs(candidate - lastNote);

    // Determine current register
    let currentRegister = 'soprano';
    if (opts && opts.register !== undefined) {
      if (typeof opts.register !== 'string' || !scorer.registers[opts.register]) throw new Error('VoiceLeadingCore.computeCandidateScore: opts.register, if provided, must be a valid register name');
      currentRegister = opts.register;
    }

    constraints = Array.isArray(constraints) ? constraints : [];

    // Noise context
    const currentTime = (typeof beatStart !== 'undefined' ? beatStart : 0);
    const voiceId = Number(candidate) + (lastNote * 17);
    const noiseContext = { currentTime, voiceId };

    let totalCost = 0;

    // Smooth motion (voice leading preference)
    const smoothMotionMod = typeof applyVoiceLeadingWeightNoise === 'function' ? applyVoiceLeadingWeightNoise(1.0, 'smoothMotion', noiseContext) : 1.0;
    totalCost += VoiceLeadingScorers.scoreVoiceMotion(interval, lastNote, candidate) * (scorer.weights?.smoothMotion ?? 1.0) * smoothMotionMod;

    // Interval quality
    const intervalQualityMod = typeof applyVoiceLeadingWeightNoise === 'function' ? applyVoiceLeadingWeightNoise(1.0, 'intervalQuality', noiseContext) : 1.0;
    totalCost += VoiceLeadingScorers.scoreIntervalQuality(interval, lastNote, candidate, scorer.dynamism) * (scorer.weights?.intervalQuality ?? 0.5) * intervalQualityMod;

    // Consecutive leaps
    totalCost += VoiceLeadingScorers.scoreConsecutiveLeaps(interval, lastNotes, scorer.dynamism) * (scorer.weights?.consecutiveLeaps ?? 0.7);

    // Directional bias
    totalCost += VoiceLeadingScorers.scoreDirectionalBias(candidate, lastNote, currentRegister) * (scorer.weights?.directionalBias ?? 0.2);

    // Max leap constraint
    totalCost += VoiceLeadingScorers.scoreMaxLeap(interval, currentRegister, scorer.maxLeapSize, scorer.dynamism) * (scorer.weights?.maxLeap ?? 0.9);

    // Register boundaries
    totalCost += VoiceLeadingScorers.scoreVoiceRange(candidate, registerRange) * (scorer.weights?.voiceRange ?? 0.8);

    // Leap recovery
    if (lastNotes.length >= 2) {
      const prevInterval = Math.abs(lastNotes[0] - lastNotes[1]);
      totalCost += VoiceLeadingScorers.scoreLeapRecovery(scorer, interval, prevInterval, lastNotes, candidate) * (scorer.weights?.leapRecovery ?? 0.6);
    }

    // Voice crossing
    if (lastNotes.length > 1) {
      totalCost += VoiceLeadingScorers.scoreVoiceCrossing(candidate, lastNotes) * (scorer.weights?.voiceCrossing ?? 0.4);
    }

    // Parallel motion
    if (Array.isArray(scorer.history) && scorer.history.length > 0) {
      const lastHistory = scorer.history[scorer.history.length - 1];
      const lastMotion = (lastHistory && typeof lastHistory.interval === 'number') ? lastHistory.interval : 0;
      totalCost += VoiceLeadingScorers.scoreParallelMotion(candidate - lastNote, lastMotion) * (scorer.weights?.parallelMotion ?? 0.3);
    }

    // Common-tone preference
    const baseCtWeight = (opts && typeof opts.commonToneWeight === 'number') ? opts.commonToneWeight : scorer.commonToneWeight;
    const ctWeightMod = typeof applyVoiceLeadingWeightNoise === 'function' ? applyVoiceLeadingWeightNoise(1.0, 'commonTone', noiseContext) : 1.0;
    const ctWeight = (typeof baseCtWeight === 'number') ? (baseCtWeight * ctWeightMod) : 0;
    if (typeof ctWeight === 'number' && ctWeight > 0) {
      const samePC = (((candidate % 12) + 12) % 12) === (((lastNote % 12) + 12) % 12);
      if (samePC) totalCost -= Math.min(8, ctWeight * 4);
    }

    // Candidate weight bias
    if (opts && typeof opts.weight === 'number' && opts.weight > 0) {
      totalCost -= Math.min(8, opts.weight * 4);
    }

    // Hard constraints
    if (Array.isArray(constraints) && constraints.includes('avoidsStrident') && interval > 7) {
      totalCost += 5;
    }
    if (Array.isArray(constraints) && constraints.includes('stepsOnly') && interval > 2) {
      totalCost += 10;
    }

    return totalCost;
  }
};
