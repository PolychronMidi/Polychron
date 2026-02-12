// MelodicDevelopmentComposer.js - A ScaleComposer that applies melodic transformations based on intensity and phrase arc

MelodicDevelopmentComposer = class MelodicDevelopmentComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', intensity = 0.5, developmentBias = 0.7, opts = {}) {
    if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('MelodicDevelopmentComposer: allNotes not available');
    if (!Array.isArray(allScales) || allScales.length === 0) throw new Error('MelodicDevelopmentComposer: allScales not available');
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    this.baseIntensity = clamp(intensity, 0, 1); // Base intensity (scaled by phrase arc)
    this.developmentBias = clamp(developmentBias, 0, 1);
    this.motifPhase = 0;
    this.measureCount = 0;
    this.responseMode = false;
    this.transpositionOffset = 0;
    this.currentPhase = 0;
    this._lastBaseNotes = [];
    this._lastDevelopedNotes = [];
    // Phrase-level coordination
    if (opts.phraseArcManager !== undefined) {
      if (!opts.phraseArcManager || typeof opts.phraseArcManager.getPhraseContext !== 'function') {
        throw new Error('MelodicDevelopmentComposer: invalid phraseArcManager provided (must implement getPhraseContext())');
      }
      this.phraseArcManager = opts.phraseArcManager;
    } else {
      this.phraseArcManager = null;
    }
    this.arcScaling = opts.arcScaling !== false; // Whether to scale intensity with phrase arc (default: true)
    // enable lightweight voice-leading scorer for selection delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { throw e; }
  }

  /**
   * Get effective intensity scaled by phrase arc
   */
  get intensity() {
    if (!this.arcScaling || !this.phraseArcManager) {
      return this.baseIntensity;
    }

    const phraseContext = this.phraseArcManager.getPhraseContext();
    // Scale intensity with dynamism (0.5-1.0 typically)
    // Higher dynamism during climax = more aggressive development
    return clamp(this.baseIntensity * phraseContext.dynamism * 1.5, 0, 1);
  }

  /**
   * Set base intensity (will still be scaled by phrase arc)
   */
  set intensity(value) {
    this.baseIntensity = clamp(value, 0, 1);
  }

  getNotes(octaveRange) {
    const baseNotes = super.getNotes(octaveRange);
    if (!Array.isArray(baseNotes) || baseNotes.length === 0) {
      throw new Error('MelodicDevelopmentComposer.getNotes: expected super.getNotes() to return a non-empty array');
    }
    this.measureCount++;
    this.currentPhase = m.floor((this.measureCount - 1) / 2) % 4;
    let developedNotes = [...baseNotes];
    const intensity = this.intensity;

    // Build context for noise helper
    const currentTime = (typeof beatStart !== 'undefined' ? beatStart : 0);
    const voiceId = (this.root ? this.root.charCodeAt(0) : 60) + this.measureCount;
    const noiseContext = { currentTime, voiceId, phase: this.currentPhase };

    switch (this.currentPhase) {
      case 0:
        // Transpose by chromatic semitones - THIS CHANGES PITCH CLASSES!
        // Need to either constrain to scale or accept that transposition creates new PCs
        this.transpositionOffset = intensity > 0.5 ? ri(-2, 2) : 0;
        this.transpositionOffset = applyMelodicTranspositionNoise(this.transpositionOffset, noiseContext);
        // FAIL FAST: transposition by offset creates new pitch classes
        throw new Error(`MelodicDevelopmentComposer.getNotes phase 0: chromatic transposition (+${this.transpositionOffset}) would create pitch classes outside the scale. Need scale-degree transposition instead.`);
        // developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
      case 1:
        // Transpose by chromatic semitones - THIS CHANGES PITCH CLASSES!
        this.transpositionOffset = m.round(intensity * 7);
        this.transpositionOffset = applyMelodicTranspositionNoise(this.transpositionOffset, noiseContext);
        // FAIL FAST: transposition by offset creates new pitch classes
        throw new Error(`MelodicDevelopmentComposer.getNotes phase 1: chromatic transposition (+${this.transpositionOffset}) would create pitch classes outside the scale. Need scale-degree transposition instead.`);
        // developedNotes = baseNotes.map(n => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
      case 2:
        if (intensity > 0.3) {
          // Inversion by chromatic reflection - THIS CHANGES PITCH CLASSES!
          const firstBase = baseNotes[0];
          let pivot;
          if (typeof firstBase === 'number') {
            pivot = firstBase;
          } else if (firstBase && typeof firstBase.note === 'number') {
            pivot = firstBase.note;
          } else {
            throw new Error('MelodicDevelopmentComposer.getNotes: invalid baseNotes[0] - expected number or {note:number}');
          }
          const noisyPivot = applyMelodicPivotNoise(pivot, noiseContext);
          // FAIL FAST: chromatic inversion creates new pitch classes
          throw new Error(`MelodicDevelopmentComposer.getNotes phase 2: chromatic inversion (pivot=${noisyPivot}) would create pitch classes outside the scale. Need scale-degree inversion instead.`);
          // developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(2 * noisyPivot - n.note, 0, 127) }));
        }
        break;
      case 3:
        if (intensity > 0.5) developedNotes = [...baseNotes].reverse();
        break;
    }

    if (typeof HarmonicContext !== 'undefined') {
      const scale = HarmonicContext.getField('scale');
      if (Array.isArray(scale) && scale.length > 0) {
        for (const n of developedNotes) {
          let noteVal;
          if (typeof n === 'number') {
            noteVal = n;
          } else if (n && typeof n.note === 'number') {
            noteVal = n.note;
          } else {
            throw new Error('MelodicDevelopmentComposer.getNotes: developed note has invalid shape; expected number or {note:number}');
          }
          if (!HarmonicContext.isNoteInScale(noteVal)) {
            throw new Error(`MelodicDevelopmentComposer.getNotes: note ${noteVal} not in HarmonicContext scale`);
          }
        }
      }
    }

    this._lastBaseNotes = baseNotes;
    this._lastDevelopedNotes = developedNotes;
    return developedNotes;
  }

  setintensity(intensity) {
    this.baseIntensity = clamp(intensity, 0, 1);
  }

  resetMotifPhase() {
    this.motifPhase = 0;
    this.measureCount = 0;
    this.responseMode = false;
    this.transpositionOffset = 0;
    this.currentPhase = 0;
    this._lastBaseNotes = [];
    this._lastDevelopedNotes = [];
  }

  /**
   * Returns voicing intent that weights base notes and development transformations differently.
   * @param {number[]} candidateNotes - Available MIDI notes
   * @returns {{ candidateWeights: { [note: number]: number } } | null}
   */
  getVoicingIntent(candidateNotes = []) {
    if (!Array.isArray(candidateNotes) || candidateNotes.length === 0) return null;
    if (this._lastBaseNotes.length === 0 || this._lastDevelopedNotes.length === 0) return null;

    const baseWeight = 1.0;
    const transformWeight = this.developmentBias * this.intensity;

    // Extract note values from base and developed arrays
    const baseNotesSet = new Set();
    for (const item of this._lastBaseNotes) {
      const n = typeof item === 'number' ? item : (item && typeof item === 'object' && typeof item.note === 'number' ? item.note : null);
      if (typeof n === 'number' && Number.isFinite(n)) baseNotesSet.add(n);
    }

    const developedNotesSet = new Set();
    for (const item of this._lastDevelopedNotes) {
      const n = typeof item === 'number' ? item : (item && typeof item === 'object' && typeof item.note === 'number' ? item.note : null);
      if (typeof n === 'number' && Number.isFinite(n)) developedNotesSet.add(n);
    }

    // Phase-based weight scaling
    const phaseScale = this.currentPhase === 0 ? 0.8 :
                      this.currentPhase === 1 ? 1.2 :
                      this.currentPhase === 2 ? 1.5 :
                      this.currentPhase === 3 ? 1.0 : 1.0;

    // Assign weights based on category
    /** @type {{ [note: number]: number }} */
    const candidateWeights = {};
    for (const candidate of candidateNotes) {
      let note;
      if (typeof candidate === 'number') {
        note = candidate;
      } else {
        const candidateObj = /** @type {any} */ (candidate);
        if (candidateObj && typeof candidateObj === 'object' && typeof candidateObj.note === 'number') {
          note = candidateObj.note;
        } else {
          throw new Error('MelodicDevelopmentComposer.getVoicingIntent: candidate must be a number or {note:number}');
        }
      }

      if (!Number.isFinite(note)) {
        throw new Error('MelodicDevelopmentComposer.getVoicingIntent: candidate note must be finite');
      }

      const isBase = baseNotesSet.has(note);
      const isDeveloped = developedNotesSet.has(note);

      if (isBase && isDeveloped) {
        // Common tone (appears in both base and developed)
        candidateWeights[note] = baseWeight + transformWeight * 0.5;
      } else if (isDeveloped) {
        // Development transformation (scaled by phase intensity)
        candidateWeights[note] = baseWeight * 0.3 + transformWeight * phaseScale;
      } else if (isBase) {
        // Base note (not transformed)
        candidateWeights[note] = baseWeight;
      } else {
        // Chromatic passing tone (neither base nor developed)
        candidateWeights[note] = baseWeight * 0.2;
      }

      candidateWeights[note] = m.max(0, candidateWeights[note]);
    }

    return { candidateWeights };
  }

}
