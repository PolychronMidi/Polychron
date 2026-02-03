require('./ProgressionGenerator');
require('./ChordComposer');
require('./VoiceLeadingScore');

TensionReleaseComposer = class TensionReleaseComposer extends ChordComposer {
  constructor(key = 'C', quality = 'major', tensionCurve = 0.5) {
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
    const targetTension = this.tensionCurve * Math.sin(position * Math.PI);
    if (position > 0.85) {
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
        return super.noteSet(progression, direction === 'tension' ? 'R' : direction);
      }
    }

    if (!this.progression || this.progression.length === 0) { console.warn('TensionReleaseComposer.noteSet: no progression defined — skipping'); return; }
    if (direction !== 'tension') return super.noteSet(this.progression.map(c => c.symbol), direction);
    this.measureInSection = (this.measureInSection || 0) + 1;
    const position = (this.measureInSection % 16) / 16;
    const selectedChords = this.selectChordByTension(position);
    super.noteSet(selectedChords, 'R');
  }

  x() {
    this.noteSet('tension');
    return super.x();
  }
}
