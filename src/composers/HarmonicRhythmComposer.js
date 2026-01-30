const ProgressionGenerator = require('./ProgressionGenerator');
const ChordComposer = require('./ChordComposer').ChordComposer || require('./ChordComposer');

class HarmonicRhythmComposer extends ChordComposer {
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
  }

  getCurrentChord() {
    const chordIndex = m.floor(this.measureCount / this.measuresPerChord) % this.progression.length;
    return this.progression[chordIndex].symbol || this.progression[chordIndex];
  }

  noteSet(progression, direction = 'R') {
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      if (firstItem === null) return;
      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;
      if (isStringArray || isChordArray) {
        return super.noteSet(progression, direction);
      }
    }
    if (!this.progression || this.progression.length === 0) return;
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

try { module.exports = HarmonicRhythmComposer; } catch (e) { /* swallow */ }
