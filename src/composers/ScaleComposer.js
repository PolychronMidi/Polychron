const V = validator.create('ScaleComposer');
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
    V.assertNonEmptyString(scaleName, 'scaleName');
    V.assertNonEmptyString(root, 'root');
    this.root=root;
    // enable voice-leading by default for selection delegation
    this.enableVoiceLeading(new VoiceLeadingScore());
    this.noteSet(scaleName,root);
  }
  /**
   * Sets scale and extracts notes.
   * @param {string} scaleName
   * @param {string} root
   */
  noteSet(scaleName, root) {
    if (scaleName !== undefined) V.requireType(scaleName, 'string', 'scaleName');
    if (root !== undefined) V.requireType(root, 'string', 'root');
    const name = scaleName ?? '';
    const rt = root ?? '';
    const scaleKey = `${rt} ${name}`.trim();
    try {
      this.scale = t.Scale.get(scaleKey);
    } catch (e) {
      throw new Error(`ScaleComposer.noteSet: t.Scale.get threw for ${scaleKey}: ${e && e.stack ? e.stack : e}`);
    }

    if (!this.scale) {
      throw new Error(`ScaleComposer.noteSet: scale lookup failed for "${scaleKey}" and no fallback available`);
    }
    V.assertArray(this.scale.notes, 'this.scale.notes');
    if (this.scale.notes.length === 0) {
      throw new Error(`ScaleComposer.noteSet: scale lookup failed for "${scaleKey}" and no fallback available`);
    }
    this.notes = this.scale.notes;
    this.intervalOptions = {
      style: 'rising',
      density: 0.6,
      minNotes: m.min(3, this.notes.length),
      maxNotes: this.notes.length,
      jitter: true,
    };
    this.voicingOptions = {
      minSemitones: 5,
    };
  }
  /** @returns {{note: number}[]} Scale notes */
  x=()=>this.getNotes();

  /**
   * Delegate selection to VoiceLeadingScore when available
   * @param {number[]} candidates
   * @returns {number}
   */
  selectNoteWithLeading(candidates = []) {
    V.assertArray(candidates, 'candidates');
    if (candidates.length === 0) {
      throw new Error('ScaleComposer.selectNoteWithLeading: no candidate notes provided');
    }

    let selectedNote;
    if (this.VoiceLeadingScore && typeof this.VoiceLeadingScore.selectNextNote === 'function') {
      V.requireType(this.voiceHistory, 'array', 'this.voiceHistory');
      selectedNote = this.VoiceLeadingScore.selectNextNote(this.voiceHistory || [], candidates, {});
    }

    if (typeof selectedNote === 'undefined') {
      selectedNote = candidates[m.floor(candidates.length / 2)];
    }

    // Apply noise-based pitch variation via helper
    if (typeof this.ScaleComposerNoiseCallCount === 'undefined') this.ScaleComposerNoiseCallCount = 0;
    this.ScaleComposerNoiseCallCount++;
    const voiceId = this.root ? this.root.charCodeAt(0) : 60;
    return applyComposerPitchNoise(selectedNote, { voiceId, callCount: this.ScaleComposerNoiseCallCount });
  }
}

RandomScaleComposer = class RandomScaleComposer extends ScaleComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects scale and root from venue.js data */
  noteSet() {
    V.assertArray(allScales, 'allScales', true);
    V.assertArray(allNotes, 'allNotes', true);
    const randomScale=allScales[ri(allScales.length - 1)];
    const randomRoot=allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale,randomRoot);
  }
  /** @returns {{note: number}[]} Random scale notes */
  x() { this.noteSet(); return super.x(); }
}
