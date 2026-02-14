/**
 * Generates chord progressions with modal borrowing from parallel modes.
 *
 * DISTINCTION FROM ModeComposer:
 * - ModalInterchangeComposer: generates chord progressions that BORROW from parallel modes (harmonic/chord-based)
 * - ModeComposer: selects ONE mode and extracts its scale notes (melodic/scale-based)
 *
 * Use ModalInterchangeComposer for harmonic modal color (e.g., borrowing iv from parallel minor in a major key).
 * Use ModeComposer for modal melodies (e.g., playing in dorian mode).
 *
 * @extends ChordComposer
 */
ModalInterchangeComposer = class ModalInterchangeComposer extends ChordComposer {
  constructor(key = 'C', primaryMode = 'major', borrowProbability = 0.25, opts = {}) {
    const generator = new ProgressionGenerator(key, primaryMode);
    const progressionChords = generator.random({
      source: 'modalInterchange',
      useCorpusHarmonicPriors: opts && opts.useCorpusHarmonicPriors === true,
      corpusHarmonicStrength: opts && opts.corpusHarmonicStrength
    });
    super(progressionChords);
    // enable voice-leading delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { throw e; }
    this.key = key;
    this.primaryMode = primaryMode;
    this.borrowProbability = clamp(borrowProbability, 0, 1);
    this.generator = generator;

    // Use centralized borrow mode configuration
    const borrowConfig = (typeof MODAL_BORROWING !== 'undefined' && MODAL_BORROWING[primaryMode])
      ? MODAL_BORROWING[primaryMode]
      : (primaryMode === 'major' ? ['minor', 'dorian', 'mixolydian', 'lydian'] : ['major', 'dorian', 'phrygian', 'locrian']);
    this.borrowModes = borrowConfig;
    this._lastBorrowed = null;
  }

  borrowChord() {
    const modeIndex = ri(this.borrowModes.length - 1);
    const borrowMode = this.borrowModes[modeIndex];
    const borrowScale = t.Scale.get(`${this.key} ${borrowMode}`);
    if (!borrowScale || !Array.isArray(borrowScale.notes) || borrowScale.notes.length === 0) {
      throw new Error(`ModalInterchangeComposer.borrowChord: borrow scale ${borrowMode} has no notes`);
    }
    const borrowPatterns = {
      major: { minor: ['iv', 'bVI', 'bVII'], dorian: ['ii', 'IV'], mixolydian: ['bVII'], lydian: ['#IV'] },
      minor: { major: ['IV', 'V', 'I'], dorian: ['IV', 'vi'], phrygian: ['bII'], locrian: ['v'] }
    };
    const patterns = borrowPatterns[this.primaryMode]?.[borrowMode];
    if (!patterns || patterns.length === 0) {
      throw new Error(`ModalInterchangeComposer.borrowChord: no borrow patterns for mode ${borrowMode}`);
    }
    const borrowGenerator = new ProgressionGenerator(this.key, borrowMode);
    const romanNumeral = patterns[ri(patterns.length - 1)];
    const borrowedChord = borrowGenerator.romanToChord(romanNumeral);
    if (!borrowedChord) {
      throw new Error(`ModalInterchangeComposer.borrowChord: romanToChord returned null for ${romanNumeral}`);
    }
    return borrowedChord;
  }

  noteSet(progression, direction = 'R') {
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      if (firstItem === null) { throw new Error('ModalInterchangeComposer.noteSet: progression first item is null'); }
      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;
      if (isStringArray || isChordArray) {
        super.noteSet(progression, direction);
        return;
      }
    }

    if (!this.progression || this.progression.length === 0) { throw new Error('ModalInterchangeComposer.noteSet: no progression defined'); }
    if (rf() < this.borrowProbability) {
      const borrowedChord = this.borrowChord();
      const modifiedProgression = [...this.progression.map(c => c.symbol)];
      modifiedProgression[this.currentChordIndex % modifiedProgression.length] = borrowedChord;
      super.noteSet(modifiedProgression, direction);
      this._lastBorrowed = borrowedChord;
    } else {
      super.noteSet(this.progression.map(c => c.symbol), direction);
      this._lastBorrowed = null;
    }
  }

  /**
   * Boosts chord-tone weights when a borrowed chord is active.
   * Emphasizes modal interchange tones by 1.5x to make color changes audible.
   * @param {number[]} candidateNotes - Available MIDI notes
   * @returns {{ candidateWeights: { [note: number]: number } } | null}
   */
  getVoicingIntent(candidateNotes = []) {
    const base = super.getVoicingIntent(candidateNotes);
    if (!base || !base.candidateWeights) return base;

    // Emphasize borrowed chord tones (modal color)
    if (this._lastBorrowed) {
      for (const note of candidateNotes) {
        const key = String(note);
        const existing = typeof base.candidateWeights[key] === 'number' ? base.candidateWeights[key] : 0;
        if (existing > 0) base.candidateWeights[key] = existing * 1.5;
      }
    }

    return base;
  }

  x() {
    this.noteSet();
    return super.x();
  }
}
