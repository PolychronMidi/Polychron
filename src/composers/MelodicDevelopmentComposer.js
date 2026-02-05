// Dependency: required via `src/composers/index.js`

MelodicDevelopmentComposer = class MelodicDevelopmentComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', intensity = 0.5, developmentBias = 0.7) {
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    this.intensity = clamp(intensity, 0, 1);
    this.developmentBias = clamp(developmentBias, 0, 1);
    this.motifPhase = 0;
    this.measureCount = 0;
    this.responseMode = false;
    this.transpositionOffset = 0;
    this.currentPhase = 0;
    this._lastBaseNotes = [];
    this._lastDevelopedNotes = [];
    // enable lightweight voice-leading scorer for selection delegation
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('MelodicDevelopmentComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
  }

  getNotes(octaveRange) {
    const baseNotes = super.getNotes(octaveRange);
    if (baseNotes.length === 0) return baseNotes;
    this.measureCount++;
    this.currentPhase = m.floor((this.measureCount - 1) / 2) % 4;
    let developedNotes = [...baseNotes];
    const intensity = this.intensity;
    switch (this.currentPhase) {
      case 0:
        this.transpositionOffset = intensity > 0.5 ? ri(-2, 2) : 0;
        developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
        break;
      case 1:
        this.transpositionOffset = m.round(intensity * 7);
        developedNotes = baseNotes.map(n => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
        break;
      case 2:
        if (intensity > 0.3) {
          const pivot = baseNotes[0]?.note || 60;
          developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(2 * pivot - n.note, 0, 127) }));
        }
        break;
      case 3:
        if (intensity > 0.5) developedNotes = [...baseNotes].reverse();
        break;
    }
    if (rf() < 0.3) {
      this.responseMode = !this.responseMode;
      if (this.responseMode) {
        developedNotes = developedNotes.map((n, i) => ({ ...n, duration: (n.duration || 480) * (intensity + 0.5) }));
      }
    }
    this._lastBaseNotes = baseNotes;
    this._lastDevelopedNotes = developedNotes;
    return developedNotes;
  }

  setintensity(intensity) {
    this.intensity = clamp(intensity, 0, 1);
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
