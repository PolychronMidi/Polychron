// Required via `src/composers/index.js` (aggregator that centralizes side-effect requires)

HarmonicRhythmComposer = class HarmonicRhythmComposer extends ChordComposer {
  constructor(progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major', opts = {}) {
    let chordSymbols = progression;
    if (progression && progression[0] && progression[0].match(/^[ivIV]/)) {
      const generator = new ProgressionGenerator(key, quality);
      chordSymbols = progression.map(roman => generator.romanToChord(roman)).filter(c => c !== null);
    }
    super(chordSymbols);
    this.key = key;
    this.quality = quality;
    this.measuresPerChord = clamp(measuresPerChord, 1, 8);
    this.measureCount = 0;
    this.generator = new ProgressionGenerator(key, quality);
    this._lastChord = null;
    this._isChordChange = false;
    this._measuresSinceChange = 0;
    // Harmonic rhythm emphasis parameters
    this.changeEmphasis = opts.changeEmphasis ?? 2.0; // Weight multiplier during chord changes
    this.anticipation = opts.anticipation ?? false; // Pre-change activity boost
    this.settling = opts.settling ?? true; // Post-change gradual reduction
    // Phrase-level coordination
    if (opts.phraseArcManager !== undefined) {
      if (!opts.phraseArcManager || (typeof opts.phraseArcManager.isAtBoundary !== 'function' && typeof opts.phraseArcManager.getPhraseContext !== 'function')) {
        throw new Error('HarmonicRhythmComposer: opts.phraseArcManager must implement isAtBoundary() or getPhraseContext()');
      }
      this.phraseArcManager = opts.phraseArcManager;
    } else {
      this.phraseArcManager = null;
    }
    this.phraseBoundaryEmphasis = opts.phraseBoundaryEmphasis ?? 1.3; // Extra emphasis at phrase boundaries
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { throw e; }
  }

  getCurrentChord() {
    const chordIndex = m.floor(this.measureCount / this.measuresPerChord) % this.progression.length;
    return this.progression[chordIndex].symbol || this.progression[chordIndex];
  }

  noteSet(progression, direction = 'R') {
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      if (firstItem === null) { throw new Error('HarmonicRhythmComposer.noteSet: progression first item is null'); }
      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;
      if (isStringArray || isChordArray) {
        super.noteSet(progression, direction);
        return;
      }
    }
    if (!this.progression || this.progression.length === 0) { throw new Error('HarmonicRhythmComposer.noteSet: no progression defined — skipping'); }
    const currentChord = this.getCurrentChord();

    // Detect chord change
    const currentSymbol = typeof currentChord === 'string' ? currentChord : (currentChord.symbol || currentChord);
    const lastSymbol = this._lastChord;
    this._isChordChange = (lastSymbol !== null && lastSymbol !== currentSymbol);

    if (this._isChordChange) {
      this._measuresSinceChange = 0;
    } else {
      this._measuresSinceChange++;
    }

    this._lastChord = currentSymbol;
    super.noteSet([currentChord], 'R');
    this.measureCount++;
  }

  setHarmonicRhythm(measures) {
    this.measuresPerChord = clamp(measures, 1, 8);
    this.measureCount = 0;
  }

  changeProgression(newProgression) {
    this.measureCount = m.ceil(this.measureCount / this.measuresPerChord) * this.measuresPerChord;
    super.noteSet(newProgression, 'R');
  }

  getNotes(octaveRange) {
    if (!this.progression || this.progression.length === 0) {
      throw new Error('HarmonicRhythmComposer.getNotes: no progression defined');
    }
    this.noteSet();
    const notes = super.getNotes(octaveRange);
    if (!Array.isArray(notes) || notes.length === 0) {
      throw new Error('HarmonicRhythmComposer.getNotes: expected super.getNotes() to return a non-empty array');
    }
    return notes;
  }

  x() {
    this.noteSet();
    return super.x();
  }

  getVoicingIntent(candidateNotes) {
    if (!candidateNotes || candidateNotes.length === 0) throw new Error('HarmonicRhythmComposer.getVoicingIntent: candidateNotes must be a non-empty array');

    // Check phrase boundary if manager is available
    const atPhraseBoundary = this.phraseArcManager ? this.phraseArcManager.isAtBoundary() : false;
    const atPhraseEnd = this.phraseArcManager ? this.phraseArcManager.isAtEnd() : false;

    // Calculate emphasis based on harmonic rhythm state
    let emphasisFactor = 1.0;

    // Chord change: maximum emphasis
    if (this._isChordChange) {
      emphasisFactor = this.changeEmphasis;
      // Extra emphasis if chord change aligns with phrase boundary (cadence!)
      if (atPhraseBoundary) {
        emphasisFactor *= this.phraseBoundaryEmphasis;
      }
    }
    // Anticipation: slight boost 1 measure before change
    else if (this.anticipation && this._measuresSinceChange === this.measuresPerChord - 1) {
      emphasisFactor = 1.0 + (this.changeEmphasis - 1.0) * 0.3; // 30% of change emphasis
    }
    // Settling: gradual reduction after change
    else if (this.settling && this._measuresSinceChange <= 2) {
      const settleProgress = this._measuresSinceChange / 2; // 0 to 1 over 2 measures
      emphasisFactor = this.changeEmphasis - (this.changeEmphasis - 1.0) * settleProgress * 0.7;
    }
    // Phrase boundary emphasis even without chord change (cadential feeling)
    else if (atPhraseBoundary) {
      emphasisFactor = 1.0 + (this.changeEmphasis - 1.0) * 0.5; // 50% of change emphasis
    }

    // Get chord tones from parent class voicing intent
    const parentIntent = super.getVoicingIntent ? super.getVoicingIntent(candidateNotes) : {};
    // Ensure candidateWeights is available and well-formed
    const candidateWeights = parentIntent && parentIntent.candidateWeights;
    if (!candidateWeights || typeof candidateWeights !== 'object') {
      throw new Error('HarmonicRhythmComposer.getVoicingIntent: expected parent getVoicingIntent to return object with candidateWeights');
    }

    // Apply harmonic rhythm emphasis to all notes
    const emphasizedWeights = {};
    for (const note of candidateNotes) {
      if (candidateWeights[note] === undefined) {
        throw new Error(`HarmonicRhythmComposer.getVoicingIntent: candidate note ${note} missing from parent candidateWeights`);
      }
      const baseWeight = candidateWeights[note];
      emphasizedWeights[note] = baseWeight * emphasisFactor;
    }

    return {
      candidateWeights: emphasizedWeights,
      // Register bias: higher during changes, lower at phrase end (cadence resolution)
      registerBias: this._isChordChange ? 'higher' : (atPhraseEnd ? 'lower' : undefined),
      // Voice count: increased during changes, potentially reduced at phrase end for clarity
      voiceCountMultiplier: this._isChordChange ? 1.2 : (atPhraseEnd ? 0.9 : 1.0)
    };
  }
}
