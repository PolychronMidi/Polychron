require('./MeasureComposer');
const { VoiceLeadingScore } = require('./voiceLeading');

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
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { /* swallow */ }
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
  }
  /** @returns {{note: number}[]} Mode notes */
  x=()=>this.getNotes();

  selectNoteWithLeading(candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates[0];
    try {
      if (this.voiceLeading && typeof this.voiceLeading.selectNextNote === 'function') {
        return this.voiceLeading.selectNextNote(this.voiceHistory || [], candidates, {});
      }
    } catch (e) { /* swallow */ }
    return candidates[Math.floor(candidates.length / 2)];
  }
}

RandomModeComposer = class RandomModeComposer extends ModeComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects mode and root from venue.js data */
  noteSet() {
    const randomMode=allModes[ri(allModes.length - 1)];
    const [root,modeName]=randomMode.split(' ');
    this.root=root;
    super.noteSet(modeName,root);
  }
  /** @returns {{note: number}[]} Random mode notes */
  x() { this.noteSet(); return super.x(); }
}

/* ModeComposer and RandomModeComposer exposed via require */
