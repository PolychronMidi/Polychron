// Dependencies are required via `src/composers/index.js`

PentatonicComposer = class PentatonicComposer extends MeasureComposer {
  constructor(root = 'C', type = 'major') {
    super();
    this.root = root;
    this.type = type;
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('PentatonicComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
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
  }

  getNotes(octaveRange = null) {
    // Return full note pool for centralized voice selection
    return super.getNotes(octaveRange);
  }

  x = () => this.getNotes();
}

RandomPentatonicComposer = class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    super();
    this.noteSet();
  }

  noteSet() {
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomType = rf() < 0.5 ? 'major' : 'minor';
    super.noteSet(randomRoot, randomType);
  }

  x() {
    this.noteSet();
    return super.x();
  }
}
