require('./MeasureComposer');
require('./VoiceLeadingScore');

/**
 * Composes notes from a specific scale.
 * @extends MeasureComposer
 */
ScaleComposer = class ScaleComposer extends MeasureComposer {
  /**
   * @param {string} scaleName - e.g., 'major', 'minor'
   * @param {string} root - e.g., 'C', 'D#'
   */
  constructor(scaleName,root) {
    super();
    this.root=root;
    // enable voice-leading by default for selection delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { /* swallow */ }
    this.noteSet(scaleName,root);
  }
  /**
   * Sets scale and extracts notes.
   * @param {string} scaleName
   * @param {string} root
   */
  noteSet(scaleName,root) {
    this.scale=t.Scale.get(`${root} ${scaleName}`);
    this.notes=this.scale.notes;
  }
  /** @returns {{note: number}[]} Scale notes */
  x=()=>this.getNotes();

  /**
   * Delegate selection to VoiceLeadingScore when available
   * @param {number[]} candidates
   * @returns {number}
   */
  selectNoteWithLeading(candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates[0];
    try {
      if (this.VoiceLeadingScore && typeof this.VoiceLeadingScore.selectNextNote === 'function') {
        return this.VoiceLeadingScore.selectNextNote(this.voiceHistory || [], candidates, {});
      }
    } catch (e) { /* swallow */ }
    return candidates[Math.floor(candidates.length / 2)];
  }
}

RandomScaleComposer = class RandomScaleComposer extends ScaleComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects scale and root from venue.js data */
  noteSet() {
    const randomScale=allScales[ri(allScales.length - 1)];
    const randomRoot=allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale,randomRoot);
  }
  /** @returns {{note: number}[]} Random scale notes */
  x() { this.noteSet(); return super.x(); }
}
