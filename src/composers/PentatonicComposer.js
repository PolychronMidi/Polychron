require('./MeasureComposer');
const { VoiceLeadingScore } = require('./VoiceLeadingScore');

PentatonicComposer = class PentatonicComposer extends MeasureComposer {
  constructor(root = 'C', type = 'major') {
    super();
    this.root = root;
    this.type = type;
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { /* swallow */ }
    this.noteSet(root, type);
  }

  noteSet(root, type = 'major') {
    this.root = root;
    this.type = type.toLowerCase();

    const scaleName = this.type === 'minor' ? 'minor pentatonic' : 'major pentatonic';
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;

    if (!this.notes || this.notes.length === 0) {
      console.warn(`PentatonicComposer.noteSet produced empty notes for root=${root} type=${type}. Falling back to ${this.type} pentatonic scale.`);
      this.root = allNotes[ri(allNotes.length - 1)];
      this.type = rf() < 0.5 ? 'major' : 'minor';
      const fallbackScaleName = this.type === 'minor' ? 'minor pentatonic' : 'major pentatonic';
      this.scale = t.Scale.get(`${this.root} ${fallbackScaleName}`);
      this.notes = this.scale.notes;
    }
  }

  getNotes(octaveRange = null) {
    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const voices = this.getVoices();
    const uniqueNotes = new Set();
    const result = [];

    const openIntervals = [0, 2, 4];

    for (let i = 0; i < voices && i < this.notes.length; i++) {
      const intervalIndex = openIntervals[i % openIntervals.length];
      const noteIndex = intervalIndex % this.notes.length;
      let octave = ri(minOctave, maxOctave);

      if (i > 0 && voices > 2) {
        octave = minOctave + Math.floor(i * (maxOctave - minOctave) / (voices - 1));
      }

      let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;

      let attempts = 0;
      while (uniqueNotes.has(note) && attempts < 12) {
        octave = ri(minOctave, maxOctave);
        note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        attempts++;
      }

      if (!uniqueNotes.has(note)) {
        uniqueNotes.add(note);
        result.push({ note });
      }
    }

    return result;
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

/* PentatonicComposer and RandomPentatonicComposer exposed via require */
