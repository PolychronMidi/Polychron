// Dependencies are required via `src/composers/index.js` (aggregator that centralizes side-effect requires)

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
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('HarmonicRhythmComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
  }

  getCurrentChord() {
    const chordIndex = m.floor(this.measureCount / this.measuresPerChord) % this.progression.length;
    return this.progression[chordIndex].symbol || this.progression[chordIndex];
  }

  noteSet(progression, direction = 'R') {
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      if (firstItem === null) { console.warn('HarmonicRhythmComposer.noteSet: progression first item is null — skipping'); return; }
      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;
      if (isStringArray || isChordArray) {
        super.noteSet(progression, direction);
        return;
      }
    }
    if (!this.progression || this.progression.length === 0) { console.warn('HarmonicRhythmComposer.noteSet: no progression defined — skipping'); return; }
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
      return [{ note: 60 }];
    }
    this.noteSet();
    return super.getNotes(octaveRange);
  }

  x() {
    this.noteSet();
    return super.x();
  }

  getVoicingIntent(candidateNotes) {
    if (!candidateNotes || candidateNotes.length === 0) return {};

    // Calculate emphasis based on harmonic rhythm state
    let emphasisFactor = 1.0;

    // Chord change: maximum emphasis
    if (this._isChordChange) {
      emphasisFactor = this.changeEmphasis;
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

    // Get chord tones from parent class voicing intent
    const parentIntent = super.getVoicingIntent ? super.getVoicingIntent(candidateNotes) : {};
    const candidateWeights = parentIntent.candidateWeights || {};

    // Apply harmonic rhythm emphasis to all notes
    const emphasizedWeights = {};
    for (const note of candidateNotes) {
      const baseWeight = candidateWeights[note] || 1.0;
      emphasizedWeights[note] = baseWeight * emphasisFactor;
    }

    return {
      candidateWeights: emphasizedWeights,
      // Optional: suggest register lift during chord changes
      registerBias: this._isChordChange ? 'higher' : undefined,
      // Optional: suggest increased voice count during changes
      voiceCountMultiplier: this._isChordChange ? 1.5 : 1.0
    };
  }
}
