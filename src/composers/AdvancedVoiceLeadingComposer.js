require('./ScaleComposer');

AdvancedVoiceLeadingComposer = class AdvancedVoiceLeadingComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', commonToneWeight = 0.7) {
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    this.commonToneWeight = clamp(commonToneWeight, 0, 1);
    this.previousNotes = [];
    this.voiceBalanceThreshold = 3;
    this.contraryMotionPreference = 0.4;
  }

  getNotes(octaveRange) {
    const baseNotes = super.getNotes(octaveRange);
    if (!baseNotes || baseNotes.length === 0) return baseNotes;
    if (this.previousNotes.length === 0) {
      this.previousNotes = baseNotes;
      return baseNotes;
    }
    const optimizedNotes = this.optimizeVoiceLeading(baseNotes);
    this.previousNotes = optimizedNotes;
    return optimizedNotes;
  }

  optimizeVoiceLeading(newNotes) {
    const result = [];
    const prevByVoice = [...this.previousNotes];
    for (let voiceIdx = 0; voiceIdx < newNotes.length && voiceIdx < prevByVoice.length; voiceIdx++) {
      const newNote = newNotes[voiceIdx];
      const prevNote = prevByVoice[voiceIdx];
      if (!newNote || !prevNote) {
        result.push(newNote || prevNote);
        continue;
      }
      const newPC = newNote.note % 12;
      const prevPC = prevNote.note % 12;
      if (newPC === prevPC && rf() < this.commonToneWeight) {
        result.push({ ...newNote, note: prevNote.note });
      } else {
        const step = rf() < this.contraryMotionPreference ? ri(-4, -1) : ri(1, 4);
        result.push({ ...newNote, note: clamp(prevNote.note + step, 0, 127) });
      }
    }
    return result;
  }

  setCommonToneWeight(weight) {
    this.commonToneWeight = clamp(weight, 0, 1);
  }

  setContraryMotionPreference(probability) {
    this.contraryMotionPreference = clamp(probability, 0, 1);
  }

  analyzeFiguredBass(notes) {
    if (!notes || notes.length === 0) return null;
    const bass = m.min(...notes.map(n => n.note));
    const intervals = notes.map(n => n.note - bass).filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b);
    return { bass, intervals };
  }
}

/* AdvancedVoiceLeadingComposer exposed via require */
