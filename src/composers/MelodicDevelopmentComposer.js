// Dependency: required via `src/composers/index.js`

MelodicDevelopmentComposer = class MelodicDevelopmentComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', intensity = 0.5, developmentBias = 0.7, opts = {}) {
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
    this.phraseArcManager = opts.phraseArcManager || null; // Optional PhraseArcManager reference
    this.arcScaling = opts.arcScaling !== false; // Whether to scale intensity with phrase arc (default: true)
    // enable lightweight voice-leading scorer for selection delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('MelodicDevelopmentComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
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
    if (baseNotes.length === 0) return baseNotes;
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
        this.transpositionOffset = intensity > 0.5 ? ri(-2, 2) : 0;
        this.transpositionOffset = applyMelodicTranspositionNoise(this.transpositionOffset, noiseContext);
        developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
        break;
      case 1:
        this.transpositionOffset = m.round(intensity * 7);
        this.transpositionOffset = applyMelodicTranspositionNoise(this.transpositionOffset, noiseContext);
        developedNotes = baseNotes.map(n => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
        break;
      case 2:
        if (intensity > 0.3) {
          const pivot = baseNotes[0]?.note || 60;
          const noisyPivot = applyMelodicPivotNoise(pivot, noiseContext);
          developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(2 * noisyPivot - n.note, 0, 127) }));
        }
        break;
      case 3:
        if (intensity > 0.5) developedNotes = [...baseNotes].reverse();
        break;
    }
    if (rf() < 0.3) {
      this.responseMode = !this.responseMode;
      if (this.responseMode) {
        developedNotes = developedNotes.map((n, i) => {
          const baseDuration = (n.duration || 480) * (intensity + 0.5);
          return { ...n, duration: applyMelodicDurationNoise(baseDuration, noiseContext) };
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

  getVoicingIntent(candidateNotes = []) {
    if (!Array.isArray(candidateNotes) || candidateNotes.length === 0) return null;
    if (this._lastBaseNotes.length === 0 || this._lastDevelopedNotes.length === 0) return null;

    const candidateWeights = {};
    const baseWeight = 1.0;
    const transformWeight = this.developmentBias * this.intensity;

    // Build sets of base notes and developed notes for fast lookup
    const baseNoteSet = new Set();
    const developedNoteSet = new Set();

    for (const n of this._lastBaseNotes) {
      const note = typeof n.note === 'number' ? n.note : n;
      if (typeof note === 'number' && Number.isFinite(note)) {
        baseNoteSet.add(note);
      }
    }

    for (const n of this._lastDevelopedNotes) {
      const note = typeof n.note === 'number' ? n.note : n;
      if (typeof note === 'number' && Number.isFinite(note)) {
        developedNoteSet.add(note);
      }
    }

    // Assign weights based on whether candidate is a base note, developed note, or both
    for (const candidate of candidateNotes) {
      const note = typeof candidate === 'number' ? candidate : (candidate.note || 0);
      const isBase = baseNoteSet.has(note);
      const isDeveloped = developedNoteSet.has(note);

      let weight = 0;

      if (isBase && isDeveloped) {
        // Note appears in both base and developed (common tone)
        weight = baseWeight + transformWeight * 0.5;
      } else if (isDeveloped) {
        // Note is a development transformation
        // Scale by phase: more extreme phases get higher emphasis
        const phaseScale = this.currentPhase === 0 ? 0.8 :
                          this.currentPhase === 1 ? 1.2 :
                          this.currentPhase === 2 ? 1.5 :
                          this.currentPhase === 3 ? 1.0 : 1.0;
        weight = baseWeight * 0.3 + transformWeight * phaseScale;
      } else if (isBase) {
        // Note is a base note but not developed (voice leading fell back)
        weight = baseWeight;
      } else {
        // Note is neither base nor developed (chromatic passing tone)
        weight = baseWeight * 0.2;
      }

      candidateWeights[note] = Math.max(0, weight);
    }

    return { candidateWeights };
  }

}
