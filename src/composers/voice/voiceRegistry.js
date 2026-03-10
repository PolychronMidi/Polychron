// voiceRegistry.js - canonical multi-voice selection function

voiceRegistry = function voiceRegistry(scorer, lastNotesByVoice, candidatesPerVoice, opts = {}) {
  const V = validator.create('voiceRegistry');
  V.assertObject(scorer, 'scorer');
  V.requireType(scorer.voiceRegistryScoreCandidate, 'function', 'scorer.voiceRegistryScoreCandidate');
  V.assertArray(candidatesPerVoice, 'candidatesPerVoice', true);
  const voices = candidatesPerVoice.length;
  V.assertArray(lastNotesByVoice, 'lastNotesByVoice');

  const chosen = new Array(voices);
  const chosenSet = new Set();

  const registerForIndex = (idx) => {
    if (opts && opts.registers && opts.registers[idx]) return opts.registers[idx];
    return ['soprano', 'alto', 'tenor', 'bass'][idx] || 'soprano';
  };

  // Voice spacing constraint: ensure minimum semitone distance between simultaneous notes
  const minSemitones = V.optionalFinite(Number(opts.minSemitones), 3);

  const isTooCloseToChosen = (candidate) => {
    V.requireFinite(Number(candidate), 'isTooCloseToChosen.candidate');
    for (const chosenNote of chosenSet) {
      const interval = m.abs(candidate - chosenNote);
      if (interval < minSemitones && interval > 0) return true;
    }
    return false;
  };

  for (let i = 0; i < voices; i++) {
    const candidates = candidatesPerVoice[i];
    const register = registerForIndex(i);
    const rawLnv = lastNotesByVoice[i];
    if (rawLnv !== undefined) V.assertArray(rawLnv, `lastNotesByVoice[${i}]`);
    const lastNotes = rawLnv !== undefined ? rawLnv : [];
    const registerRange = scorer.registers[register] || scorer.registers.soprano;

    V.assertArray(candidates, `candidates[${i}]`, true);

    let bestCandidate = null;
    let bestScore = Infinity;
    let melodicPriorWeights = null;

    if (opts && opts.useCorpusMelodicPriors === true) {
      melodicPriorWeights = melodicPriors.getCandidateWeights({
        candidates,
        lastNote: V.optionalFinite(lastNotes.length > 0 && Number(lastNotes[0])),
        quality: V.optionalType(opts.quality, 'string') || undefined,
        tonic: V.optionalType(opts.tonic, 'string') || undefined,
        phase: V.optionalType(opts.phase, 'string') || undefined,
        phraseContext: V.optionalType(opts.phraseContext, 'object') || undefined,
        strength: opts && opts.corpusMelodicStrength,
      });
    }

    for (const candidate of candidates) {
      V.requireFinite(Number(candidate), `candidate[voice${i}]`);
      if (chosenSet.has(candidate)) continue;
      if (isTooCloseToChosen(candidate)) continue;
      const baseWeight = V.optionalFinite(opts && opts.candidateWeights && Number(opts.candidateWeights[candidate]), 0);
      const melodicWeight = V.optionalFinite(melodicPriorWeights && Number(melodicPriorWeights[candidate]), 0);
      const candidateWeight = (baseWeight > 0 && melodicWeight > 0)
        ? clamp(baseWeight * melodicWeight, 0.01, 12)
        : (baseWeight > 0)
          ? baseWeight
          : melodicWeight;
      const scoringLastNotes = lastNotes.length > 0 ? lastNotes : [Number(candidate)];
      // Base single-voice cost from VoiceLeadingScore
      const baseCost = scorer.voiceRegistryScoreCandidate(
        Number(candidate),
        scoringLastNotes,
        registerRange,
        [],
        {
          register,
          commonToneWeight: opts && opts.commonToneWeight,
          weight: candidateWeight,
          useCorpusVoiceLeadingPriors: opts && opts.useCorpusVoiceLeadingPriors === true,
          corpusVoiceLeadingStrength: opts && opts.corpusVoiceLeadingStrength,
          phase: V.optionalType(opts.phase, 'string') || undefined,
          phraseContext: V.optionalType(opts.phraseContext, 'object') || undefined,
          quality: V.optionalType(opts.quality, 'string') || undefined,
          tonic: V.optionalType(opts.tonic, 'string') || undefined,
        }
      );

      // Crossing penalty - soprano >= alto >= tenor >= bass
      let crossPenalty = 0;
      if (i > 0 && Number.isFinite(Number(chosen[i - 1])) && candidate <= chosen[i - 1]) {
        crossPenalty = 6;
      }

      // Parallel motion penalty
      let parallelPenalty = 0;
      if (scorer.history.length > 0 && lastNotes.length > 0 && Number.isFinite(Number(lastNotes[0]))) {
        const lastMotion = Number(lastNotes[0]) - V.optionalFinite(Number(lastNotes[1]), Number(lastNotes[0]));
        const currentMotion = Number(candidate) - Number(lastNotes[0]);
        if ((currentMotion > 0 && lastMotion > 0) || (currentMotion < 0 && lastMotion < 0)) {
          parallelPenalty = 2;
        }
      }

      const total = baseCost + crossPenalty + parallelPenalty;
      if (total < bestScore) {
        bestScore = total;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate === null) {
      const available = candidates.find(note => !chosenSet.has(note));
      V.requireFinite(Number(available), `fallback.voice[${i}]`);
      bestCandidate = Number(available);
    }

    chosen[i] = bestCandidate;
    chosenSet.add(Number(bestCandidate));
  }

  return chosen;
};
