// VoiceRegistry.js - canonical multi-voice selection function

VoiceRegistry = function voiceRegistry(scorer, lastNotesByVoice, candidatesPerVoice, opts = {}) {
  if (!scorer || typeof scorer._scoreCandidate !== 'function') throw new Error('VoiceRegistry: valid scorer (VoiceLeadingScore) required');
  if (!Array.isArray(candidatesPerVoice) || candidatesPerVoice.length === 0) throw new Error('VoiceRegistry: candidatesPerVoice must be a non-empty array');
  const voices = candidatesPerVoice.length;
  if (!Array.isArray(lastNotesByVoice)) throw new Error('VoiceRegistry: lastNotesByVoice must be an array');

  const chosen = new Array(voices);
  const chosenSet = new Set();

  const registerForIndex = (idx) => {
    if (opts && opts.registers && opts.registers[idx]) return opts.registers[idx];
    return ['soprano', 'alto', 'tenor', 'bass'][idx] || 'soprano';
  };

  // Voice spacing constraint: ensure minimum semitone distance between simultaneous notes
  const minSemitones = Number.isFinite(Number(opts.minSemitones)) ? m.max(0, Number(opts.minSemitones)) : 3;

  const isTooCloseToChosen = (candidate) => {
    if (!Number.isFinite(Number(candidate))) throw new Error('VoiceRegistry: candidate must be a finite number');
    for (const chosenNote of chosenSet) {
      const interval = m.abs(candidate - chosenNote);
      if (interval < minSemitones && interval > 0) return true;
    }
    return false;
  };

  for (let i = 0; i < voices; i++) {
    const candidates = candidatesPerVoice[i];
    const register = registerForIndex(i);
    const lastNotes = Array.isArray(lastNotesByVoice[i]) ? lastNotesByVoice[i] : [];
    if (typeof lastNotesByVoice[i] !== 'undefined' && !Array.isArray(lastNotesByVoice[i])) {
      throw new Error(`VoiceRegistry: lastNotesByVoice[${i}] must be an array if provided`);
    }
    const registerRange = scorer.registers[register] || scorer.registers.soprano;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error(`VoiceRegistry: voice ${i} (${register}) has no candidate notes available`);
    }

    let bestCandidate = null;
    let bestScore = Infinity;
    let melodicPriorWeights = null;

    if (opts && opts.useCorpusMelodicPriors === true) {
      melodicPriorWeights = melodicPriors.getCandidateWeights({
        candidates,
        lastNote: (lastNotes.length > 0 && Number.isFinite(Number(lastNotes[0]))) ? Number(lastNotes[0]) : undefined,
        quality: (opts && typeof opts.quality === 'string' && opts.quality.length > 0) ? opts.quality : undefined,
        tonic: (opts && typeof opts.tonic === 'string' && opts.tonic.length > 0) ? opts.tonic : undefined,
        phase: (opts && typeof opts.phase === 'string' && opts.phase.length > 0) ? opts.phase : undefined,
        phraseContext: (opts && opts.phraseContext && typeof opts.phraseContext === 'object') ? opts.phraseContext : undefined,
        strength: opts && opts.corpusMelodicStrength,
      });
    }

    for (const candidate of candidates) {
      if (!Number.isFinite(Number(candidate))) throw new Error(`VoiceRegistry: candidate "${candidate}" for voice ${i} is not a finite number`);
      if (chosenSet.has(candidate)) continue;
      if (isTooCloseToChosen(candidate)) continue;
      const baseWeight = (opts && opts.candidateWeights && Number.isFinite(Number(opts.candidateWeights[candidate]))) ? Number(opts.candidateWeights[candidate]) : 0;
      const melodicWeight = (melodicPriorWeights && Number.isFinite(Number(melodicPriorWeights[candidate]))) ? Number(melodicPriorWeights[candidate]) : 0;
      const candidateWeight = (baseWeight > 0 && melodicWeight > 0)
        ? clamp(baseWeight * melodicWeight, 0.01, 12)
        : (baseWeight > 0)
          ? baseWeight
          : melodicWeight;
      const scoringLastNotes = lastNotes.length > 0 ? lastNotes : [Number(candidate)];
      // Base single-voice cost from VoiceLeadingScore
      const baseCost = scorer._scoreCandidate(
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
          phase: (opts && typeof opts.phase === 'string' && opts.phase.length > 0) ? opts.phase : undefined,
          phraseContext: (opts && opts.phraseContext && typeof opts.phraseContext === 'object') ? opts.phraseContext : undefined,
          quality: (opts && typeof opts.quality === 'string' && opts.quality.length > 0) ? opts.quality : undefined,
          tonic: (opts && typeof opts.tonic === 'string' && opts.tonic.length > 0) ? opts.tonic : undefined,
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
        const lastMotion = Number(lastNotes[0]) - (Number.isFinite(Number(lastNotes[1])) ? Number(lastNotes[1]) : Number(lastNotes[0]));
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
      if (!Number.isFinite(Number(available))) {
        throw new Error(`VoiceRegistry: voice ${i} (${register}) unable to select note - all candidates already chosen or no candidates available`);
      }
      bestCandidate = Number(available);
    }

    chosen[i] = bestCandidate;
    chosenSet.add(Number(bestCandidate));
  }

  return chosen;
};


