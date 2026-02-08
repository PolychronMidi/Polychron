// Dependencies are required via `src/composers/index.js`

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
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('ScaleComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
    this.noteSet(scaleName,root);
  }
  /**
   * Sets scale and extracts notes.
   * @param {string} scaleName
   * @param {string} root
   */
  noteSet(scaleName,root) {
    const name = scaleName || '';
    const rt = root || '';
    const scaleKey = `${rt} ${name}`.trim();
    try {
      this.scale = t.Scale.get(scaleKey);
    } catch (e) {
      console.warn('ScaleComposer.noteSet: t.Scale.get threw for', scaleKey, e && e.stack ? e.stack : e);
      this.scale = null;
    }

    if (!this.scale || !Array.isArray(this.scale.notes) || this.scale.notes.length === 0) {
      console.warn(`ScaleComposer.noteSet: scale lookup failed for "${scaleKey}", falling back to C major`);
      try { this.scale = t.Scale.get('C major'); } catch (e) { this.scale = null; }
      if (!this.scale || !Array.isArray(this.scale.notes) || this.scale.notes.length === 0) {
        console.warn('ScaleComposer.noteSet: fallback scale lookup failed; using single-note fallback [C]');
        this.notes = ['C'];
        return;
      }
    }
    this.notes = this.scale.notes;
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

    let selectedNote;
    try {
      if (this.VoiceLeadingScore && typeof this.VoiceLeadingScore.selectNextNote === 'function') {
        selectedNote = this.VoiceLeadingScore.selectNextNote(this.voiceHistory || [], candidates, {});
      }
    } catch (e) { console.warn('ScaleComposer.selectNoteWithLeading failed, falling back to default choice:', e && e.stack ? e.stack : e); }

    if (typeof selectedNote === 'undefined') {
      selectedNote = candidates[Math.floor(candidates.length / 2)];
    }

    // Apply noise-based pitch variation via helper
    if (typeof this._noiseCallCount === 'undefined') this._noiseCallCount = 0;
    this._noiseCallCount++;
    const voiceId = this.root ? this.root.charCodeAt(0) : 60;
    return applyComposerPitchNoise(selectedNote, { voiceId, callCount: this._noiseCallCount });
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
