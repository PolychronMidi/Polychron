// Dependencies are required via `src/composers/index.js`

VoiceLeadingComposer = class VoiceLeadingComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', commonToneWeight = 0.7, contraryMotionPreference = 0.4) {
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    this.previousNotes = [];
    // enable voice-leading scorer for pick delegation with composer-provided tunables
    try { this.enableVoiceLeading(new VoiceLeadingScore({ commonToneWeight: clamp(commonToneWeight, 0, 1), contraryMotionPreference: clamp(contraryMotionPreference, 0, 1) })); } catch (e) { console.warn('VoiceLeadingComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
  }

  getNotes(octaveRange) {
    const baseNotes = super.getNotes(octaveRange);
    if (!baseNotes || baseNotes.length === 0) { console.warn('VoiceLeadingComposer.getNotes: base notes missing or empty'); return baseNotes; }
    if (this.previousNotes.length === 0) {
      this.previousNotes = baseNotes;
      return baseNotes;
    }
    const optimizedNotes = this.optimizeVoiceLeading(baseNotes);
    this.previousNotes = optimizedNotes;
    return optimizedNotes;
  }

  /**
   * Optimize each voice by delegating candidate scoring to VoiceLeadingScore.
   * For each voice, build a small candidate set around the proposed note (including
   * the previous note) and pick the lowest-cost choice given the voice context.
   * This centralizes cost logic in VoiceLeadingScore and makes the composer
   * behavior more extensible and testable.
   * @param {{note: number}[]} newNotes
   * @returns {{note: number}[]} optimized notes
   */
  optimizeVoiceLeading(newNotes) {
    if (!this.VoiceLeadingScore) return newNotes;

    const result = [];
    const prevByVoice = [...this.previousNotes];

    const registerForIndex = (idx) => {
      switch (idx) {
        case 0: return 'soprano';
        case 1: return 'alto';
        case 2: return 'tenor';
        case 3: return 'bass';
        default: return 'soprano';
      }
    };

    for (let voiceIdx = 0; voiceIdx < newNotes.length && voiceIdx < prevByVoice.length; voiceIdx++) {
      const newNote = newNotes[voiceIdx];
      const prevNote = prevByVoice[voiceIdx];
      if (!newNote || !prevNote) {
        result.push(newNote || prevNote);
        continue;
      }

      // Build a small, local candidate pool: the proposed note, the previous note
      // (to prefer continuity), and small nearby offsets to allow stepwise motion.
      const base = newNote.note;
      const candidates = new Set();
      candidates.add(base);
      candidates.add(prevNote.note);
      for (const d of [-4, -2, -1, 1, 2, 4]) {
        const v = clamp(base + d, 0, 127);
        candidates.add(v);
      }

      // Convert set -> array and score via VoiceLeadingScore
      const candidateArr = Array.from(candidates);
      const lastNotesContext = this.previousNotes.map(n => n.note);
      const register = registerForIndex(voiceIdx);

      try {
        const chosen = this.VoiceLeadingScore.selectNextNote(lastNotesContext, candidateArr, { register });
        result.push({ ...newNote, note: chosen });
      } catch (e) { console.warn('VoiceLeadingScore.selectNextNote failed, falling back:', e && e.stack ? e.stack : e);
        // Fallback to previous deterministic logic: prefer prev when included
        if (candidateArr.includes(prevNote.note)) result.push({ ...newNote, note: prevNote.note });
        else result.push({ ...newNote });
      }
    }

    return result;
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

  /**
   * Select a single candidate note respecting internal voice-leading memory.
   * Used by `MotifSpreader.getBeatMotifPicks` when this composer is attached
   * as `layer.measureComposer` so stage can prefer smoother motion.
   * @param {number[]} candidates - array of MIDI note numbers
   * @returns {number} chosen note
   */
  selectNoteWithLeading(candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) { console.warn('VoiceLeadingComposer.selectNoteWithLeading: empty candidates provided — returning default'); return candidates[0]; }
    // Prefer exact previous note if available for deterministic behavior
    if (Array.isArray(this.previousNotes) && this.previousNotes.length > 0) {
      const prev = this.previousNotes[0].note;
      if (candidates.includes(prev)) return prev;
    }
    try {
      if (this.VoiceLeadingScore && typeof this.VoiceLeadingScore.selectNextNote === 'function') {
        const lastNotes = Array.isArray(this.previousNotes) ? this.previousNotes.map(n => n.note) : (this.voiceHistory || []);
        return this.VoiceLeadingScore.selectNextNote(lastNotes, candidates, { commonToneWeight: this.commonToneWeight });
      }
    } catch (e) { console.warn('VoiceLeading selectNote failed, falling back to deterministic choice:', e && e.stack ? e.stack : e); }
    return candidates[0];
  }
}
