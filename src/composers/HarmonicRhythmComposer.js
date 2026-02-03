require('./ProgressionGenerator');
require('./ChordComposer');
require('./VoiceLeadingScore');

HarmonicRhythmComposer = class HarmonicRhythmComposer extends ChordComposer {
  constructor(progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major') {
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
    try { this.enableVoiceLeading(new VoiceLeadingScore()); } catch (e) { console.warn('HarmonicRhythmComposer: failed to enable VoiceLeadingScore, continuing without it:', e && e.stack ? e.stack : e); }
  }

  selectNoteWithLeading(candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates[0];
    try { if (this.VoiceLeadingScore && typeof this.VoiceLeadingScore.selectNextNote === 'function') return this.VoiceLeadingScore.selectNextNote(this.voiceHistory || [], candidates, {}); } catch (e) { console.warn('HarmonicRhythmComposer: selectNextNote failed, falling back:', e && e.stack ? e.stack : e); }
    return candidates[0];
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
}
