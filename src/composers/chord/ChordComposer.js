const V = validator.create('ChordComposer');
const chordComposerWarnedInvalidChordSymbols = new Set();
ChordComposer = class ChordComposer extends MeasureComposer {
  /**
   * @param {string[]} progression - Array of chord symbols, e.g., ['CM', 'Dm', 'Em']
   */
  constructor(progression) {
    super();
    V.assertArray(progression, 'progression');
    // enable basic voice-leading scorer to allow selectNoteWithLeading delegation
    this.enableVoiceLeading(new VoiceLeadingScore());
    this.noteSet(progression,'R');

    // Update harmonicContext with active chord set for type coherence
    if (this.progression && this.progression.length > 0) {
      try {
        const chordSymbols = this.progression.map(c => c.symbol);
        harmonicContext.set({ chords: chordSymbols });
      } catch (e) {
        // Fail-fast for context updates; let error bubble
        throw new Error(`ChordComposer: failed to update harmonicContext: ${e && e.message ? e.message : e}`);
      }
    }
  }

  /**
   * Returns voicing intent: weights chord tones (PCs in current chord) higher than non-chord tones.
   * @param {number[]} candidateNotes - Available MIDI notes
   * @returns {{ candidateWeights: { [note: number]: number } } | null}
   */
  getVoicingIntent(candidateNotes = []) {
    if (!Array.isArray(candidateNotes) || candidateNotes.length === 0) return null;
    if (!this.notes || this.notes.length === 0) return null;

    // Delegate to centralized helper (chord tones = weight 1, non-chord tones = weight 0)
    const candidateWeights = voiceLeadingCore.buildPCWeights(candidateNotes, this.notes, 1, 0);
    return { candidateWeights };
  }

  /**
   * Sets progression and validates chords.
   * @param {string[]} progression
   * @param {string} [direction='R'] - 'R' (right), 'L' (left), 'E' (either), '?' (random)
   */
  noteSet(progression,direction='R') {
    if (progression !== undefined) V.requireType(progression, 'array', 'progression');
    V.assertNonEmptyString(direction, 'direction');
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
        if (!chordComposerWarnedInvalidChordSymbols.has(asRaw)) {
          try { console.warn(`Acceptable warning: ChordComposer.noteSet: normalized chord symbol from "${asRaw}" -> "${normalized}"`); } catch (_logErr) { process.stderr.write('ChordComposer: logging failed: ' + (_logErr && _logErr.message ? _logErr.message : String(_logErr)) + '\n'); }
          chordComposerWarnedInvalidChordSymbols.add(asRaw);
        }
        return normalized;
      }

      // Case C: both raw and normalized are invalid -> real warning (not labeled acceptable)
      if (!chordComposerWarnedInvalidChordSymbols.has(asRaw)) {
        try { console.warn('Acceptable warning: ChordComposer.noteSet: invalid chord symbol "' + asRaw + '" (normalized -> "' + normalized + '")'); } catch (_logErr) { process.stderr.write('ChordComposer: logging failed: ' + (_logErr && _logErr.message ? _logErr.message : String(_logErr)) + '\n'); }
        chordComposerWarnedInvalidChordSymbols.add(asRaw);
      }
      return null;
    }).filter(Boolean);

    if (validatedProgression.length===0) { throw new Error('ChordComposer.noteSet: no valid chords');
    } else {
      this.progression=validatedProgression.map(t.Chord.get);
      this.currentChordIndex=this.currentChordIndex ?? 0;
      let next;
      switch (direction.toUpperCase()) {
        case 'R': next=1; break;
        case 'L': next=-1; break;
        case 'E': next=rf() < .5 ? 1 : -1; break;
        case '?': next=ri(-2,2); break;
        default: throw new Error(`ChordComposer.noteSet: invalid direction "${direction}"`);
      }
      const lastMeasure = (typeof this.ChordComposerLastMeasureCount === 'number') ? this.ChordComposerLastMeasureCount : measureCount;
      const measureAdvanced = measureCount > lastMeasure;
      const progressChord = measureAdvanced || rf() < 0.05;
      if (progressChord) { allNotesOff(subdivStartTime); }
      this.ChordComposerLastMeasureCount = measureCount;
      this.currentChordIndex+= progressChord ? next % (this.progression.length) : 0;
      this.currentChordIndex=(this.currentChordIndex+this.progression.length)%this.progression.length;
      this.notes=this.progression[this.currentChordIndex].notes;
      const preferIndices = [];
      if (this.notes.length >= 1) preferIndices.push(0);
      if (this.notes.length >= 3) preferIndices.push(2);
      if (this.notes.length >= 4) preferIndices.push(3);
      if (this.notes.length >= 5) preferIndices.push(4);

      this.intervalOptions = {
        style: 'even',
        density: 0.85,
        minNotes: m.min(3, this.notes.length),
        maxNotes: this.notes.length,
        preferIndices,
        jitter: false,
      };

      const runtimeProfile = (this.runtimeProfile && typeof this.runtimeProfile === 'object') ? this.runtimeProfile : null;
      if (runtimeProfile && Number.isFinite(Number(runtimeProfile.chordVoices))) {
        const boundedVoices = m.max(1, m.min(this.notes.length, m.round(Number(runtimeProfile.chordVoices))));
        this.intervalOptions.minNotes = boundedVoices;
        this.intervalOptions.maxNotes = boundedVoices;
      }
      if (runtimeProfile && Number.isFinite(Number(runtimeProfile.inversionPreference))) {
        const sourceCount = this.notes.length;
        if (sourceCount > 0) {
          const inversion = ((m.round(Number(runtimeProfile.inversionPreference)) % sourceCount) + sourceCount) % sourceCount;
          const nextPrefer = Array.isArray(this.intervalOptions.preferIndices) ? this.intervalOptions.preferIndices.slice() : [];
          if (!nextPrefer.includes(inversion)) {
            this.intervalOptions.preferIndices = [inversion, ...nextPrefer];
          }
        }
      }

      this.voicingOptions = {
        minSemitones: 3,
      };

      const currentChord = this.progression[this.currentChordIndex];
      if (!currentChord) {
        throw new Error('ChordComposer.noteSet: current chord missing for harmonicContext update');
      }
      const chordSymbols = this.progression.map(c => c.symbol);
      const scale = Array.isArray(currentChord.notes) ? currentChord.notes : [];
      if (!scale.length) {
        throw new Error(`ChordComposer.noteSet: current chord has no notes for scale (${currentChord.symbol})`);
      }
      const key = currentChord.tonic;
      V.assertNonEmptyString(key, 'key');
        const quality = currentChord.type || 'unknown';
        harmonicContext.set({ key, quality, scale, chords: chordSymbols });
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
    V.assertArray(allChords, 'allChords');
    if (allChords.length === 0) throw new Error('RandomChordComposer.noteSet: allChords not available');
    const progressionLength=ri(2,5);
    const randomProgression=[];
    for (let i=0; i < progressionLength; i++) {
      const randomChord=allChords[ri(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    super.noteSet(randomProgression);
  }
}
