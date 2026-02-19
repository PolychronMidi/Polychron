// QuartalComposer.js - Voicings built in perfect 4ths / 5ths
// Generates quartal (stacked P4) and quintal (stacked P5) sonorities from any scale.
// Unlike tertian (3rd-based) harmony, quartal voicings are ambiguous in function,
// creating open, modern, suspended textures (McCoy Tyner, Debussy, ambient).

QuartalComposer = class QuartalComposer extends MeasureComposer {
  /**
   * @param {string} scaleName - Scale to draw from (e.g., 'major', 'dorian')
   * @param {string} root - Root note (e.g., 'C', 'D')
   * @param {'quartal'|'quintal'|'mixed'} [voicingType='quartal'] - Interval stacking mode
   * @param {number} [stackSize=4] - Number of notes per voicing (2–6)
   */
  constructor(scaleName = 'major', root = 'C', voicingType = 'quartal', stackSize = 4) {
    super();
    this.root = root;
    this.voicingType = ['quartal', 'quintal', 'mixed'].includes(voicingType) ? voicingType : 'quartal';
    this.stackSize = clamp(m.round(stackSize), 2, 6);
    this.enableVoiceLeading(new VoiceLeadingScore());
    this.noteSet(scaleName, root);
  }

  /**
   * Set scale and extract notes for quartal stacking.
   * @param {string} scaleName
   * @param {string} root
   */
  noteSet(scaleName, root) {
    if (typeof scaleName !== 'string' || !scaleName) {
      throw new Error(`QuartalComposer.noteSet: scaleName must be non-empty string`);
    }
    if (typeof root !== 'string' || !root) {
      throw new Error(`QuartalComposer.noteSet: root must be non-empty string`);
    }
    this.root = root;

    const scale = t.Scale.get(`${root} ${scaleName}`);
    if (!scale || !Array.isArray(scale.notes) || scale.notes.length === 0) {
      throw new Error(`QuartalComposer.noteSet: scale "${root} ${scaleName}" not found`);
    }
    this.notes = scale.notes;
    this._scalePCs = scale.notes.map(n => t.Note.chroma(n)).filter(c => Number.isFinite(c));

    this.intervalOptions = {
      style: 'even',
      density: 0.6,
      minNotes: m.min(3, this.notes.length),
      maxNotes: this.notes.length,
      jitter: false,
    };
    this.voicingOptions = {
      minSemitones: 5,
    };
  }

  /**
   * Build quartal/quintal voicings from the scale.
   * Starts from a scale degree and stacks P4 (5 semitones) or P5 (7 semitones),
   * snapping each resulting pitch to the nearest scale tone for diatonic quartal voicings.
   * @param {number[]|null} [octaveRange]
   * @returns {{note: number}[]}
   */
  getNotes(octaveRange = null) {
    const baseNotes = super.getNotes(octaveRange);
    if (!Array.isArray(baseNotes) || baseNotes.length === 0) {
      throw new Error('QuartalComposer.getNotes: super.getNotes() returned empty');
    }

    // Pick a starting note from the base pool
    const startNote = baseNotes[ri(0, m.max(0, baseNotes.length - 1))];
    const startMidi = typeof startNote === 'number' ? startNote : (startNote && startNote.note) || 60;
    if (!Number.isFinite(startMidi)) throw new Error('QuartalComposer.getNotes: invalid start note');

    // Build a sorted set of scale MIDI notes across available octaves for snapping
    const scaleMidiSet = [];
    for (let oct = 2; oct <= 7; oct++) {
      for (const pc of this._scalePCs) {
        const midi = pc + oct * 12;
        if (midi >= 0 && midi <= 127) scaleMidiSet.push(midi);
      }
    }
    scaleMidiSet.sort((a, b) => a - b);

    /**
     * Snap a MIDI note to the nearest scale tone.
     * @param {number} midi
     * @returns {number}
     */
    const snapToScale = (midi) => {
      let closest = scaleMidiSet[0];
      let closestDist = m.abs(midi - closest);
      for (let i = 1; i < scaleMidiSet.length; i++) {
        const dist = m.abs(midi - scaleMidiSet[i]);
        if (dist < closestDist) {
          closest = scaleMidiSet[i];
          closestDist = dist;
        }
        if (dist > closestDist) break; // sorted, so we can stop
      }
      return closest;
    };

    // Build the stacked voicing
    const result = [];
    let current = startMidi;
    for (let i = 0; i < this.stackSize; i++) {
      const snapped = snapToScale(current);
      result.push({ note: clamp(snapped, 0, 127) });

      // Choose interval for next stack step
      let interval;
      if (this.voicingType === 'quartal') {
        interval = 5; // P4
      } else if (this.voicingType === 'quintal') {
        interval = 7; // P5
      } else {
        // Mixed: alternate or randomize
        interval = rf() < 0.5 ? 5 : 7;
      }
      current = snapped + interval;
    }

    return result;
  }

  x = () => this.getNotes();
}

RandomQuartalComposer = class RandomQuartalComposer extends QuartalComposer {
  constructor() {
    super();
    this.noteSet();
  }

  noteSet() {
    if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('RandomQuartalComposer.noteSet: allNotes not available');
    if (!Array.isArray(allScales) || allScales.length === 0) throw new Error('RandomQuartalComposer.noteSet: allScales not available');
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomScale = allScales[ri(allScales.length - 1)];
    const randomType = (['quartal', 'quintal', 'mixed'])[ri(2)];
    const randomStack = ri(3, 5);
    super.noteSet(randomScale, randomRoot);
    this.voicingType = randomType;
    this.stackSize = randomStack;
  }

  x() {
    this.noteSet();
    return super.x();
  }
}
