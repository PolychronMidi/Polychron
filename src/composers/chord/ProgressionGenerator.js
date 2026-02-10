
ProgressionGenerator = class ProgressionGenerator {
  constructor(key, quality = 'major') {
    if (typeof key !== 'string' || key === '') throw new Error('ProgressionGenerator: key must be non-empty string');
    if (typeof quality !== 'string' || quality === '') throw new Error('ProgressionGenerator: quality must be non-empty string');
    this.key = key;
    this.quality = quality.toLowerCase();

    const modeToQuality = {
      'ionian': 'major', 'dorian': 'minor', 'phrygian': 'minor', 'lydian': 'major', 'mixolydian': 'major', 'aeolian': 'minor', 'locrian': 'minor', 'major': 'major', 'minor': 'minor'
    };
    if (!Object.prototype.hasOwnProperty.call(modeToQuality, this.quality)) {
      throw new Error(`ProgressionGenerator: unknown quality or mode "${quality}"`);
    }
    this.romanQuality = modeToQuality[this.quality];

    const keyApi = this.romanQuality === 'minor' ? t.Key.minorKey : t.Key.majorKey;
    const keyData = keyApi(key);
    this.scaleNotes = this.romanQuality === 'minor' ? keyData.natural.scale : keyData.scale;
    this.diatonicChords = this.romanQuality === 'minor' ? keyData.natural.chords : keyData.chords;
  }

  romanToChord(roman) {
    const degreeMatch = roman.match(/^([b#]?[IiVv]+)/);
    if (!degreeMatch) { console.warn('ProgressionGenerator.romanToChord: could not parse roman numeral:', roman); return null; }

    const degree = degreeMatch[1];
    const isFlat = degree.startsWith('b');
    const isSharp = degree.startsWith('#');
    const romanNumeral = degree.replace(/^[b#]/, '');
    const degreeIndex = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].findIndex(r => romanNumeral.toUpperCase() === r);
    if (degreeIndex === -1) { console.warn('ProgressionGenerator.romanToChord: unrecognized roman numeral:', roman); return null; }

    const diatonicChord = this.diatonicChords?.[degreeIndex];
    const diatonicRoot = this.scaleNotes?.[degreeIndex];
    if (!diatonicChord || !diatonicRoot) { console.warn(`ProgressionGenerator.romanToChord: missing diatonic data for degreeIndex=${degreeIndex}`); return null; }

    const chordParts = diatonicChord.match(/^([A-G][b#]?)(.*)$/);
    const baseRoot = chordParts?.[1] || diatonicRoot;
    const baseQuality = chordParts?.[2] || '';

    let quality = baseQuality;
    if (!/dim/.test(quality) && romanNumeral === romanNumeral.toLowerCase()) {
      quality = quality || 'm';
    }

    let rootNote = baseRoot;
    if (isFlat || isSharp) {
      const chromaticNote = t.Note.chroma(rootNote);
      const alteredChroma = isFlat ? chromaticNote - 1 : chromaticNote + 1;
      const pc = t.Note.fromMidi(alteredChroma);
      rootNote = t.Note.pitchClass(pc);
    }

    const extensions = roman.replace(/^[b#]?[IiVv]+/, '');
    return `${rootNote}${quality}${extensions}`;
  }

  generate(type) {
    const patterns = {
      major: {
        'I-IV-V': ['I', 'IV', 'V', 'I'],
        'I-V-vi-IV': ['I', 'V', 'vi', 'IV'],
        'ii-V-I': ['ii', 'V', 'I'],
        'I-vi-IV-V': ['I', 'vi', 'IV', 'V'],
        'circle': ['I', 'IV', 'vii', 'iii', 'vi', 'ii', 'V', 'I'],
        'blues': ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V']
      },
      minor: {
        'i-iv-v': ['i', 'iv', 'v', 'i'],
        'i-VI-VII': ['i', 'VI', 'VII', 'i'],
        'i-iv-VII': ['i', 'iv', 'VII', 'i'],
        'ii-V-i': ['ii', 'V', 'i'],
        'andalusian': ['i', 'VII', 'VI', 'v']
      }
    };

    const pattern = patterns[this.romanQuality || this.quality]?.[type];
    if (!pattern) {
      console.warn(`ProgressionGenerator.generate: unknown progression type "${type}", defaulting to "I-IV-V".`);
      return this.generate('I-IV-V');
    }

    return pattern.map(roman => this.romanToChord(roman)).filter(c => c !== null);
  }

  random() {
    const types = (this.romanQuality || this.quality) === 'major'
      ? ['I-IV-V', 'I-V-vi-IV', 'ii-V-I', 'I-vi-IV-V']
      : ['i-iv-v', 'i-VI-VII', 'i-iv-VII', 'ii-V-i'];
    const randomType = types[ri(types.length - 1)];
    return this.generate(randomType);
  }
}
