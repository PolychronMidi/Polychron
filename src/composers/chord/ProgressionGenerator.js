ProgressionGenerator = class ProgressionGenerator {
  constructor(key, quality = 'major') {
    if (typeof key !== 'string' || key === '') throw new Error('ProgressionGenerator: key must be non-empty string');
    if (typeof quality !== 'string' || quality === '') throw new Error('ProgressionGenerator: quality must be non-empty string');
    this.key = key;
    this.quality = quality.toLowerCase();

    const modeToQuality = {
      ionian: 'major', dorian: 'minor', phrygian: 'minor', lydian: 'major',
      mixolydian: 'major', aeolian: 'minor', locrian: 'minor', major: 'major', minor: 'minor'
    };
    if (!Object.prototype.hasOwnProperty.call(modeToQuality, this.quality)) {
      throw new Error(`ProgressionGenerator: unknown quality or mode "${quality}"`);
    }
    this.romanQuality = modeToQuality[this.quality];

    const keyApi = this.romanQuality === 'minor' ? t.Key.minorKey : t.Key.majorKey;
    const keyData = keyApi(key);
    this.scaleNotes = this.romanQuality === 'minor' ? keyData.natural.scale : keyData.scale;
    this.diatonicChords = this.romanQuality === 'minor' ? keyData.natural.chords : keyData.chords;
    if (!Array.isArray(this.scaleNotes) || this.scaleNotes.length < 7 || !Array.isArray(this.diatonicChords) || this.diatonicChords.length < 7) {
      throw new Error(`ProgressionGenerator: invalid key data for key="${key}" quality="${quality}"`);
    }
  }

  getBuiltInPatternMap() {
    return {
      major: {
        'I-IV-V': ['I', 'IV', 'V', 'I'],
        'I-V-vi-IV': ['I', 'V', 'vi', 'IV'],
        'ii-V-I': ['ii', 'V', 'I'],
        'I-vi-IV-V': ['I', 'vi', 'IV', 'V'],
        circle: ['I', 'IV', 'vii', 'iii', 'vi', 'ii', 'V', 'I'],
        blues: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V']
      },
      minor: {
        'i-iv-v': ['i', 'iv', 'v', 'i'],
        'i-VI-VII': ['i', 'VI', 'VII', 'i'],
        'i-iv-VII': ['i', 'iv', 'VII', 'i'],
        'ii-V-i': ['ii', 'V', 'i'],
        andalusian: ['i', 'VII', 'VI', 'v']
      }
    };
  }

  getCombinedPatternMap() {
    const quality = this.romanQuality || this.quality;
    const builtIn = this.getBuiltInPatternMap()[quality];
    if (!builtIn || typeof builtIn !== 'object') {
      throw new Error(`ProgressionGenerator.getCombinedPatternMap: missing built-in patterns for quality "${quality}"`);
    }

    const merged = Object.assign({}, builtIn);
    if (typeof harmonicPriors !== 'undefined' && harmonicPriors) {
      const priorPatterns = harmonicPriors.getPatternSet(quality);
      for (const [name, romans] of Object.entries(priorPatterns)) {
        if (!Object.prototype.hasOwnProperty.call(merged, name)) {
          merged[name] = romans;
        }
      }
    }

    return merged;
  }

  romanToChord(roman) {
    if (typeof roman !== 'string' || roman === '') {
      throw new Error('ProgressionGenerator.romanToChord: roman must be a non-empty string');
    }
    const degreeMatch = roman.match(/^([b#]?[IiVv]+)/);
    if (!degreeMatch) {
      throw new Error(`ProgressionGenerator.romanToChord: could not parse roman numeral "${roman}"`);
    }

    const degree = degreeMatch[1];
    const isFlat = degree.startsWith('b');
    const isSharp = degree.startsWith('#');
    const romanNumeral = degree.replace(/^[b#]/, '');
    const degreeIndex = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].findIndex(r => romanNumeral.toUpperCase() === r);
    if (degreeIndex === -1) {
      throw new Error(`ProgressionGenerator.romanToChord: unrecognized roman numeral "${roman}"`);
    }

    const diatonicChord = this.diatonicChords?.[degreeIndex];
    const diatonicRoot = this.scaleNotes?.[degreeIndex];
    if (!diatonicChord || !diatonicRoot) {
      throw new Error(`ProgressionGenerator.romanToChord: missing diatonic data for degreeIndex=${degreeIndex}`);
    }

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
      if (typeof chromaticNote !== 'number') {
        throw new Error(`ProgressionGenerator.romanToChord: invalid chroma for root "${rootNote}"`);
      }
      const alteredChroma = isFlat ? chromaticNote - 1 : chromaticNote + 1;
      const pc = t.Note.fromMidi(alteredChroma);
      rootNote = t.Note.pitchClass(pc);
    }

    const extensions = roman.replace(/^[b#]?[IiVv]+/, '');
    const extensionSuffix = (typeof extensions === 'string') ? extensions : '';
    const qualitySuffix = (typeof quality === 'string') ? quality : '';
    const dedupedExtension = (extensionSuffix && qualitySuffix.endsWith(extensionSuffix)) ? '' : extensionSuffix;
    return `${rootNote}${qualitySuffix}${dedupedExtension}`;
  }

  resolvePhrasePhase(opts = {}) {
    if (opts && typeof opts.phase === 'string' && opts.phase.length > 0) {
      return opts.phase;
    }
    if (ComposerFactory && ComposerFactory.sharedPhraseArcManager) {
      const phase = ComposerFactory.sharedPhraseArcManager.getPhase();
      if (typeof phase === 'string' && phase.length > 0) {
        return phase;
      }
    }
    return 'development';
  }

  generate(type, opts = {}) {
    if (typeof type !== 'string' || type.length === 0) {
      throw new Error('ProgressionGenerator.generate: type must be a non-empty string');
    }

    const normalizedType = type.toLowerCase();
    if (normalizedType === 'corpus') {
      if (typeof harmonicPriors === 'undefined' || !harmonicPriors || typeof harmonicPriors.getRomanProgression !== 'function') {
        throw new Error('ProgressionGenerator.generate: harmonicPriors.getRomanProgression() not available for corpus mode');
      }
      const selection = harmonicPriors.getRomanProgression(this.romanQuality, Object.assign({}, opts, {
        phase: this.resolvePhrasePhase(opts)
      }));
      return selection.romans.map((roman) => this.romanToChord(roman));
    }

    const patterns = this.getCombinedPatternMap();
    const pattern = patterns[type];
    if (!pattern) {
      throw new Error(`ProgressionGenerator.generate: unknown progression type "${type}"`);
    }
    if (!Array.isArray(pattern) || pattern.length === 0) {
      throw new Error(`ProgressionGenerator.generate: progression pattern "${type}" is empty`);
    }

    return pattern.map((roman) => this.romanToChord(roman));
  }

  random(opts = {}) {
    // Check for a pending pivot chord bridge (first progression after a key change)
    if (PivotChordBridge && PivotChordBridge.hasBridge()) {
      return PivotChordBridge.consumeBridge();
    }

    const hasLegacyToggle = opts && typeof opts.useCorpus === 'boolean';
    const hasProfileToggle = opts && typeof opts.useCorpusHarmonicPriors === 'boolean';
    const useCorpus = hasLegacyToggle
      ? opts.useCorpus === true
      : hasProfileToggle
        ? opts.useCorpusHarmonicPriors === true
        : false;
    if (useCorpus && typeof harmonicPriors !== 'undefined' && harmonicPriors) {
      const corpusOpts = {
        ...opts,
        phase: this.resolvePhrasePhase(opts),
        ...(Number.isFinite(Number(opts && opts.corpusHarmonicStrength)) ? { cadenceStrength: clamp(Number(opts.corpusHarmonicStrength), 0, 1) } : {})
      };
      const selection = harmonicPriors.getRomanProgression(this.romanQuality, corpusOpts);
      return selection.romans.map((roman) => this.romanToChord(roman));
    }

    const fallbackTypes = (this.romanQuality === 'major')
      ? ['I-IV-V', 'I-V-vi-IV', 'ii-V-I', 'I-vi-IV-V']
      : ['i-iv-v', 'i-VI-VII', 'i-iv-VII', 'ii-V-i'];

    const randomType = fallbackTypes[ri(fallbackTypes.length - 1)];
    return this.generate(randomType, opts);
  }
};
