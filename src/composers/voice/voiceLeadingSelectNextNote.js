// voiceLeadingSelectNextNote.js - selection helper for VoiceLeadingScore

voiceLeadingSelectNextNote = function voiceLeadingSelectNextNote(vls, lastNotes, availableNotes, config = {}) {
  const V = validator.create('voiceLeadingSelectNextNote');
  V.assertObject(vls, 'vls');
  V.assertArray(lastNotes, 'lastNotes', true);
  for (let i = 0; i < lastNotes.length; i++) {
    V.requireFinite(Number(lastNotes[i]), `lastNotes[${i}]`);
  }
  V.assertArray(availableNotes, 'availableNotes', true);
  for (let i = 0; i < availableNotes.length; i++) {
    V.requireFinite(Number(availableNotes[i]), `availableNotes[${i}]`);
  }

  let register = 'soprano';
  if (config.register !== undefined) {
    V.requireType(config.register, 'string', 'config.register');
    if (!vls.registers[config.register]) throw new Error(`VoiceLeadingScore.selectNextNote: unknown register "${config.register}"`);
    register = config.register;
  }

  const constraints = config.constraints === undefined
    ? []
    : (V.assertArray(config.constraints, 'config.constraints'), config.constraints);
  const registerRange = vls.registers[register];
  const useCorpusMelodicPriors = config.useCorpusMelodicPriors === true;
  let melodicPriorWeights = null;

  if (useCorpusMelodicPriors) {
    melodicPriorWeights = melodicPriors.getCandidateWeights({
      candidates: availableNotes,
      lastNote: Number(lastNotes[0]),
      quality: V.optionalType(config.quality, 'string') || undefined,
      tonic: V.optionalType(config.tonic, 'string') || undefined,
      phase: V.optionalType(config.phase, 'string') || undefined,
      phraseContext: V.optionalType(config.phraseContext, 'object') || undefined,
      strength: config.corpusMelodicStrength,
    });
  }

  let bestNote = availableNotes[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < availableNotes.length; i++) {
    const note = availableNotes[i];
    const baseWeight = V.optionalFinite(config.candidateWeights && Number(config.candidateWeights[note]), 0);
    const melodicWeight = V.optionalFinite(melodicPriorWeights && Number(melodicPriorWeights[note]), 0);
    const weight = (baseWeight > 0 && melodicWeight > 0)
      ? clamp(baseWeight * melodicWeight, 0.01, 12)
      : (baseWeight > 0)
        ? baseWeight
        : melodicWeight;
    const score = vls.VoiceLeadingScoreScoreCandidate(note, lastNotes, registerRange, constraints, {
      register,
      commonToneWeight: config.commonToneWeight,
      weight,
      useCorpusVoiceLeadingPriors: config.useCorpusVoiceLeadingPriors === true,
      corpusVoiceLeadingStrength: config.corpusVoiceLeadingStrength,
      phase: V.optionalType(config.phase, 'string') || undefined,
      phraseContext: V.optionalType(config.phraseContext, 'object') || undefined,
      quality: V.optionalType(config.quality, 'string') || undefined,
      tonic: V.optionalType(config.tonic, 'string') || undefined,
    });
    if (score < bestScore) {
      bestScore = score;
      bestNote = note;
    }
  }

  vls.VoiceLeadingScoreUpdateHistory(bestNote, register);
  return bestNote;
};
