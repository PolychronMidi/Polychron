// VoiceLeadingCore.js - core candidate scoring logic delegated from VoiceLeadingScore
const V = Validator.create('VoiceLeadingCore');

/**
 * @typedef {Object} VoiceLeadingCoreOpts
 * @property {string} [register] - Register name
 * @property {number} [commonToneWeight] - Weight for common tones
 * @property {number} [weight] - Candidate weight bias
 * @property {boolean} [useCorpusVoiceLeadingPriors] - Whether to apply corpus priors
 * @property {number} [corpusVoiceLeadingStrength] - Strength of corpus priors (0-2)
 * @property {string} [phase] - Phrase phase
 * @property {Object} [phraseContext] - Phrase context object
 * @property {string} [phraseContext.phase] - Phase from phrase context
 * @property {string} [quality] - Harmonic quality
 * @property {string} [tonic] - Tonic key
 */

VoiceLeadingCore = {
  /**
   * Compute the total cost for a candidate note, delegating to stateless scorer helpers.
   * @param {object} scorer - VoiceLeadingScore instance (for weights, history, etc.)
   * @param {number} candidate
   * @param {number[]} lastNotes
   * @param {number[]} registerRange
   * @param {string[]} constraints
   * @param {VoiceLeadingCoreOpts} opts
   */
  computeCandidateScore(scorer, candidate, lastNotes, registerRange, constraints, opts = {}) {
    // Validate inputs
    V.requireDefined(scorer, 'scorer');
    V.requireFinite(candidate, 'candidate');
    V.assertArray(lastNotes, 'lastNotes');
    if (!Array.isArray(lastNotes) || lastNotes.length === 0) throw new Error('VoiceLeadingCore.computeCandidateScore: lastNotes must be non-empty array');
    for (let i = 0; i < lastNotes.length; i++) if (!Number.isFinite(Number(lastNotes[i]))) throw new Error(`VoiceLeadingCore.computeCandidateScore: lastNotes[${i}] must be finite number`);

    const lastNote = Number(lastNotes[0]);
    const interval = m.abs(candidate - lastNote);

    // Determine current register
    let currentRegister = 'soprano';
    if (opts && opts.register !== undefined) {
      if (typeof opts.register !== 'string' || !scorer.registers[opts.register]) throw new Error('VoiceLeadingCore.computeCandidateScore: opts.register, if provided, must be a valid register name');
      currentRegister = opts.register;
    }

    constraints = Array.isArray(constraints) ? constraints : [];

    // Noise context
    const currentTime = beatStart;
    const voiceId = Number(candidate) + (lastNote * 17);
    const noiseContext = { currentTime, voiceId };

    let totalCost = 0;

    // Smooth motion (voice leading preference)
    const smoothMotionMod = applyVoiceLeadingWeightNoise(1.0, 'smoothMotion', noiseContext);
    totalCost += VoiceLeadingScorers.scoreVoiceMotion(interval, lastNote, candidate) * (scorer.weights?.smoothMotion ?? 1.0) * smoothMotionMod;

    // Interval quality
    const intervalQualityMod = applyVoiceLeadingWeightNoise(1.0, 'intervalQuality', noiseContext);
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
      const prevInterval = m.abs(lastNotes[0] - lastNotes[1]);
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
    const ctWeightMod = applyVoiceLeadingWeightNoise(1.0, 'commonTone', noiseContext);
    const ctWeight = (typeof baseCtWeight === 'number') ? (baseCtWeight * ctWeightMod) : 0;
    if (typeof ctWeight === 'number' && ctWeight > 0) {
      const samePC = (((candidate % 12) + 12) % 12) === (((lastNote % 12) + 12) % 12);
      if (samePC) totalCost -= m.min(8, ctWeight * 4);
    }

    // Candidate weight bias
    if (opts && typeof opts.weight === 'number' && opts.weight > 0) {
      totalCost -= m.min(8, opts.weight * 4);
    }

    // Hard constraints
    if (Array.isArray(constraints) && constraints.includes('avoidsStrident') && interval > 7) {
      totalCost += 5;
    }
    if (Array.isArray(constraints) && constraints.includes('stepsOnly') && interval > 2) {
      totalCost += 10;
    }

    const useCorpusVoiceLeadingPriors = opts && opts.useCorpusVoiceLeadingPriors === true;
    if (useCorpusVoiceLeadingPriors) {
      const phrasePhase = (opts && typeof opts.phase === 'string' && opts.phase.length > 0)
        ? opts.phase
        : (opts && opts.phraseContext && typeof opts.phraseContext.phase === 'string' && opts.phraseContext.phase.length > 0)
          ? opts.phraseContext.phase
          : undefined;

      const harmonicKey = (opts && typeof opts.tonic === 'string' && opts.tonic.length > 0)
        ? opts.tonic
        : (HarmonicContext && HarmonicContext.getField)
          ? HarmonicContext.getField('key')
          : undefined;

      const harmonicQuality = (opts && typeof opts.quality === 'string' && opts.quality.length > 0)
        ? opts.quality
        : (HarmonicContext && HarmonicContext.getField)
          ? HarmonicContext.getField('quality')
          : 'major';

      const corpusStrength = Number.isFinite(Number(opts && opts.corpusVoiceLeadingStrength))
        ? Number(opts.corpusVoiceLeadingStrength)
        : 0.8;

      totalCost += voiceLeadingPriors.getCandidateAdjustment({
        quality: harmonicQuality,
        phase: phrasePhase,
        tonic: harmonicKey,
        fromNote: lastNote,
        toNote: candidate,
        strength: corpusStrength,
      });
    }

    return totalCost;
  },

  /**
   * Build candidate weight map based on pitch-class membership.
   * @param {number[]} candidateNotes - MIDI notes to weight
   * @param {(string|number)[]} referenceNotes - Note names (e.g., 'C4') or MIDI notes defining valid PCs
   * @param {number} [matchWeight=1] - Weight for matching PCs
   * @param {number} [nonMatchWeight=0] - Weight for non-matching PCs
   * @returns {{ [note: number]: number }} Candidate weight map
   */
  buildPCWeights(candidateNotes, referenceNotes, matchWeight = 1, nonMatchWeight = 0) {
    if (!Array.isArray(candidateNotes) || candidateNotes.length === 0) {
      throw new Error('VoiceLeadingCore.buildPCWeights: candidateNotes must be a non-empty array');
    }
    if (!Array.isArray(referenceNotes) || referenceNotes.length === 0) {
      throw new Error('VoiceLeadingCore.buildPCWeights: referenceNotes must be a non-empty array');
    }

    const referencePCs = new Set();
    for (const item of referenceNotes) {
      let pc;
      if (typeof item === 'string') {
        const chroma = t.Note.chroma(item);
        if (typeof chroma === 'number' && Number.isFinite(chroma)) {
          pc = ((chroma % 12) + 12) % 12;
        }
      } else if (typeof item === 'number' && Number.isFinite(item)) {
        pc = ((item % 12) + 12) % 12;
      }
      if (typeof pc === 'number') referencePCs.add(pc);
    }

    if (referencePCs.size === 0) {
      throw new Error('VoiceLeadingCore.buildPCWeights: no valid pitch classes extracted from referenceNotes');
    }

    /** @type {{ [note: number]: number }} */
    const weights = {};
    for (const note of candidateNotes) {
      if (!Number.isFinite(Number(note))) {
        throw new Error(`VoiceLeadingCore.buildPCWeights: candidate note ${note} is not finite`);
      }
      const pc = ((Number(note) % 12) + 12) % 12;
      weights[note] = referencePCs.has(pc) ? matchWeight : nonMatchWeight;
    }

    return weights;
  }
};
