require('./ProgressionGenerator');
require('./ChordComposer');
require('./VoiceLeadingScore');

ModalInterchangeComposer = class ModalInterchangeComposer extends ChordComposer {
  constructor(key = 'C', primaryMode = 'major', borrowProbability = 0.25) {
    const generator = new ProgressionGenerator(key, primaryMode);
    const progressionChords = generator.random();
    super(progressionChords);
    // enable voice-leading delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('ModalInterchangeComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
    this.key = key;
    this.primaryMode = primaryMode;
    this.borrowProbability = clamp(borrowProbability, 0, 1);
    this.generator = generator;
    this.borrowModes = primaryMode === 'major' ? ['minor', 'dorian', 'mixolydian', 'lydian'] : ['major', 'dorian', 'phrygian', 'locrian'];
  }

  borrowChord() {
    const modeIndex = ri(this.borrowModes.length - 1);
    const borrowMode = this.borrowModes[modeIndex];
    const borrowScale = t.Scale.get(`${this.key} ${borrowMode}`);
    if (!borrowScale.notes || borrowScale.notes.length === 0) {
      return this.progression[this.currentChordIndex].symbol;
    }
    const borrowPatterns = {
      major: { minor: ['iv', 'bVI', 'bVII'], dorian: ['ii', 'IV'], mixolydian: ['bVII'], lydian: ['#IV'] },
      minor: { major: ['IV', 'V', 'I'], dorian: ['IV', 'vi'], phrygian: ['bII'], locrian: ['v'] }
    };
    const patterns = borrowPatterns[this.primaryMode]?.[borrowMode];
    if (!patterns || patterns.length === 0) return this.progression[this.currentChordIndex].symbol;
    const borrowGenerator = new ProgressionGenerator(this.key, borrowMode);
    const romanNumeral = patterns[ri(patterns.length - 1)];
    const borrowedChord = borrowGenerator.romanToChord(romanNumeral);
    return borrowedChord || this.progression[this.currentChordIndex].symbol;
  }

  noteSet(progression, direction = 'R') {
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      if (firstItem === null) { console.warn('ModalInterchangeComposer.noteSet: progression first item is null — skipping'); return; }
      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;
      if (isStringArray || isChordArray) {
        super.noteSet(progression, direction);
        return;
      }
    }

    if (!this.progression || this.progression.length === 0) { console.warn('ModalInterchangeComposer.noteSet: no progression defined — skipping'); return; }
    if (rf() < this.borrowProbability) {
      const borrowedChord = this.borrowChord();
      const modifiedProgression = [...this.progression.map(c => c.symbol)];
      modifiedProgression[this.currentChordIndex % modifiedProgression.length] = borrowedChord;
      super.noteSet(modifiedProgression, direction);
    } else {
      super.noteSet(this.progression.map(c => c.symbol), direction);
    }
  }

  x() {
    this.noteSet();
    return super.x();
  }
}
