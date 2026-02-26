VoiceLeadingComposer = class VoiceLeadingComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', commonToneWeight = 0.7, contraryMotionPreference = 0.4) {
    if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('VoiceLeadingComposer: allNotes not available');
    if (!Array.isArray(allScales) || allScales.length === 0) throw new Error('VoiceLeadingComposer: allScales not available');
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    // enable voice-leading scorer for pick delegation with composer-provided tunables
    this.enableVoiceLeading(new VoiceLeadingScore({ commonToneWeight: clamp(commonToneWeight, 0, 1), contraryMotionPreference: clamp(contraryMotionPreference, 0, 1) }));
  }

  getNotes(octaveRange) {
    // Return full note pool for centralized voice selection
    // Voice leading optimization now handled by VoiceManager/voiceRegistry
    const notes = super.getNotes(octaveRange);
    if (!Array.isArray(notes) || notes.length === 0) {
      throw new Error('VoiceLeadingComposer.getNotes: expected super.getNotes() to return a non-empty array');
    }
    return notes;
  }



  setCommonToneWeight(weight) {
    if (this.VoiceLeadingScore) this.VoiceLeadingScore.commonToneWeight = clamp(weight, 0, 1);
  }

  setContraryMotionPreference(probability) {
    if (this.VoiceLeadingScore) this.VoiceLeadingScore.contraryMotionPreference = clamp(probability, 0, 1);
  }

  analyzeFiguredBass(notes) {
    if (!notes || notes.length === 0) { throw new Error('VoiceLeadingComposer.analyzeFiguredBass: notes absent'); }
    const bass = m.min(...notes.map(n => n.note));
    const intervals = notes.map(n => n.note - bass).filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b);
    return { bass, intervals };
  }
}
