factoryProgression = {
  normalizeProgressionKeyOrFail(key, label = 'FactoryManager.normalizeProgressionKeyOrFail') {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`${label}: key must be a non-empty string`);
    }
    if (!t || !t.Note || typeof t.Note.pitchClass !== 'function') {
      throw new Error(`${label}: tonal Note.pitchClass() not available`);
    }
    const pc = t.Note.pitchClass(key);
    if (typeof pc !== 'string' || pc.length === 0) {
      throw new Error(`${label}: could not normalize key "${key}" to pitch class`);
    }
    return pc;
  },

  getRomanQualityOrFail(quality, label = 'FactoryManager.getRomanQualityOrFail') {
    if (typeof quality !== 'string' || quality.length === 0) {
      throw new Error(`${label}: quality must be a non-empty string`);
    }
    const modeToQuality = {
      ionian: 'major', dorian: 'minor', phrygian: 'minor', lydian: 'major',
      mixolydian: 'major', aeolian: 'minor', locrian: 'minor', major: 'major', minor: 'minor'
    };
    const normalized = quality.toLowerCase();
    const romanQuality = modeToQuality[normalized];
    if (!romanQuality) {
      throw new Error(`${label}: unknown quality or mode "${quality}"`);
    }
    return romanQuality;
  },

  hasDiatonicKeyData(key, quality = 'major') {
    const romanQuality = this.getRomanQualityOrFail(quality, 'FactoryManager.hasDiatonicKeyData');
    const keyApi = romanQuality === 'minor' ? t.Key.minorKey : t.Key.majorKey;
    const keyData = keyApi(key);
    const scale = romanQuality === 'minor' ? keyData?.natural?.scale : keyData?.scale;
    const chords = romanQuality === 'minor' ? keyData?.natural?.chords : keyData?.chords;
    return Array.isArray(scale) && scale.length >= 7 && Array.isArray(chords) && chords.length >= 7;
  },

  getProgressionKeyPoolOrFail(quality = 'major') {
    if (!Array.isArray(allNotes) || allNotes.length === 0) {
      throw new Error('FactoryManager.getProgressionKeyPoolOrFail: allNotes not available');
    }
    this.getRomanQualityOrFail(quality, 'FactoryManager.getProgressionKeyPoolOrFail');
    const pcs = [];
    for (const candidate of allNotes) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue;
      const pc = (t && t.Note && typeof t.Note.pitchClass === 'function')
        ? t.Note.pitchClass(candidate)
        : null;
      if (typeof pc === 'string' && pc.length > 0 && this.hasDiatonicKeyData(pc, quality) && !pcs.includes(pc)) {
        pcs.push(pc);
      }
    }
    if (pcs.length === 0) {
      throw new Error(`FactoryManager.getProgressionKeyPoolOrFail: no valid pitch-class keys derived from allNotes for quality "${quality}"`);
    }
    return pcs;
  },

  resolveProgressionKeyOrFail(key, label = 'FactoryManager.resolveProgressionKeyOrFail', quality = 'major') {
    this.getRomanQualityOrFail(quality, `${label}.quality`);
    let input = key;
    if (key === 'random') {
      const keyPool = this.getProgressionKeyPoolOrFail(quality);
      input = keyPool[ri(keyPool.length - 1)];
    }
    const normalized = this.normalizeProgressionKeyOrFail(input, label);
    if (!this.hasDiatonicKeyData(normalized, quality)) {
      throw new Error(`${label}: key "${normalized}" does not provide full diatonic data for quality "${quality}"`);
    }
    return normalized;
  }
};
