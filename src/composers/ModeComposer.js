const V = validator.create('ModeComposer');
/**
 * Composes notes from a specific mode (single static mode selection).
 *
 * DISTINCTION FROM ModalInterchangeComposer:
 * - ModeComposer: selects ONE mode and extracts its scale notes (melodic/scale-based)
 * - ModalInterchangeComposer: generates chord progressions that BORROW from parallel modes (harmonic/chord-based)
 *
 * Use ModeComposer for modal melodies (e.g., "play in dorian").
 * Use ModalInterchangeComposer for harmonic modal borrowing (e.g., "I-iv-V where iv is borrowed from parallel minor").
 *
 * @extends MeasureComposer
 */
ModeComposer = class ModeComposer extends MeasureComposer {
  /**
   * @param {string} modeName - e.g., 'ionian', 'aeolian'
   * @param {string} root - e.g., 'A', 'C'
   */
  constructor(modeName,root) {
    super();
    V.assertNonEmptyString(modeName, 'modeName');
    V.assertNonEmptyString(root, 'root');
    this.root=root;
    this.enableVoiceLeading(new VoiceLeadingScore());
    this.noteSet(modeName,root);
  }
  /**
   * Sets mode and extracts notes.
   * @param {string} modeName - Mode name (e.g., 'ionian', 'dorian', 'mixolydian')
   * @param {string} root - Root note (e.g., 'C', 'D#')
   */
  noteSet(modeName,root) {
    V.assertNonEmptyString(modeName, 'modeName');
    V.assertNonEmptyString(root, 'root');

    this.mode = t.Mode.get(modeName);
    if (!this.mode) {
      throw new Error(`ModeComposer.noteSet: t.Mode.get returned invalid mode for "${modeName}"`);
    }

    this.notes = t.Mode.notes(this.mode, root);
    V.assertArray(this.notes, 'this.notes');
    if (this.notes.length === 0) {
      throw new Error(`ModeComposer.noteSet: mode="${modeName}" root="${root}" produced empty notes`);
    }
    this.intervalOptions = {
      style: 'rising',
      density: 0.55,
      minNotes: m.min(3, this.notes.length),
      maxNotes: this.notes.length,
      jitter: true,
    };
    this.voicingOptions = {
      minSemitones: 4,
    };
  }
  /** @returns {{note: number}[]} Mode notes */
  x=()=>this.getNotes();
}

RandomModeComposer = class RandomModeComposer extends ModeComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects mode and root from venue.js data */
  noteSet() {
    V.assertArray(allModes, 'allModes');
    if (allModes.length === 0) throw new Error('RandomModeComposer.noteSet: allModes not available');
    const randomMode=allModes[ri(allModes.length - 1)];
    const [root,modeName]=randomMode.split(' ');
    this.root=root;
    super.noteSet(modeName,root);
  }
  /** @returns {{note: number}[]} Random mode notes */
  x() { this.noteSet(); return super.x(); }
}
