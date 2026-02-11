TensionReleaseComposer = class TensionReleaseComposer extends ChordComposer {
  constructor(key = 'C', quality = 'major', tensionCurve = 0.5, opts = {}) {
    const generator = new ProgressionGenerator(key, quality);
    const progressionChords = generator.random();
    super(progressionChords);
    // enable voice-leading delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('TensionReleaseComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
    this.generator = generator;
    this.tensionCurve = clamp(tensionCurve, 0, 1);
    this.key = key;
    this.quality = quality;
    this.measureInSection = 0;
    // Phrase-level coordination
    if (opts.phraseArcManager !== undefined) {
      if (!opts.phraseArcManager || typeof opts.phraseArcManager.getPosition !== 'function' || typeof opts.phraseArcManager.getPhase !== 'function') {
        throw new Error('TensionReleaseComposer: opts.phraseArcManager must implement getPosition() and getPhase()');
      }
      this.phraseArcManager = opts.phraseArcManager;
    } else {
      this.phraseArcManager = null;
    }
    this.phraseTensionScaling = opts.phraseTensionScaling !== false; // Whether to scale tension with phrase arc (default: true)
  }

  calculateTension(chordSymbol) {
    const chord = t.Chord.get(chordSymbol);
    const root = chord.tonic;
    const scaleIndex = this.generator.scale.notes.indexOf(root);
    if ([0, 5].includes(scaleIndex)) return 0.2;
    if ([1, 3].includes(scaleIndex)) return 0.5;
    if ([4, 6].includes(scaleIndex)) return 0.9;
    return 0.5;
  }

  selectChordByTension(position) {
    // Use phrase position if manager is available and scaling is enabled
    let effectivePosition = position;
    if (this.phraseTensionScaling && this.phraseArcManager) {
      const phrasePos = this.phraseArcManager.getPosition();
      const phrasePhase = this.phraseArcManager.getPhase();

      // Map phrase position to tension curve (peak around 0.6-0.75)
      // Opening: low tension (0-0.25) → 0.2-0.4
      // Development: rising tension (0.25-0.5) → 0.4-0.7
      // Climax: peak tension (0.5-0.75) → 0.7-0.95
      // Resolution: falling tension (0.75-1.0) → 0.95-0.2
      if (phrasePhase === 'opening') {
        effectivePosition = 0.2 + phrasePos * 0.8; // 0.2-0.4
      } else if (phrasePhase === 'development') {
        effectivePosition = 0.4 + (phrasePos - 0.25) * 1.2; // 0.4-0.7
      } else if (phrasePhase === 'climax') {
        effectivePosition = 0.7 + (phrasePos - 0.5) * 1.0; // 0.7-0.95
      } else if (phrasePhase === 'resolution') {
        // Fall from peak (0.95) back to tonic (0.2)
        effectivePosition = 0.95 - (phrasePos - 0.75) * 3.0; // 0.95-0.2
      }

      effectivePosition = clamp(effectivePosition, 0, 1);
    }

    const targetTension = this.tensionCurve * Math.sin(effectivePosition * Math.PI);
    if (effectivePosition > 0.85) {
      return this.generator.generate('I-IV-V').slice(-1);
    }
    const allProgressions = [
      ...this.generator.generate('I-IV-V'),
      ...this.generator.generate('ii-V-I'),
      ...this.generator.generate('I-vi-IV-V')
    ];
    let bestChord = allProgressions[0];
    let bestDiff = Infinity;
    for (const chord of allProgressions) {
      const tension = this.calculateTension(chord);
      const diff = Math.abs(tension - targetTension);
      if (diff < bestDiff) { bestDiff = diff; bestChord = chord; }
    }
    return [bestChord];
  }

  noteSet(progression, direction = 'tension') {
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      if (firstItem === null) { console.warn('TensionReleaseComposer.noteSet: progression first item is null — skipping'); return; }
      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;
      if (isStringArray || isChordArray) {
        super.noteSet(progression, direction === 'tension' ? 'R' : direction);
        return;
      }
    }

    if (!this.progression || this.progression.length === 0) { console.warn('TensionReleaseComposer.noteSet: no progression defined — skipping'); return; }
    if (direction !== 'tension') { super.noteSet(this.progression.map(c => c.symbol), direction); return; }
    this.measureInSection = (this.measureInSection || 0) + 1;
    const position = (this.measureInSection % 16) / 16;
    const selectedChords = this.selectChordByTension(position);
    super.noteSet(selectedChords, 'R');
  }

  /**
   * Modifies parent chord-tone weights based on tension curve.
   * High-tension chords boost non-chord tones; low-tension emphasizes chord tones.
   * @param {number[]} candidateNotes - Available MIDI notes
   * @returns {{ candidateWeights: { [note: number]: number } }}
   */
  getVoicingIntent(candidateNotes = []) {
    const base = super.getVoicingIntent(candidateNotes);
    if (!base || typeof base !== 'object' || !base.candidateWeights || typeof base.candidateWeights !== 'object') {
      throw new Error('TensionReleaseComposer.getVoicingIntent: expected parent getVoicingIntent to return object with candidateWeights');
    }
    const weights = base.candidateWeights;
    const current = this.progression && this.progression[this.currentChordIndex];
    const symbol = current && current.symbol ? current.symbol : null;
    const tension = symbol ? this.calculateTension(symbol) : 0.5;

    // Apply tension curve: reduce chord-tone emphasis during high tension
    for (const note of candidateNotes) {
      const key = String(note);
      const existing = typeof weights[key] === 'number' ? weights[key] : 0;
      weights[key] = existing > 0 ? existing * (1 - tension * 0.5) : (tension * 0.5);
    }

    return { candidateWeights: weights };
  }

  x() {
    this.noteSet('tension');
    return super.x();
  }
}
