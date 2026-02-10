// Dependencies are required via `src/composers/index.js`

/**
 * Composes notes from a specific mode.
 * @extends MeasureComposer
 */
ModeComposer = class ModeComposer extends MeasureComposer {
  /**
   * @param {string} modeName - e.g., 'ionian', 'aeolian'
   * @param {string} root - e.g., 'A', 'C'
   */
  constructor(modeName,root) {
    super();
    this.root=root;
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('ModeComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
    this.noteSet(modeName,root);
  }
  /**
   * Sets mode and extracts notes.
   * @param {string} modeName
   * @param {string} root
   */
  noteSet(modeName,root) {
    this.mode = t.Mode.get(modeName);
    this.notes = t.Mode.notes(this.mode, root);
    if (!Array.isArray(this.notes) || this.notes.length === 0) {
      throw new Error(`ModeComposer.noteSet produced empty notes for mode=${modeName} root=${root}`);
    }
    this.intervalOptions = {
      style: 'rising',
      density: 0.55,
      minNotes: m.min(3, this.notes.length),
      maxNotes: this.notes.length,
      jitter: true,
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
    if (!Array.isArray(allModes) || allModes.length === 0) throw new Error('RandomModeComposer.noteSet: allModes not available');
    const randomMode=allModes[ri(allModes.length - 1)];
    const [root,modeName]=randomMode.split(' ');
    this.root=root;
    super.noteSet(modeName,root);
  }
  /** @returns {{note: number}[]} Random mode notes */
  x() { this.noteSet(); return super.x(); }
}
