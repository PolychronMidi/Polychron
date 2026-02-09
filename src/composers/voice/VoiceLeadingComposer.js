// Dependencies are required via `src/composers/index.js`

VoiceLeadingComposer = class VoiceLeadingComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', commonToneWeight = 0.7, contraryMotionPreference = 0.4) {
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    // enable voice-leading scorer for pick delegation with composer-provided tunables
    try { this.enableVoiceLeading(new VoiceLeadingScore({ commonToneWeight: clamp(commonToneWeight, 0, 1), contraryMotionPreference: clamp(contraryMotionPreference, 0, 1) })); } catch (e) { console.warn('VoiceLeadingComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
  }

  getNotes(octaveRange) {
    // Return full note pool for centralized voice selection
    // Voice leading optimization now handled by VoiceManager/selectVoices
    return super.getNotes(octaveRange);
  }



  setCommonToneWeight(weight) {
    if (this.VoiceLeadingScore) this.VoiceLeadingScore.commonToneWeight = clamp(weight, 0, 1);
  }

  setContraryMotionPreference(probability) {
    if (this.VoiceLeadingScore) this.VoiceLeadingScore.contraryMotionPreference = clamp(probability, 0, 1);
  }

  analyzeFiguredBass(notes) {
    if (!notes || notes.length === 0) { console.warn('VoiceLeadingComposer.analyzeFiguredBass: notes absent — returning null'); return null; }
    const bass = m.min(...notes.map(n => n.note));
    const intervals = notes.map(n => n.note - bass).filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b);
    return { bass, intervals };
  }
}
