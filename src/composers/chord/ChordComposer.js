// Dependencies are required via `src/composers/index.js`

const _warnedInvalidChordSymbols = new Set();

ChordComposer = class ChordComposer extends MeasureComposer {
  /**
   * @param {string[]} progression - Array of chord symbols, e.g., ['CM', 'Dm', 'Em']
   */
  constructor(progression) {
    super();
    // enable basic voice-leading scorer to allow selectNoteWithLeading delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('ChordComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
    this.noteSet(progression,'R');
  }

  getVoicingIntent(candidateNotes = []) {
    if (!Array.isArray(candidateNotes) || candidateNotes.length === 0) return null;
    if (!this.notes || this.notes.length === 0) return null;

    const chordPCs = new Set();
    for (const noteName of this.notes) {
      const chroma = t.Note.chroma(noteName);
      if (typeof chroma === 'number' && Number.isFinite(chroma)) {
        chordPCs.add(((chroma % 12) + 12) % 12);
      }
    }

    if (chordPCs.size === 0) return null;

    const candidateWeights = {};
    for (const note of candidateNotes) {
      const pc = ((note % 12) + 12) % 12;
      candidateWeights[note] = chordPCs.has(pc) ? 1 : 0;
    }

    return { candidateWeights };
  }

  /**
   * Sets progression and validates chords.
   * @param {string[]} progression
   * @param {string} [direction='R'] - 'R' (right), 'L' (left), 'E' (either), '?' (random)
   */
  noteSet(progression,direction='R') {
    const arr = Array.isArray(progression) ? progression : [];
    const validatedProgression = arr.map(raw => {
      const asRaw = String(raw);
      const normalized = normalizeChordSymbol(raw);
      const chordRaw = t.Chord.get(asRaw);
      const chordNorm = t.Chord.get(normalized);

      // Case A: raw string is valid => accept quietly
      if (!chordRaw.empty) return normalized;

      // Case B: raw invalid but normalization produced a valid chord -> acceptable
      if (chordRaw.empty && !chordNorm.empty) {
        if (!_warnedInvalidChordSymbols.has(asRaw)) {
          try { console.warn(`Acceptable warning: ChordComposer.noteSet: normalized chord symbol from "${asRaw}" -> "${normalized}"`); } catch (e) { /* swallow logging errors */ }
          _warnedInvalidChordSymbols.add(asRaw);
        }
        return normalized;
      }

      // Case C: both raw and normalized are invalid -> real warning (not labeled acceptable)
      if (!_warnedInvalidChordSymbols.has(asRaw)) {
        try { console.warn(`ChordComposer.noteSet: invalid chord symbol "${asRaw}" (normalized -> "${normalized}")`); } catch (e) { /* swallow */ }
        _warnedInvalidChordSymbols.add(asRaw);
      }
      try { if (typeof writeDebugFile === 'function') writeDebugFile('composers.ndjson', { tag: 'invalid-chord', chordSymbol: asRaw }); } catch (e) { /* swallow */ }
      return null;
    }).filter(Boolean);

    if (validatedProgression.length===0) { throw new Error('ChordComposer.noteSet: no valid chords');
    } else {
      this.progression=validatedProgression.map(t.Chord.get);
      this.currentChordIndex=this.currentChordIndex || 0;
      let next;
      switch (direction.toUpperCase()) {
        case 'R': next=1; break;
        case 'L': next=-1; break;
        case 'E': next=rf() < .5 ? 1 : -1; break;
        case '?': next=ri(-2,2); break;
        default: console.warn(`ChordComposer.noteSet: invalid direction "${direction}", defaulting to right`); next=1;
      }
      let startingMeasure=measureCount;
      let progressChord=measureCount>startingMeasure || rf()<.05;
      if (progressChord && typeof subdivStart !== 'undefined') { allNotesOff(subdivStart); startingMeasure=measureCount; }
      this.currentChordIndex+= progressChord ? next % (this.progression.length) : 0;
      this.currentChordIndex=(this.currentChordIndex+this.progression.length)%this.progression.length;
      this.notes=this.progression[this.currentChordIndex].notes;
    }
  }
  /** @returns {{note: number}[]} Chord notes */
  x=()=>this.getNotes();
}

RandomChordComposer = class RandomChordComposer extends ChordComposer {
  constructor() {
    super([]);
    this.noteSet();
  }
  /** Generates 2-5 random chords */
  noteSet() {
    const progressionLength=ri(2,5);
    const randomProgression=[];
    for (let i=0; i < progressionLength; i++) {
      const randomChord=allChords[ri(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    super.noteSet(randomProgression);
  }
}
