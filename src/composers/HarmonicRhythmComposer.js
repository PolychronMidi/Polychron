// Required via `src/composers/index.js` (aggregator that centralizes side-effect requires)
const V = validator.create('HarmonicRhythmComposer');

HarmonicRhythmComposer = class HarmonicRhythmComposer extends ChordComposer {
  constructor(progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major', opts = {}) {
    V.assertNonEmptyString(key, 'key');
    V.assertNonEmptyString(quality, 'quality');
    V.requireFinite(measuresPerChord, 'measuresPerChord');
    const generator = new ProgressionGenerator(key, quality);
    let chordSymbols = progression;
    const harmonicCorpusOpts = {
      source: 'harmonicRhythm',
      useCorpusHarmonicPriors: opts && opts.useCorpusHarmonicPriors === true,
      corpusHarmonicStrength: opts && opts.corpusHarmonicStrength
    };
    if (V.optionalType(progression, 'string', null) !== null) {
      const mode = /** @type {string} */ (progression).toLowerCase();
      if (mode === 'corpus') {
        chordSymbols = generator.generate('corpus', Object.assign({}, harmonicCorpusOpts, {
          useCorpus: true
        }));
      } else if (mode === 'random') {
        chordSymbols = generator.random(harmonicCorpusOpts);
      } else {
        chordSymbols = generator.generate(progression, { source: 'harmonicRhythm' });
      }
    } else if (progression && progression[0] && V.optionalType(progression[0], 'string', null) !== null && progression[0].match(/^[ivIV]/)) {
      chordSymbols = progression.map(roman => generator.romanToChord(roman)).filter(c => c !== null);
    }
    super(chordSymbols);
    this.key = key;
    this.quality = quality;
    this.measuresPerChord = clamp(measuresPerChord, 1, 8);
    this.measureCount = 0;
    this.generator = generator;
    this.HarmonicRhythmComposerLastChord = null;
    this.HarmonicRhythmComposerIsChordChange = false;
    this.HarmonicRhythmComposerMeasuresSinceChange = 0;
    // Harmonic rhythm emphasis parameters
    this.changeEmphasis = opts.changeEmphasis ?? 2.0; // Weight multiplier during chord changes
    this.anticipation = opts.anticipation ?? false; // Pre-change activity boost
    this.settling = opts.settling ?? true; // Post-change gradual reduction
    // Phrase-level coordination
    if (opts.phraseArcManager !== undefined) {
      if (!opts.phraseArcManager) {
        throw new Error('HarmonicRhythmComposer: opts.phraseArcManager must implement isAtBoundary() or getPhraseContext()');
      }
      try {
        V.requireType(opts.phraseArcManager.isAtBoundary, 'function', 'opts.phraseArcManager.isAtBoundary');
      } catch { /* duck-type validation: input may be config instead of instance */
        V.requireType(opts.phraseArcManager.getPhraseContext, 'function', 'opts.phraseArcManager.getPhraseContext');
      }
      this.phraseArcManager = opts.phraseArcManager;
    } else {
      this.phraseArcManager = null;
    }
    this.phraseBoundaryEmphasis = opts.phraseBoundaryEmphasis ?? 1.3; // Extra emphasis at phrase boundaries
    this.enableVoiceLeading(new VoiceLeadingScore());
  }

  getCurrentChord() {
    // -- Texture-responsive harmonic pacing (#5) --
    // Sustained chord-burst activity - faster harmonic rhythm (reduce measuresPerChord)
    // Sustained flurry activity - slower harmonic rhythm (hold chords longer)
    let effectiveMPC = this.measuresPerChord;
    const texMetrics = drumTextureCoupler.getMetrics();
    if (texMetrics.intensity > 0.3) {
      const burstDominant = texMetrics.burstCount > texMetrics.flurryCount;
      if (burstDominant) {
        effectiveMPC = m.max(1, m.round(effectiveMPC - texMetrics.intensity));
      } else {
        effectiveMPC = m.min(8, m.round(effectiveMPC + texMetrics.intensity * 0.5));
      }
    }
    effectiveMPC = clamp(effectiveMPC, 1, 8);
    const chordIndex = m.floor(this.measureCount / effectiveMPC) % this.progression.length;
    return this.progression[chordIndex].symbol || this.progression[chordIndex];
  }

  noteSet(progression, direction = 'R') {
    if (progression && progression.length > 0 && (() => { try { V.assertArray(progression, 'progression'); return true; } catch (_) { return false; } })()) {
      const firstItem = progression[0];
      if (firstItem === null) { throw new Error('HarmonicRhythmComposer.noteSet: progression first item is null'); }
      const isStringArray = V.optionalType(firstItem, 'string', null) !== null;
      const isChordArray = V.optionalType(firstItem, 'object', null) !== null && firstItem !== null && firstItem.symbol;
      if (isStringArray || isChordArray) {
        super.noteSet(progression, direction);
        return;
      }
    }
    if (!this.progression || this.progression.length === 0) { throw new Error('HarmonicRhythmComposer.noteSet: no progression defined - skipping'); }
    const currentChord = this.getCurrentChord();

    // Detect chord change
    const currentSymbol = V.optionalType(currentChord, 'string', null) !== null ? currentChord : (currentChord.symbol || currentChord);
    const lastSymbol = this.HarmonicRhythmComposerLastChord;
    this.HarmonicRhythmComposerIsChordChange = (lastSymbol !== null && lastSymbol !== currentSymbol);

    if (this.HarmonicRhythmComposerIsChordChange) {
      this.HarmonicRhythmComposerMeasuresSinceChange = 0;
    } else {
      this.HarmonicRhythmComposerMeasuresSinceChange++;
    }

    this.HarmonicRhythmComposerLastChord = currentSymbol;

    // Calculate and push harmonic tension based on chord quality
    let tension = 0.3; // Default low-medium
    const quality = (t.Chord) ? t.Chord.get(currentSymbol).quality : 'Major';

    if (quality === 'Major') tension = 0.2;
    else if (quality === 'Minor') tension = 0.4;
    else if (quality === 'Dominant' || quality === 'Augmented') tension = 0.8;
    else if (quality === 'Diminished') tension = 0.9;

    // Add some random drift for variety
    tension = clamp(tension + rf(-0.1, 0.1), 0, 1);

    // Update harmonicContext without overwriting other fields
    // (We don't know the full state here, just updating tension)
    try { harmonicContext.set({ tension }); } catch (e) { console.warn('Acceptable warning: HarmonicRhythmComposer: harmonicContext.set failed:', e && e.message ? e.message : e); }

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
    V.assertArray(notes, 'notes', true);
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
    if (this.HarmonicRhythmComposerIsChordChange) {
      emphasisFactor = this.changeEmphasis;
      // Extra emphasis if chord change aligns with phrase boundary (cadence!)
      if (atPhraseBoundary) {
        emphasisFactor *= this.phraseBoundaryEmphasis;
      }
    }
    // Anticipation: slight boost 1 measure before change
    else if (this.anticipation && this.HarmonicRhythmComposerMeasuresSinceChange === this.measuresPerChord - 1) {
      emphasisFactor = 1.0 + (this.changeEmphasis - 1.0) * 0.3; // 30% of change emphasis
    }
    // Settling: gradual reduction after change
    else if (this.settling && this.HarmonicRhythmComposerMeasuresSinceChange <= 2) {
      const settleProgress = this.HarmonicRhythmComposerMeasuresSinceChange / 2; // 0 to 1 over 2 measures
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
    V.assertObject(candidateWeights, 'candidateWeights');

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
      registerBias: this.HarmonicRhythmComposerIsChordChange ? 'higher' : (atPhraseEnd ? 'lower' : undefined),
      // Voice count: increased during changes, potentially reduced at phrase end for clarity
      voiceCountMultiplier: this.HarmonicRhythmComposerIsChordChange ? 1.2 : (atPhraseEnd ? 0.9 : 1.0)
    };
  }
}
