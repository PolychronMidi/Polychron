// BluesComposer.js - Idiomatic blues scale composition with weighted blue-note injection
// Extends PentatonicComposer with chromatic approach tones (b3, b5, b7),
// call-and-response phrase shaping, and ghost note probability.

const V = validator.create('BluesComposer');

BluesComposer = class BluesComposer extends MeasureComposer {
  /**
   * @param {string} root - Root note (e.g., 'C', 'A')
   * @param {'major'|'minor'} type - Blues tonality
   * @param {number} [blueNoteProb=0.35] - Probability of injecting a blue note as passing tone
   */
  constructor(root = 'C', type = 'minor', blueNoteProb = 0.35) {
    super();
    this.root = root;
    this.type = type;
    this.blueNoteProb = clamp(blueNoteProb, 0, 1);
    this._phraseCount = 0;
    this.enableVoiceLeading(new VoiceLeadingScore());
    this.noteSet(root, type);
  }

  /**
   * Build the blues pitch set: pentatonic base + weighted blue notes.
   * @param {string} root
   * @param {'major'|'minor'} [type='minor']
   */
  noteSet(root, type = 'minor') {
    this.root = root;
    this.type = /** @type {'major'|'minor'} */ (type.toLowerCase());

    // Base pentatonic scale (the backbone)
    const pentatonicName = this.type === 'major' ? 'major pentatonic' : 'minor pentatonic';
    const pentatonic = t.Scale.get(`${root} ${pentatonicName}`);
    V.assertArray(pentatonic.notes, 'pentatonic.notes', true);

    // Full blues scale (includes the blue note - b5 for minor, b3 for major)
    const bluesScale = t.Scale.get(`${root} blues`);
    const bluesNotes = (bluesScale && Array.isArray(bluesScale.notes) && bluesScale.notes.length > 0)
      ? bluesScale.notes
      : pentatonic.notes;

    // Identify blue notes (notes in blues scale but not in pentatonic)
    const pentatonicSet = new Set(pentatonic.notes);
    this._blueNotes = bluesNotes.filter(n => !pentatonicSet.has(n));

    // Use the full blues scale as the note pool
    this.notes = bluesNotes;

    this.intervalOptions = {
      style: 'sparse',
      density: 0.5,
      minNotes: m.min(3, this.notes.length),
      maxNotes: this.notes.length,
      jitter: true,
    };
    this.voicingOptions = {
      minSemitones: 3,
    };
  }

  /**
   * Get notes with idiomatic blues behavior:
   * - Call-and-response: odd phrases are "calls" (ascending energy),
   *   even phrases are "responses" (descending resolution)
   * - Blue note weighting: chromatic approach tones injected probabilistically
   * @param {number[]|null} [octaveRange]
   * @returns {{note: number}[]}
   */
  getNotes(octaveRange = null) {
    const baseNotes = super.getNotes(octaveRange);
    V.assertArray(baseNotes, 'baseNotes', true);

    this._phraseCount++;
    const isResponse = this._phraseCount % 2 === 0;

    // Sort notes for directional shaping
    const sorted = [...baseNotes].sort((a, b) => {
      const aN = typeof a === 'number' ? a : BluesComposer._V.requireFinite(a && a.note, 'BluesComposer.getNotes.sortEntry.note');
      const bN = typeof b === 'number' ? b : BluesComposer._V.requireFinite(b && b.note, 'BluesComposer.getNotes.sortEntry.note');
      return aN - bN;
    });

    // Call-and-response: responses reverse (descend)
    const shaped = isResponse ? sorted.reverse() : sorted;

    // Blue note injection: probabilistically add chromatic approach tones
    if (this._blueNotes.length > 0 && rf() < this.blueNoteProb) {
      const bluePC = this._blueNotes[ri(this._blueNotes.length - 1)];
      const blueMidi = t.Note.midi(`${bluePC}4`);
      if (Number.isFinite(blueMidi)) {
        // Insert blue note before a random position (chromatic approach)
        const insertIdx = ri(0, m.max(0, shaped.length - 1));
        const blueEntry = { note: blueMidi };
        shaped.splice(insertIdx, 0, blueEntry);
      }
    }

    // Ghost notes: quiet grace notes at low velocity (marked via _ghost flag)
    const result = shaped.map(n => {
      const note = typeof n === 'number' ? n : (n && typeof n.note === 'number' ? n.note : null);
      BluesComposer._V.requireFinite(note, 'output note');
      if (rf() < this.blueNoteProb * 0.3) {
        // Ghost note: shift by 1 semitone as grace
        const ghostNote = note + (rf() < 0.5 ? -1 : 1);
        return { note: clamp(ghostNote, 0, 127), _ghost: true };
      }
      return typeof n === 'number' ? { note: n } : n;
    });

    return result;
  }

  x = () => this.getNotes();
}

RandomBluesComposer = class RandomBluesComposer extends BluesComposer {
  constructor() {
    super();
    this.noteSet();
  }

  noteSet() {
    V.assertArray(allNotes, 'allNotes', true);
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomType = rf() < 0.5 ? 'major' : 'minor';
    super.noteSet(randomRoot, randomType);
  }

  x() {
    this.noteSet();
    return super.x();
  }
}
