// VoiceRegistry.js - canonical multi-voice selection function

VoiceRegistry = function VoiceRegistry(scorer, lastNotesByVoice, candidatesPerVoice, opts = {}) {
  const voices = candidatesPerVoice.length;
  const chosen = new Array(voices);
  const chosenSet = new Set();

  const registerForIndex = (idx) => {
    if (opts.registers && opts.registers[idx]) return opts.registers[idx];
    return ['soprano', 'alto', 'tenor', 'bass'][idx] || 'soprano';
  };

  for (let i = 0; i < voices; i++) {
    const candidates = candidatesPerVoice[i];
    const register = registerForIndex(i);
    const lastNotes = lastNotesByVoice[i] || [];
    const registerRange = scorer.registers[register] || scorer.registers.soprano;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error(`VoiceRegistry: voice ${i} (${register}) has no candidate notes available`);
    }

    let bestCandidate = null;
    let bestScore = Infinity;

    for (const candidate of candidates) {
      if (chosenSet.has(candidate)) continue;
      const candidateWeight = opts.candidateWeights ? Number(opts.candidateWeights[candidate]) || 0 : 0;
      // Base single-voice cost from VoiceLeadingScore
      const baseCost = scorer._scoreCandidate(
        candidate,
        lastNotes,
        registerRange,
        [],
        { commonToneWeight: opts.commonToneWeight, weight: candidateWeight }
      );

      // Crossing penalty - soprano >= alto >= tenor >= bass
      let crossPenalty = 0;
      if (i > 0 && candidate <= chosen[i - 1]) {
        crossPenalty = 6;
      }

      // Parallel motion penalty
      let parallelPenalty = 0;
      if (scorer.history.length > 0 && lastNotes.length > 0) {
        const lastMotion = lastNotes[0] - (lastNotes[1] || lastNotes[0]);
        const currentMotion = candidate - (lastNotes[0] || candidate);
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
      if (typeof available !== 'number') {
        throw new Error(`VoiceRegistry: voice ${i} (${register}) unable to select note - all candidates already chosen or no candidates available`);
      }
      bestCandidate = available;
    }

    chosen[i] = bestCandidate;
    chosenSet.add(bestCandidate);
  }

  return chosen;
};
