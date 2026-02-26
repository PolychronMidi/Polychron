const V = validator.create('PentatonicComposer');
PentatonicComposer = class PentatonicComposer extends MeasureComposer {
  constructor(root = 'C', type = 'major') {
    super();
    V.assertNonEmptyString(root, 'root');
    V.assertNonEmptyString(type, 'type');
    this.root = root;
    this.type = type;
    this.enableVoiceLeading(new VoiceLeadingScore());
    this.noteSet(root, type);
  }

  noteSet(root, type = 'major') {
    this.root = root;
    this.type = type.toLowerCase();

    const scaleName = this.type === 'minor' ? 'minor pentatonic' : 'major pentatonic';
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;

    if (!this.notes || this.notes.length === 0) {
      throw new Error(`PentatonicComposer.noteSet: unable to create pentatonic scale for root=${root} type=${type}`);
    }
    this.intervalOptions = {
      style: 'sparse',
      density: 0.4,
      minNotes: m.min(3, this.notes.length),
      maxNotes: this.notes.length,
      jitter: true,
    };
    this.voicingOptions = {
      minSemitones: 4,
    };
  }

  getNotes(octaveRange = null) {
    // Return full note pool for centralized voice selection
    const notes = super.getNotes(octaveRange);
    if (!Array.isArray(notes) || notes.length === 0) {
      throw new Error('PentatonicComposer.getNotes: expected super.getNotes() to return a non-empty array');
    }
    return notes;
  }

  x = () => this.getNotes();
}

RandomPentatonicComposer = class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    super();
    this.noteSet();
  }

  noteSet() {
    if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('RandomPentatonicComposer.noteSet: allNotes not available');
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomType = rf() < 0.5 ? 'major' : 'minor';
    super.noteSet(randomRoot, randomType);
  }

  x() {
    this.noteSet();
    return super.x();
  }
}
