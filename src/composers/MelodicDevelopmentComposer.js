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
    const inversionMode = (opts.inversionMode === undefined) ? 'diatonic' : String(opts.inversionMode).toLowerCase();
    if (!['diatonic', 'chromatic'].includes(inversionMode)) {
      throw new Error(`MelodicDevelopmentComposer: invalid inversionMode "${opts.inversionMode}" (expected diatonic|chromatic)`);
    }
    const inversionPivotMode = (opts.inversionPivotMode === undefined) ? 'first-note' : String(opts.inversionPivotMode).toLowerCase();
    if (!['first-note', 'median', 'fixed-degree'].includes(inversionPivotMode)) {
      throw new Error(`MelodicDevelopmentComposer: invalid inversionPivotMode "${opts.inversionPivotMode}" (expected first-note|median|fixed-degree)`);
    }
    this.inversionMode = inversionMode;
    this.inversionPivotMode = inversionPivotMode;
    this.inversionFixedDegree = Number.isFinite(Number(opts.inversionFixedDegree)) ? m.round(Number(opts.inversionFixedDegree)) : 0;
    this.normalizeToScale = opts.normalizeToScale !== false;
    this.useDegreeNoise = opts.useDegreeNoise !== false;
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

    const preservesScale = !(this.inversionMode === 'chromatic' && this.normalizeToScale === false);
    // MelodicDevelopment intentionally mutates pitch classes over time (within scale when preservesScale=true).
    const mutatesPitchClasses = true;
    this.setCapabilities({
      preservesScale,
      mutatesPitchClasses,
      deterministic: false,
      notesReflectOutputSet: preservesScale,
      timeVaryingScaleContext: true
    });
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
    // Prefer HarmonicContext window scale when composer declares timeVaryingScaleContext
    const hcHasScale = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function');
    const hcScale = hcHasScale ? HarmonicContext.getField('scale') : null;
    const effectiveScale = (this.hasCapability('timeVaryingScaleContext') && Array.isArray(hcScale) && hcScale.length > 0)
      ? hcScale
      : (Array.isArray(this.notes) && this.notes.length > 0 ? this.notes : hcScale);
    if (!Array.isArray(effectiveScale) || effectiveScale.length === 0) {
      throw new Error('MelodicDevelopmentComposer.getNotes: no effective scale available');
    }
    const scalePC = resolveScalePC(effectiveScale);

    const fitToMidiInScale = (midiVal) => {
      if (!Number.isFinite(Number(midiVal))) throw new Error('MelodicDevelopmentComposer.getNotes: non-finite midi value during normalization');
      if (typeof modClamp !== 'function') throw new Error('MelodicDevelopmentComposer.getNotes: modClamp() not available');
      let out = modClamp(Number(midiVal), 0, 127);
      let outPC = modClamp(out, 0, 11);
      if (!scalePC.includes(outPC)) {
        const quantRaw = transposeByDegree(out, effectiveScale, 0, { quantize: true, clampToMidi: false });
        if (!Number.isFinite(Number(quantRaw))) {
          throw new Error('MelodicDevelopmentComposer.getNotes: quantization produced non-finite midi');
        }
        out = modClamp(Number(quantRaw), 0, 127);
        outPC = modClamp(out, 0, 11);
      }
      if (!scalePC.includes(outPC)) {
        throw new Error(`MelodicDevelopmentComposer.getNotes: failed to normalize note ${midiVal} to effective scale`);
      }
      return m.round(out);
    };

    // If composer honors time-varying scale context, derive baseNotes from the effectiveScale (fail-fast if not available)
    let baseNotes;
    if (this.hasCapability('timeVaryingScaleContext') && Array.isArray(effectiveScale) && effectiveScale.length > 0) {
      const prevNotes = this.notes;
      try {
        this.notes = effectiveScale;
        baseNotes = super.getNotes(octaveRange);
      } finally {
        this.notes = prevNotes;
      }
    } else {
      baseNotes = super.getNotes(octaveRange);
    }

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
        // Scale-degree transposition (preserve scale membership)
        let degreeOffset0 = intensity > 0.5 ? ri(-2, 2) : 0;
        if (this.useDegreeNoise) {
          degreeOffset0 = applyMelodicTranspositionNoise(degreeOffset0, noiseContext, { degree: true, scale: effectiveScale });
        }
        degreeOffset0 = clamp(m.round(degreeOffset0), -4, 4);
        if (degreeOffset0 !== 0) {
          developedNotes = baseNotes.map((n) => {
            const midi = (typeof n === 'number') ? n : (n && typeof n.note === 'number' ? n.note : null);
            if (!Number.isFinite(midi)) throw new Error('MelodicDevelopmentComposer.getNotes: invalid base note');
            const transposedRaw = transposeByDegree(midi, effectiveScale, degreeOffset0, { clampToMidi: false });
            const transposed = fitToMidiInScale(transposedRaw);
            return (typeof n === 'number') ? transposed : Object.assign({}, n, { note: transposed });
          });
        }
        break;
      case 1:
        // Scale-degree transposition scaled by intensity (larger steps than phase 0)
        let degreeOffset1 = m.round(intensity * 3);
        if (this.useDegreeNoise) {
          degreeOffset1 = applyMelodicTranspositionNoise(degreeOffset1, noiseContext, { degree: true, scale: effectiveScale });
        }
        degreeOffset1 = clamp(m.round(degreeOffset1), -5, 5);
        if (degreeOffset1 !== 0) {
          developedNotes = baseNotes.map((n) => {
            const midi = (typeof n === 'number') ? n : (n && typeof n.note === 'number' ? n.note : null);
            if (!Number.isFinite(midi)) throw new Error('MelodicDevelopmentComposer.getNotes: invalid base note');
            const transposedRaw = transposeByDegree(midi, effectiveScale, degreeOffset1, { clampToMidi: false });
            const transposed = fitToMidiInScale(transposedRaw);
            return (typeof n === 'number') ? transposed : Object.assign({}, n, { note: transposed });
          });
        }
        break;
      case 2:
        if (intensity > 0.3) {
          const theScale = effectiveScale;
          if (!Array.isArray(theScale) || theScale.length === 0) throw new Error('MelodicDevelopmentComposer.getNotes phase 2: no scale available for inversion');

          let pivotSeed;
          if (this.inversionPivotMode === 'median') {
            const baseMidi = baseNotes.map((item) => (typeof item === 'number') ? item : (item && typeof item.note === 'number' ? item.note : NaN));
            const valid = baseMidi.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
            if (valid.length === 0) throw new Error('MelodicDevelopmentComposer.getNotes phase 2: no valid base notes for median pivot');
            pivotSeed = valid[m.floor(valid.length / 2)];
          } else {
            const firstBase = baseNotes[0];
            pivotSeed = (typeof firstBase === 'number') ? firstBase : (firstBase && typeof firstBase.note === 'number' ? firstBase.note : NaN);
            if (!Number.isFinite(pivotSeed)) throw new Error('MelodicDevelopmentComposer.getNotes phase 2: invalid first-note pivot');
          }

          let noisyPivot = applyMelodicPivotNoise(pivotSeed, noiseContext);
          if (this.inversionPivotMode === 'fixed-degree') {
            const pInfo = midiToDegree(noisyPivot, theScale, { quantize: true });
            const noisyPivotRaw = degreeToMidi(this.inversionFixedDegree, theScale, pInfo.octave, { clampToMidi: false });
            noisyPivot = fitToMidiInScale(noisyPivotRaw);
          }

          if (this.inversionMode === 'chromatic') {
            developedNotes = baseNotes.map((item) => {
              const midi = (typeof item === 'number') ? item : (item && typeof item.note === 'number' ? item.note : NaN);
              if (!Number.isFinite(midi)) throw new Error('MelodicDevelopmentComposer.getNotes phase 2: invalid base note for chromatic inversion');
              const inverted = clamp(m.round(2 * noisyPivot - midi), 0, 127);
              return (typeof item === 'number') ? inverted : Object.assign({}, item, { note: inverted });
            });
          } else {
            const pivotInfo = midiToDegree(noisyPivot, theScale, { quantize: true });
            const pivotAbs = pivotInfo.absDegree;
            developedNotes = baseNotes.map((item) => {
              const midi = (typeof item === 'number') ? item : (item && typeof item.note === 'number' ? item.note : NaN);
              if (!Number.isFinite(midi)) throw new Error('MelodicDevelopmentComposer.getNotes phase 2: invalid base note for diatonic inversion');
              const info = midiToDegree(midi, theScale, { quantize: true });
              const invAbs = 2 * pivotAbs - info.absDegree;
              const invMidiRaw = degreeToMidi(invAbs, theScale, 0, { clampToMidi: false });
              const invMidi = fitToMidiInScale(invMidiRaw);
              return (typeof item === 'number') ? invMidi : Object.assign({}, item, { note: invMidi });
            });
          }
        }
        break;
      case 3:
        if (intensity > 0.5) developedNotes = [...baseNotes].reverse();
        break;
    }

    // Final normalization when enabled: ensure returned notes' pitch-classes belong to effective scale.
    if (this.normalizeToScale) {
      const theScale = effectiveScale;
      if (Array.isArray(theScale) && theScale.length > 0) {
        developedNotes = developedNotes.map((item) => {
          const val = (typeof item === 'number') ? item : (item && typeof item.note === 'number' ? item.note : NaN);
          if (!Number.isFinite(val)) throw new Error('MelodicDevelopmentComposer.getNotes: invalid developed note');
          const pc = modClamp(val, 0, 11);
          if (!scalePC.includes(pc)) {
            const quantRaw = transposeByDegree(val, theScale, 0, { quantize: true, clampToMidi: false });
            const quant = fitToMidiInScale(quantRaw);
            return (typeof item === 'number') ? quant : Object.assign({}, item, { note: quant });
          }
          return item;
        });
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
