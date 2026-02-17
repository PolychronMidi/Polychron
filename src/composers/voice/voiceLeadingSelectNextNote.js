// voiceLeadingSelectNextNote.js - selection helper for VoiceLeadingScore

voiceLeadingSelectNextNote = function voiceLeadingSelectNextNote(vls, lastNotes, availableNotes, config = {}) {
  if (!vls || typeof vls !== 'object') throw new Error('voiceLeadingSelectNextNote: VoiceLeadingScore instance is required');

  if (!Array.isArray(lastNotes) || lastNotes.length === 0) {
    throw new Error('VoiceLeadingScore.selectNextNote: lastNotes must be a non-empty array of previous MIDI notes');
  }
  for (let i = 0; i < lastNotes.length; i++) {
    if (!Number.isFinite(Number(lastNotes[i]))) throw new Error(`VoiceLeadingScore.selectNextNote: lastNotes[${i}] is not a finite number`);
  }

  if (!Array.isArray(availableNotes) || availableNotes.length === 0) {
    throw new Error('VoiceLeadingScore.selectNextNote: availableNotes must be a non-empty array of candidate MIDI notes');
  }
  for (let i = 0; i < availableNotes.length; i++) {
    if (!Number.isFinite(Number(availableNotes[i]))) throw new Error(`VoiceLeadingScore.selectNextNote: availableNotes[${i}] is not a finite number`);
  }

  let register = 'soprano';
  if (config.register !== undefined) {
    if (typeof config.register !== 'string') throw new Error('VoiceLeadingScore.selectNextNote: config.register must be a string');
    if (!vls.registers[config.register]) throw new Error(`VoiceLeadingScore.selectNextNote: unknown register "${config.register}"`);
    register = config.register;
  }

  const constraints = config.constraints === undefined
    ? []
    : (Array.isArray(config.constraints)
      ? config.constraints
      : (() => { throw new Error('VoiceLeadingScore.selectNextNote: config.constraints must be an array'); })());
  const registerRange = vls.registers[register];
  const useCorpusMelodicPriors = config.useCorpusMelodicPriors === true;
  let melodicPriorWeights = null;

  if (useCorpusMelodicPriors) {
    if (typeof melodicPriors === 'undefined' || !melodicPriors || typeof melodicPriors.getCandidateWeights !== 'function') {
      throw new Error('VoiceLeadingScore.selectNextNote: melodicPriors.getCandidateWeights() unavailable while corpus melodic priors are enabled');
    }
    melodicPriorWeights = melodicPriors.getCandidateWeights({
      candidates: availableNotes,
      lastNote: Number(lastNotes[0]),
      quality: (typeof config.quality === 'string' && config.quality.length > 0) ? config.quality : undefined,
      tonic: (typeof config.tonic === 'string' && config.tonic.length > 0) ? config.tonic : undefined,
      phase: (typeof config.phase === 'string' && config.phase.length > 0) ? config.phase : undefined,
      phraseContext: (config.phraseContext && typeof config.phraseContext === 'object') ? config.phraseContext : undefined,
      strength: config.corpusMelodicStrength,
    });
  }

  const scores = availableNotes.map((note) => {
    const baseWeight = (config.candidateWeights && Number.isFinite(Number(config.candidateWeights[note]))) ? Number(config.candidateWeights[note]) : 0;
    const melodicWeight = (melodicPriorWeights && Number.isFinite(Number(melodicPriorWeights[note]))) ? Number(melodicPriorWeights[note]) : 0;
    const weight = (baseWeight > 0 && melodicWeight > 0)
      ? clamp(baseWeight * melodicWeight, 0.01, 12)
      : (baseWeight > 0)
        ? baseWeight
        : melodicWeight;
    return {
      note,
      score: vls._scoreCandidate(note, lastNotes, registerRange, constraints, {
        register,
        commonToneWeight: config.commonToneWeight,
        weight,
        useCorpusVoiceLeadingPriors: config.useCorpusVoiceLeadingPriors === true,
        corpusVoiceLeadingStrength: config.corpusVoiceLeadingStrength,
        phase: (typeof config.phase === 'string' && config.phase.length > 0) ? config.phase : undefined,
        phraseContext: (config.phraseContext && typeof config.phraseContext === 'object') ? config.phraseContext : undefined,
        quality: (typeof config.quality === 'string' && config.quality.length > 0) ? config.quality : undefined,
        tonic: (typeof config.tonic === 'string' && config.tonic.length > 0) ? config.tonic : undefined,
      }),
    };
  });

  scores.sort((a, b) => a.score - b.score);
  const bestNote = scores[0].note;
  vls._updateHistory(bestNote, register);
  return bestNote;
};
