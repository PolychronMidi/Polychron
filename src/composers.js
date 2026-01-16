// @ts-check
// composers.js - Musical intelligence system with meter and composition generation.
// minimalist comments, details at: composers.md
// Imports modular composer files for code organization

// Import modular composers
// Note: In production, these would be explicit require/import statements
// For now, they're loaded via script tags in order:
// MeasureComposer.js, ScaleComposer.js, ChordComposer.js, ModeComposer.js, PentatonicComposer.js

/**
 * Composes meter-related values with randomization.
 * @class
 */
class MeasureComposer {
  constructor() {
    /** @type {number[]|null} Previous meter [numerator, denominator] */
    this.lastMeter=null;
    /** @type {number} Recursion depth counter for getNotes */
    this.recursionDepth=0;
    /** @type {number} Max allowed recursion depth */
    this.MAX_RECURSION=5;
    /** @type {VoiceLeadingScore|null} Optional voice leading optimizer */
    this.voiceLeading=null;
    /** @type {number[]} Historical notes for voice leading context */
    this.voiceHistory=[];
  }
  /** @returns {number} Random numerator from NUMERATOR config */
  getNumerator(){const{min,max,weights}=NUMERATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random denominator from DENOMINATOR config */
  getDenominator(){const{min,max,weights}=DENOMINATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random divisions count from DIVISIONS config */
  getDivisions(){const{min,max,weights}=DIVISIONS;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random subdivisions count from SUBDIVISIONS config */
  getSubdivisions(){const{min,max,weights}=SUBDIVISIONS;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random sub-subdivisions count from SUBSUBDIVS config */
  getSubsubdivs(){const{min,max,weights}=SUBSUBDIVS;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number} Random voice count from VOICES config */
  getVoices(){const{min,max,weights}=VOICES;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
  /** @returns {number[]} Two octaves with minimum 2-3 octave difference */
  getOctaveRange() { const { min,max,weights }=OCTAVE;
  let [o1,o2]=[rw(min,max,weights),rw(min,max,weights)];
  while (m.abs(o1-o2)<ri(2,3)) { o2=modClamp(o2+ri(-3,3),min,max); }
  return [ o1,o2 ];
  }
  /**
   * Generates a valid meter [numerator, denominator] with log-based ratio check.
   * @param {boolean} [ignoreRatioCheck=false] - Skip ratio validation
   * @param {boolean} [polyMeter=false] - Allow larger ratio jumps for polyrhythm
   * @param {number} [maxIterations=200] - Maximum attempts before fallback
   * @param {number} [timeLimitMs=100] - Maximum wall-clock time before fallback
   * @returns {number[]} [numerator, denominator]
   * @throws {Error} When max iterations exceeded and no valid meter found
   */
getMeter(ignoreRatioCheck=false, polyMeter=false, maxIterations=200, timeLimitMs=100) {
  // Constants for ratio validation
  const METER_RATIO_MIN = 0.25;
  const METER_RATIO_MAX = 4;
  const MIN_LOG_STEPS = 0.5;
  const FALLBACK_METER = [4, 4];

  let iterations=0;
  const maxLogSteps=polyMeter ? 4 : 2; // Log2 steps: 2 = ~4x ratio, 4 = ~16x ratio
  const startTs=Date.now();

  while (++iterations <= maxIterations && (Date.now() - startTs) <= timeLimitMs) {
    let newNumerator=this.getNumerator();
    let newDenominator=this.getDenominator();

    // Validate numerator and denominator are positive integers
    if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
      continue;
    }

    let newMeterRatio=newNumerator / newDenominator;

    // Check if new meter ratio is within acceptable range
    const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

    if (ratioValid) {
      if (this.lastMeter) {
        let lastMeterRatio=this.lastMeter[0] / this.lastMeter[1];
        // Log ratio: 0 = same, 1 = 2x, 2 = 4x, 3 = 8x, 4 = 16x difference
        let logSteps=m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
        if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps) {
          this.lastMeter=[newNumerator,newDenominator];
          return this.lastMeter;
        }
      } else {
        this.lastMeter=[newNumerator,newDenominator];
        return this.lastMeter;
      }
    }
  }

  // Log warning with diagnostic info
  console.warn(`getMeter() failed after ${iterations} iterations or ${(Date.now()-startTs)}ms. Ratio bounds: [${METER_RATIO_MIN}, ${METER_RATIO_MAX}]. LogSteps range: [${MIN_LOG_STEPS}, ${maxLogSteps}]. Returning fallback: [${FALLBACK_METER[0]}, ${FALLBACK_METER[1]}]`);
  this.lastMeter=FALLBACK_METER;
  return this.lastMeter;
}
  /**
   * Generates note objects within octave range.
   * @param {number[]|null} [octaveRange=null] - [min, max] octaves, or auto-generate
   * @returns {{note: number}[]} Array of note objects
   */
  getNotes(octaveRange=null) {
    if (++this.recursionDepth > this.MAX_RECURSION) {
      console.warn('getNotes recursion limit exceeded; returning fallback note 0');
      this.recursionDepth = 0;
      return [{ note: 0 }];
    }
    const uniqueNotes=new Set();
    const voices=this.getVoices();
    const [minOctave,maxOctave]=octaveRange || this.getOctaveRange();
    const rootNote=this.notes[ri(this.notes.length - 1)];
    let intervals=[],fallback=false;
    try {  const shift=ri();
      switch (ri(2)) {
        case 0:intervals=[0,2,3+shift,6-shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        case 1:intervals=[0,1,3+shift,5+shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1));  break;
        default:intervals=Array.from({length:this.notes.length},(_,i)=>i);  fallback=true;  }
      // Validate that all intervals are within scale bounds and produce valid scale degrees
      intervals = intervals.map(interval => {
        // Ensure interval is within valid range for the scale
        const validatedInterval = clamp(interval, 0, this.notes.length - 1);
        // Calculate the actual note index to verify it's within the scale
        const rootIndex = this.notes.indexOf(rootNote);
        const noteIndex = (rootIndex + validatedInterval) % this.notes.length;
        // Return the validated interval that produces a proper scale degree
        return validatedInterval;
      });
      return intervals.slice(0,voices).map((interval,index)=>{
        const noteIndex=(this.notes.indexOf(rootNote)+interval) % this.notes.length;
        let octave=ri(minOctave,maxOctave);
        let note=t.Note.chroma(this.notes[noteIndex])+12*octave;
        while (uniqueNotes.has(note)) {
          octave=octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave < OCTAVE.max ? octave++ : octave > OCTAVE.min ? octave-- : (()=>{ return false; })();
          if (octave===false) break; note=t.Note.chroma(this.notes[noteIndex])+12*octave;  }
        return { note };
      }).filter((noteObj,index,self)=>
        index===self.findIndex(n=>n.note===noteObj.note)
      ); }  catch (e) { if (!fallback) { this.recursionDepth--; return this.getNotes(octaveRange); } else {
      console.warn(e.message); this.recursionDepth--; return this.getNotes(octaveRange);  }}
    finally {
      this.recursionDepth--;
    }
  }

  /**
   * Enables voice leading optimization for this composer.
   * @param {VoiceLeadingScore} [scorer] - Optional custom voice leading scorer
   * @returns {void}
   */
  enableVoiceLeading(scorer) {
    this.voiceLeading = scorer || new VoiceLeadingScore();
    this.voiceHistory = [];
  }

  /**
   * Disables voice leading optimization.
   * @returns {void}
   */
  disableVoiceLeading() {
    this.voiceLeading = null;
    this.voiceHistory = [];
  }

  /**
   * Selects the best note from available candidates using voice leading cost function.
   * Falls back to random selection if voice leading is disabled.
   * @param {number[]} availableNotes - Pool of candidate notes
   * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
   * @returns {number} Selected note
   */
  selectNoteWithLeading(availableNotes, config = {}) {
    if (!this.voiceLeading || !availableNotes || availableNotes.length === 0) {
      return availableNotes?.[ri(availableNotes.length - 1)] ?? 60;
    }

    const selectedNote = this.voiceLeading.selectNextNote(this.voiceHistory, availableNotes, config);
    this.voiceHistory.push(selectedNote);

    // Keep history shallow for memory efficiency
    if (this.voiceHistory.length > 4) {
      this.voiceHistory.shift();
    }

    return selectedNote;
  }

  /**
   * Resets voice leading history (call at section boundaries).
   * @returns {void}
   */
  resetVoiceLeading() {
    this.voiceHistory = [];
    if (this.voiceLeading) {
      this.voiceLeading.reset();
    }
  }
}

/**
 * Composes notes from a specific scale.
 * @extends MeasureComposer
 */
class ScaleComposer extends MeasureComposer {
  /**
   * @param {string} scaleName - e.g., 'major', 'minor'
   * @param {string} root - e.g., 'C', 'D#'
   */
  constructor(scaleName,root) {
    super();
    this.root=root;
    this.noteSet(scaleName,root);
  }
  /**
   * Sets scale and extracts notes.
   * @param {string} scaleName
   * @param {string} root
   */
  noteSet(scaleName,root) {
    this.scale=t.Scale.get(`${root} ${scaleName}`);
    this.notes=this.scale.notes;
  }
  /** @returns {{note: number}[]} Scale notes */
  x=()=>this.getNotes();
}
/**
 * Random scale selection from all available scales.
 * @extends ScaleComposer
 */
class RandomScaleComposer extends ScaleComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects scale and root from venue.js data */
  noteSet() {
    const randomScale=allScales[ri(allScales.length - 1)];
    const randomRoot=allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomScale,randomRoot);
  }
  /** @returns {{note: number}[]} Random scale notes */
  x() { this.noteSet(); return super.x(); }
}
/**
 * Composes notes from a chord progression.
 * @extends MeasureComposer
 */
/**
 * Normalizes enharmonic chord symbols to their simplest form.
 * @param {string} chordSymbol - Original chord symbol
 * @returns {string} Normalized chord symbol
 */
function normalizeChordSymbol(chordSymbol) {
  // Handle double accidentals and awkward enharmonics
  const enharmonicMap = {
    'B#': 'C', 'E#': 'F', 'Cb': 'B', 'Fb': 'E',
    'Bb#': 'B', 'Eb#': 'E', 'Ab#': 'A', 'Db#': 'D', 'Gb#': 'G',
    'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'
  };

  let normalized = chordSymbol;

  // Try longer patterns first (double accidentals)
  for (const [from, to] of Object.entries(enharmonicMap).sort((a, b) => b[0].length - a[0].length)) {
    if (normalized.startsWith(from)) {
      normalized = to + normalized.slice(from.length);
      break;
    }
  }

  return normalized;
}

class ChordComposer extends MeasureComposer {
  /**
   * @param {string[]} progression - Array of chord symbols, e.g., ['CM', 'Dm', 'Em']
   */
  constructor(progression) {
    super();
    this.noteSet(progression,'R');
  }
  /**
   * Sets progression and validates chords.
   * @param {string[]} progression
   * @param {string} [direction='R'] - 'R' (right), 'L' (left), 'E' (either), '?' (random)
   */
  noteSet(progression,direction='R') {
    const validatedProgression=progression.map(normalizeChordSymbol).filter(chordSymbol=>{
      const chord = t.Chord.get(chordSymbol);
      if (chord.empty) {
        console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;
      }
      return true;
    });
    if (validatedProgression.length===0) {console.warn('No valid chords in progression');
    } else {
      this.progression=validatedProgression.map(t.Chord.get);
      this.currentChordIndex=this.currentChordIndex || 0;
      let next;
      switch (direction.toUpperCase()) {
        case 'R': next=1; break;
        case 'L': next=-1; break;
        case 'E': next=rf() < .5 ? 1 : -1; break;
        case '?': next=ri(-2,2); break;
        default:console.warn('Invalid direction,defaulting to right'); next=1;
      }
      let startingMeasure=measureCount;
      let progressChord=measureCount>startingMeasure || rf()<.05;
      if (progressChord && typeof subdivStart !== 'undefined') { allNotesOff(subdivStart); startingMeasure=measureCount; }
      this.currentChordIndex+= progressChord ? next % (this.progression.length) : 0;
      this.currentChordIndex=(this.currentChordIndex+this.progression.length)%this.progression.length;
      this.notes=this.progression[this.currentChordIndex].notes;
    }
  }
  /** @returns {{note: number}[]} Chord notes */
  x=()=>this.getNotes();
}
/**
 * Random chord progression from all available chords.
 * @extends ChordComposer
 */
class RandomChordComposer extends ChordComposer {
  constructor() {
    super([]);
    this.noteSet();
  }
  /** Generates 2-5 random chords */
  noteSet() {
    const progressionLength=ri(2,5);
    const randomProgression=[];
    for (let i=0; i < progressionLength; i++) {
      const randomChord=allChords[ri(allChords.length - 1)];
      randomProgression.push(randomChord);
    }
    super.noteSet(randomProgression,'?');
  }
  /** @returns {{note: number}[]} Random progression notes */
  x() { this.noteSet(); return super.x(); }
}
/**
 * Composes notes from a specific mode.
 * @extends MeasureComposer
 */
class ModeComposer extends MeasureComposer {
  /**
   * @param {string} modeName - e.g., 'ionian', 'aeolian'
   * @param {string} root - e.g., 'A', 'C'
   */
  constructor(modeName,root) {
    super();
    this.root=root;
    this.noteSet(modeName,root);
  }
  /**
   * Sets mode and extracts notes.
   * @param {string} modeName
   * @param {string} root
   */
  noteSet(modeName,root) {
    this.mode=t.Mode.get(modeName);
    this.notes=t.Mode.notes(this.mode,root);
  }
  /** @returns {{note: number}[]} Mode notes */
  x=()=>this.getNotes();
}
/**
 * Random mode selection from all available modes.
 * @extends ModeComposer
 */
class RandomModeComposer extends ModeComposer {
  constructor() {
    super('','');
    this.noteSet();
  }
  /** Randomly selects mode and root from venue.js data */
  noteSet() {
    const randomMode=allModes[ri(allModes.length - 1)];
    const [root,modeName]=randomMode.split(' ');
    this.root=root;
    super.noteSet(modeName,root);
  }
  /** @returns {{note: number}[]} Random mode notes */
  x() { this.noteSet(); return super.x(); }
}

// Centralized factory for composer creation (avoids eval and keeps config typed)
/**
 * Composes notes from pentatonic scales with specialized voicing.
 * Pentatonics avoid semitone intervals, creating open, consonant harmonies.
 * @extends MeasureComposer
 */
/**
 * Generates common harmonic progressions using Roman numeral analysis.
 * @class
 */
class ProgressionGenerator {
  /**
   * @param {string} key - Root key (e.g., 'C', 'Am')
   * @param {string} [quality='major'] - 'major' or 'minor'
   */
  constructor(key, quality = 'major') {
    this.key = key;
    this.quality = quality.toLowerCase();
    this.scale = t.Scale.get(`${key} ${quality}`);

    // Map modes to parent quality for Roman numeral analysis
    const modeToQuality = {
      'ionian': 'major',
      'dorian': 'minor',
      'phrygian': 'minor',
      'lydian': 'major',
      'mixolydian': 'major',
      'aeolian': 'minor',
      'locrian': 'minor',
      'major': 'major',
      'minor': 'minor'
    };
    this.romanQuality = modeToQuality[this.quality] || 'major';

    // Pull diatonic data directly from Tonal Key helpers to avoid manual maps
    const keyApi = this.romanQuality === 'minor' ? t.Key.minorKey : t.Key.majorKey;
    const keyData = keyApi(key);
    this.scaleNotes = this.romanQuality === 'minor' ? keyData.natural.scale : keyData.scale;
    this.diatonicChords = this.romanQuality === 'minor' ? keyData.natural.chords : keyData.chords;
  }

  /**
   * Converts Roman numeral to chord symbol.
   * @param {string} roman - Roman numeral (e.g., 'I', 'ii', 'V7')
   * @returns {string} Chord symbol
   */
  romanToChord(roman) {
    const degreeMatch = roman.match(/^([b#]?[IiVv]+)/);
    if (!degreeMatch) return null;

    const degree = degreeMatch[1];

    // Get scale degree (convert Roman to index), handling accidentals
    const isFlat = degree.startsWith('b');
    const isSharp = degree.startsWith('#');
    const romanNumeral = degree.replace(/^[b#]/, '');
    const degreeIndex = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].findIndex(
      r => romanNumeral.toUpperCase() === r
    );
    if (degreeIndex === -1) return null;

    const diatonicChord = this.diatonicChords?.[degreeIndex];
    const diatonicRoot = this.scaleNotes?.[degreeIndex];
    if (!diatonicChord || !diatonicRoot) return null;

    const chordParts = diatonicChord.match(/^([A-G][b#]?)(.*)$/);
    const baseRoot = chordParts?.[1] || diatonicRoot;
    const baseQuality = chordParts?.[2] || '';

    // Honor Roman-case intent: lowercase forces minor when not diminished; leave majors as Tonal emits
    let quality = baseQuality;
    if (!/dim/.test(quality) && romanNumeral === romanNumeral.toLowerCase()) {
      quality = quality || 'm';
    }

    let rootNote = baseRoot;

    // Handle accidentals
    if (isFlat || isSharp) {
      const chromaticNote = t.Note.chroma(rootNote);
      const alteredChroma = isFlat ? chromaticNote - 1 : chromaticNote + 1;
      const pc = t.Note.fromMidi(alteredChroma);
      rootNote = t.Note.pitchClass(pc);
    }

    const extensions = roman.replace(/^[b#]?[IiVv]+/, ''); // 7, 9, etc.
    return `${rootNote}${quality}${extensions}`;
  }

  /**
   * Generates common progression patterns.
   * @param {string} type - Progression type
   * @returns {string[]} Array of chord symbols
   */
  generate(type) {
    const patterns = {
      major: {
        'I-IV-V': ['I', 'IV', 'V', 'I'],
        'I-V-vi-IV': ['I', 'V', 'vi', 'IV'], // Pop progression
        'ii-V-I': ['ii', 'V', 'I'], // Jazz turnaround
        'I-vi-IV-V': ['I', 'vi', 'IV', 'V'], // '50s progression
        'circle': ['I', 'IV', 'vii', 'iii', 'vi', 'ii', 'V', 'I'], // Circle of fifths
        'blues': ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'] // 12-bar blues
      },
      minor: {
        'i-iv-v': ['i', 'iv', 'v', 'i'],
        'i-VI-VII': ['i', 'VI', 'VII', 'i'], // Minor rock
        'i-iv-VII': ['i', 'iv', 'VII', 'i'],
        'ii-V-i': ['ii', 'V', 'i'], // Minor jazz
        'andalusian': ['i', 'VII', 'VI', 'v'] // Andalusian cadence (v not V in minor)
      }
    };

    const pattern = patterns[this.romanQuality || this.quality]?.[type];
    if (!pattern) {
      console.warn(`Unknown progression type: ${type}, using I-IV-V`);
      return this.generate('I-IV-V');
    }

    return pattern.map(roman => this.romanToChord(roman)).filter(c => c !== null);
  }

  /**
   * Generates a random common progression.
   * @returns {string[]} Array of chord symbols
   */
  random() {
    const types = (this.romanQuality || this.quality) === 'major'
      ? ['I-IV-V', 'I-V-vi-IV', 'ii-V-I', 'I-vi-IV-V']
      : ['i-iv-v', 'i-VI-VII', 'i-iv-VII', 'ii-V-i'];
    const randomType = types[ri(types.length - 1)];
    return this.generate(randomType);
  }
}

/**
 * Composer that manages harmonic tension and release curves.
 * Uses chord function theory (tonic, subdominant, dominant) to create satisfying progressions.
 * @extends ChordComposer
 */
class TensionReleaseComposer extends ChordComposer {
  /**
   * @param {string} key - Root key
   * @param {string} [quality='major'] - 'major' or 'minor'
   * @param {number} [tensionCurve=0.5] - 0 = constant tonic, 1 = high tension
   */
  constructor(key = 'C', quality = 'major', tensionCurve = 0.5) {
    const generator = new ProgressionGenerator(key, quality);
    const progressionChords = generator.random();

    // Call parent with the progression
    super(progressionChords);

    // Set additional properties after parent initialization
    this.generator = generator;
    this.tensionCurve = clamp(tensionCurve, 0, 1);
    this.key = key;
    this.quality = quality;
    this.measureInSection = 0;
  }

  /**
   * Calculates harmonic tension level (0 = tonic/stable, 1 = dominant/unstable).
   * @param {string} chordSymbol - Chord to analyze
   * @returns {number} Tension level 0-1
   */
  calculateTension(chordSymbol) {
    const chord = t.Chord.get(chordSymbol);
    const root = chord.tonic;
    const scaleIndex = this.generator.scale.notes.indexOf(root);

    // Tonic function (I, vi) = low tension
    if ([0, 5].includes(scaleIndex)) return 0.2;
    // Subdominant (ii, IV) = medium tension
    if ([1, 3].includes(scaleIndex)) return 0.5;
    // Dominant (V, vii) = high tension
    if ([4, 6].includes(scaleIndex)) return 0.9;

    return 0.5; // Default medium tension
  }

  /**
   * Selects next chord based on current tension curve position.
   * @param {number} position - Position in phrase (0-1)
   * @returns {string[]} Chord progression for this measure
   */
  selectChordByTension(position) {
    const targetTension = this.tensionCurve * Math.sin(position * Math.PI);

    // At end of phrase, resolve to tonic
    if (position > 0.85) {
      return this.generator.generate('I-IV-V').slice(-1); // Return to I
    }

    // Select chord matching target tension
    const allProgressions = [
      ...this.generator.generate('I-IV-V'),
      ...this.generator.generate('ii-V-I'),
      ...this.generator.generate('I-vi-IV-V')
    ];

    // Find chord with tension closest to target
    let bestChord = allProgressions[0];
    let bestDiff = Infinity;

    for (const chord of allProgressions) {
      const tension = this.calculateTension(chord);
      const diff = Math.abs(tension - targetTension);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestChord = chord;
      }
    }

    return [bestChord];
  }

  /**
   * Overrides parent noteSet to implement tension-based progression.
   * @param {string} [direction='tension'] - 'tension' uses curve, others use parent behavior
   */
  noteSet(progression, direction = 'tension') {
    // If called with a progression array (from constructor), just pass through
    // Check if it's either string symbols OR Chord objects
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      // Skip null values
      if (firstItem === null) return;

      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;

      if (isStringArray || isChordArray) {
        return super.noteSet(progression, direction === 'tension' ? 'R' : direction);
      }
    }

    // Guard against being called before progression is initialized
    if (!this.progression || this.progression.length === 0) {
      return;
    }

    // Otherwise, we're being called after construction
    if (direction !== 'tension') {
      return super.noteSet(this.progression.map(c => c.symbol), direction);
    }

    this.measureInSection = (this.measureInSection || 0) + 1;
    const position = (this.measureInSection % 16) / 16; // 16-measure cycle

    const selectedChords = this.selectChordByTension(position);
    super.noteSet(selectedChords, 'R');
  }

  /** @returns {{note: number}[]} Tension-release notes */
  x() {
    this.noteSet('tension');
    return super.x();
  }
}

/**
 * Composer that borrows chords from parallel modes for color and variety.
 * E.g., in C major, borrow from C minor, C dorian, C mixolydian, etc.
 * @extends ChordComposer
 */
class ModalInterchangeComposer extends ChordComposer {
  /**
   * @param {string} key - Root key
   * @param {string} [primaryMode='major'] - Primary mode ('major' or 'minor')
   * @param {number} [borrowProbability=0.25] - Chance to borrow (0-1)
   */
  constructor(key = 'C', primaryMode = 'major', borrowProbability = 0.25) {
    const generator = new ProgressionGenerator(key, primaryMode);
    const progressionChords = generator.random();

    // Call parent with the progression
    super(progressionChords);

    // Set additional properties after parent initialization
    this.key = key;
    this.primaryMode = primaryMode;
    this.borrowProbability = clamp(borrowProbability, 0, 1);
    this.generator = generator;

    // Define parallel modes to borrow from
    this.borrowModes = primaryMode === 'major'
      ? ['minor', 'dorian', 'mixolydian', 'lydian']
      : ['major', 'dorian', 'phrygian', 'locrian'];
  }

  /**
   * Borrows a chord from a parallel mode.
   * @returns {string} Borrowed chord symbol
   */
  borrowChord() {
    const modeIndex = ri(this.borrowModes.length - 1);
    const borrowMode = this.borrowModes[modeIndex];

    // Get scale degrees from borrowed mode
    const borrowScale = t.Scale.get(`${this.key} ${borrowMode}`);
    if (!borrowScale.notes || borrowScale.notes.length === 0) {
      return this.progression[this.currentChordIndex].symbol;
    }

    // Common borrowed chords
    const borrowPatterns = {
      major: {
        minor: ['iv', 'bVI', 'bVII'], // Borrow from parallel minor
        dorian: ['ii', 'IV'],
        mixolydian: ['bVII'],
        lydian: ['#IV']
      },
      minor: {
        major: ['IV', 'V', 'I'], // Borrow from parallel major
        dorian: ['IV', 'vi'],
        phrygian: ['bII'],
        locrian: ['v']
      }
    };

    const patterns = borrowPatterns[this.primaryMode]?.[borrowMode];
    if (!patterns || patterns.length === 0) {
      return this.progression[this.currentChordIndex].symbol;
    }

    // Create temporary generator for borrowed mode
    const borrowGenerator = new ProgressionGenerator(this.key, borrowMode);
    const romanNumeral = patterns[ri(patterns.length - 1)];
    const borrowedChord = borrowGenerator.romanToChord(romanNumeral);

    return borrowedChord || this.progression[this.currentChordIndex].symbol;
  }

  /**
   * Overrides parent noteSet to occasionally substitute borrowed chords.
   * @param {string[]} [progression] - Optional progression override
   * @param {string} [direction='R'] - Progression direction
   */
  noteSet(progression, direction = 'R') {
    // During construction, progression will be passed - either strings or Chord objects
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      // Skip null values
      if (firstItem === null) return;

      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;

      if (isStringArray || isChordArray) {
        return super.noteSet(progression, direction);
      }
    }

    // Guard against being called before progression is initialized
    if (!this.progression || this.progression.length === 0) {
      return;
    }

    // Decide whether to borrow a chord this time
    if (rf() < this.borrowProbability) {
      const borrowedChord = this.borrowChord();

      // Temporarily modify progression with borrowed chord
      const modifiedProgression = [...this.progression.map(c => c.symbol)];
      modifiedProgression[this.currentChordIndex % modifiedProgression.length] = borrowedChord;

      super.noteSet(modifiedProgression, direction);
    } else {
      // Use original progression
      super.noteSet(this.progression.map(c => c.symbol), direction);
    }
  }

  /** @returns {{note: number}[]} Modal interchange notes */
  x() {
    this.noteSet();
    return super.x();
  }
}


/**
 * Harmonic rhythm control - changes chords at specified measure intervals.
 * Implements Phase 2.2: Dynamic Harmonic Progressions
 * @extends ChordComposer
 */
class HarmonicRhythmComposer extends ChordComposer {
  /**
   * @param {string} [progression=['I','IV','V','I']] - Progression as roman numerals or chord symbols
   * @param {string} [key='C'] - Root key for roman numeral conversion
   * @param {number} [measuresPerChord=2] - How many measures each chord lasts (1-8)
   * @param {string} [quality='major'] - 'major' or 'minor' for key context
   */
  constructor(progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major') {
    // Convert roman numerals to chord symbols if needed
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

  /**
   * Calculate which chord should play at current measure.
   * @returns {string} Current chord symbol
   */
  getCurrentChord() {
    const chordIndex = m.floor(this.measureCount / this.measuresPerChord) % this.progression.length;
    return this.progression[chordIndex].symbol || this.progression[chordIndex];
  }

  /**
   * Overrides parent to return current chord based on harmonic rhythm.
   * @param {string[]} [progression] - Optional override
   * @param {string} [direction='R'] - Direction (unused, harmonic rhythm controls)
   */
  /**
   * Overrides parent to return current chord based on harmonic rhythm.
   * @param {string[]} [progression] - Optional override
   * @param {string} [direction='R'] - Direction (unused, harmonic rhythm controls)
   */
  noteSet(progression, direction = 'R') {
    // If called from parent constructor - progression will be either string symbols or Chord objects
    if (progression && Array.isArray(progression) && progression.length > 0) {
      const firstItem = progression[0];
      // Skip null values
      if (firstItem === null) return;

      const isStringArray = typeof firstItem === 'string';
      const isChordArray = typeof firstItem === 'object' && firstItem !== null && firstItem.symbol;

      if (isStringArray || isChordArray) {
        return super.noteSet(progression, direction);
      }
    }

    // Guard against being called before progression is initialized
    if (!this.progression || this.progression.length === 0) {
      return;
    }

    // Get current chord based on harmonic rhythm
    const currentChord = this.getCurrentChord();
    super.noteSet([currentChord], 'R');
    this.measureCount++;
  }

  /**
   * Set harmonic rhythm (measures per chord).
   * @param {number} measures - Measures each chord lasts
   */
  setHarmonicRhythm(measures) {
    this.measuresPerChord = clamp(measures, 1, 8);
    this.measureCount = 0;
  }

  /**
   * Change to a new progression at next chord boundary.
   * @param {string[]} newProgression - New chord progression
   */
  changeProgression(newProgression) {
    // Reset to next chord boundary
    this.measureCount = m.ceil(this.measureCount / this.measuresPerChord) * this.measuresPerChord;
    super.noteSet(newProgression, 'R');
  }

  /** @returns {{note: number}[]} Harmonic rhythm notes */
  getNotes(octaveRange) {
    // Ensure noteSet is called to initialize state
    if (!this.progression || this.progression.length === 0) {
      // Fallback: return a basic note if progression is empty
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

/**
 * Phase 2.3: Melodic Development
 * Develops melodies through motif transformations and call-and-response patterns.
 * Extends ScaleComposer to apply motif-based development to scale-derived melodies.
 * @extends ScaleComposer
 */
class MelodicDevelopmentComposer extends ScaleComposer {
  /**
   * @param {string} [name='major'] - Scale name (major, minor, pentatonic, etc.)
   * @param {string} [root='C'] - Root note
   * @param {number} [developmentIntensity=0.5] - How aggressively to transform (0-1)
   */
  constructor(name = 'major', root = 'C', developmentIntensity = 0.5) {
    // Handle random root
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    this.developmentIntensity = clamp(developmentIntensity, 0, 1);
    this.motifPhase = 0;  // Current stage of motif development
    this.measureCount = 0;
    this.responseMode = false;  // Alternate between call and response
    this.transpositionOffset = 0;  // Track transposition for melodic variation
  }

  /**
   * Overrides parent to apply motif-based transformations to generated notes.
   * Cycles through original, transposed, inverted, and retrograde variations.
   */
  getNotes(octaveRange) {
    const baseNotes = super.getNotes(octaveRange);

    if (baseNotes.length === 0) {
      return baseNotes;
    }

    this.measureCount++;
    const phase = m.floor((this.measureCount - 1) / 2) % 4;  // 4 phases: original, transpose, invert, retrograde

    // Decide development transformation based on phase
    let developedNotes = [...baseNotes];
    const intensity = this.developmentIntensity;

    switch (phase) {
      case 0:
        // Original motif (slight transposition for variety)
        this.transpositionOffset = intensity > 0.5 ? ri(-2, 2) : 0;
        developedNotes = baseNotes.map((n, i) => ({
          ...n,
          note: clamp(n.note + this.transpositionOffset, 0, 127)
        }));
        break;

      case 1:
        // Transposed variation - shift by interval based on intensity
        this.transpositionOffset = m.round(intensity * 7);  // Up to a fifth
        developedNotes = baseNotes.map(n => ({
          ...n,
          note: clamp(n.note + this.transpositionOffset, 0, 127)
        }));
        break;

      case 2:
        // Inverted variation
        if (intensity > 0.3) {
          const pivot = baseNotes[0]?.note || 60;
          developedNotes = baseNotes.map((n, i) => ({
            ...n,
            note: clamp(2 * pivot - n.note, 0, 127)
          }));
        }
        break;

      case 3:
        // Retrograde (reversed) variation
        if (intensity > 0.5) {
          developedNotes = [...baseNotes].reverse();
        }
        break;
    }

    // Apply call-and-response pattern if enabled
    if (rf() < 0.3) {
      this.responseMode = !this.responseMode;
      if (this.responseMode) {
        // Response: echo with different rhythm/dynamics
        developedNotes = developedNotes.map((n, i) => ({
          ...n,
          duration: (n.duration || 480) * (intensity + 0.5)
        }));
      }
    }

    return developedNotes;
  }

  /**
   * Set development intensity (0=minimal transformation, 1=maximum variation).
   * @param {number} intensity - Development intensity level
   */
  setDevelopmentIntensity(intensity) {
    this.developmentIntensity = clamp(intensity, 0, 1);
  }

  /**
   * Reset motif phase to beginning for new section.
   */
  resetMotifPhase() {
    this.motifPhase = 0;
    this.measureCount = 0;
    this.responseMode = false;
    this.transpositionOffset = 0;
  }
}

/**
 * Phase 2.4: Advanced Voice Leading
 * Extends voice leading with figured bass analysis and common-tone retention.
 * Creates more sophisticated chord voicings with smooth voice motion.
 * @extends ScaleComposer
 */
class AdvancedVoiceLeadingComposer extends ScaleComposer {
  /**
   * @param {string} [name='major'] - Scale name
   * @param {string} [root='C'] - Root note
   * @param {number} [commonToneWeight=0.7] - Priority for common-tone retention (0-1)
   */
  constructor(name = 'major', root = 'C', commonToneWeight = 0.7) {
    // Handle random root and scale
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    this.commonToneWeight = clamp(commonToneWeight, 0, 1);
    this.previousNotes = [];  // Track previous voicing for smooth motion
    this.voiceBalanceThreshold = 3;  // Semitones - max range variation allowed
    this.contraryMotionPreference = 0.4;  // Probability of contrary motion
  }

  /**
   * Analyzes and selects notes with voice leading awareness.
   * Prioritizes common tones and smooth voice motion.
   */
  getNotes(octaveRange) {
    const baseNotes = super.getNotes(octaveRange);

    if (!baseNotes || baseNotes.length === 0) {
      return baseNotes;
    }

    if (this.previousNotes.length === 0) {
      this.previousNotes = baseNotes;
      return baseNotes;
    }

    // Apply voice leading optimization
    const optimizedNotes = this.optimizeVoiceLeading(baseNotes);
    this.previousNotes = optimizedNotes;

    return optimizedNotes;
  }

  /**
   * Optimizes voicing by retaining common tones and avoiding large leaps.
   * @private
   */
  optimizeVoiceLeading(newNotes) {
    const result = [];
    const prevByVoice = [...this.previousNotes];

    for (let voiceIdx = 0; voiceIdx < newNotes.length && voiceIdx < prevByVoice.length; voiceIdx++) {
      const newNote = newNotes[voiceIdx];
      const prevNote = prevByVoice[voiceIdx];

      if (!newNote || !prevNote) {
        result.push(newNote || prevNote);
        continue;
      }

      // Check if common tone exists (same pitch class)
      const newPC = newNote.note % 12;
      const prevPC = prevNote.note % 12;

      if (newPC === prevPC && rf() < this.commonToneWeight) {
        // Retain common tone - stay in same octave or nearby
        result.push({
          ...newNote,
          note: prevNote.note  // Keep same octave as previous note
        });
      } else {
        // Find closest note in new voicing that moves smoothly
        const step = rf() < this.contraryMotionPreference ? ri(-4, -1) : ri(1, 4);
        result.push({
          ...newNote,
          note: clamp(prevNote.note + step, 0, 127)
        });
      }
    }

    return result;
  }

  /**
   * Set priority for common-tone retention.
   * @param {number} weight - 0-1 where 1 = always retain common tones
   */
  setCommonToneWeight(weight) {
    this.commonToneWeight = clamp(weight, 0, 1);
  }

  /**
   * Set preference for contrary motion (opposite direction movement between voices).
   * @param {number} probability - 0-1 probability of using contrary motion
   */
  setContraryMotionPreference(probability) {
    this.contraryMotionPreference = clamp(probability, 0, 1);
  }

  /**
   * Analyze figured bass for current voicing (simplified version).
   * Returns bass note and interval stack above it.
   * @private
   */
  analyzeFiguredBass(notes) {
    if (!notes || notes.length === 0) return null;

    const bass = m.min(...notes.map(n => n.note));
    const intervals = notes
      .map(n => n.note - bass)
      .filter((v, i, arr) => arr.indexOf(v) === i)  // unique
      .sort((a, b) => a - b);

    return { bass, intervals };
  }
}
class PentatonicComposer extends MeasureComposer {
  /**
   * @param {string} [root='C'] - Root note
   * @param {string} [type='major'] - 'major' (1-2-3-5-6) or 'minor' (1-b3-4-5-b7)
   */
  constructor(root = 'C', type = 'major') {
    super();
    this.root = root;
    this.type = type;
    this.noteSet(root, type);
  }

  /**
   * Sets pentatonic scale notes.
   * @param {string} root - Root note
   * @param {string} type - 'major' or 'minor'
   */
  noteSet(root, type = 'major') {
    this.root = root;
    this.type = type.toLowerCase();

    // Get pentatonic scale from Tonal
    const scaleName = this.type === 'minor' ? 'minor pentatonic' : 'major pentatonic';
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;

    // Fallback if scale not found: pick random root
    if (!this.notes || this.notes.length === 0) {
      console.warn(`Pentatonic scale not found for ${root} ${type}, using random root`);
      this.root = allNotes[ri(allNotes.length - 1)];
      this.type = rf() < 0.5 ? 'major' : 'minor';
      const fallbackScaleName = this.type === 'minor' ? 'minor pentatonic' : 'major pentatonic';
      this.scale = t.Scale.get(`${this.root} ${fallbackScaleName}`);
      this.notes = this.scale.notes;
    }
  }

  /**
   * Generates pentatonic notes with open voicing preference.
   * @param {number[]|null} [octaveRange=null] - [min, max] octaves
   * @returns {{note: number}[]} Array of note objects
   */
  getNotes(octaveRange = null) {
    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const voices = this.getVoices();
    const uniqueNotes = new Set();
    const result = [];

    // Pentatonic intervals emphasizing open voicing (4th, 5th intervals preferred)
    const openIntervals = [0, 2, 4]; // Root, major 2nd/3rd, perfect 4th/5th positions

    for (let i = 0; i < voices && i < this.notes.length; i++) {
      const intervalIndex = openIntervals[i % openIntervals.length];
      const noteIndex = intervalIndex % this.notes.length;
      let octave = ri(minOctave, maxOctave);

      // Spread voices across octaves for open sound
      if (i > 0 && voices > 2) {
        octave = minOctave + Math.floor(i * (maxOctave - minOctave) / (voices - 1));
      }

      let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;

      // Avoid note doubling
      let attempts = 0;
      while (uniqueNotes.has(note) && attempts < 12) {
        octave = ri(minOctave, maxOctave);
        note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        attempts++;
      }

      if (!uniqueNotes.has(note)) {
        uniqueNotes.add(note);
        result.push({ note });
      }
    }

    return result;
  }

  /** @returns {{note: number}[]} Pentatonic notes */
  x = () => this.getNotes();
}

/**
 * Random pentatonic scale selection.
 * @extends PentatonicComposer
 */
class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    super();
    this.noteSet();
  }

  /** Randomly selects pentatonic type and root */
  noteSet() {
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomType = rf() < 0.5 ? 'major' : 'minor';
    super.noteSet(randomRoot, randomType);
  }

  /** @returns {{note: number}[]} Random pentatonic notes */
  x() {
    this.noteSet();
    return super.x();
  }
}

class ComposerFactory {
  static constructors = {
    measure: () => new MeasureComposer(),
    scale: ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ScaleComposer(n, r);
    },
    chords: ({ progression = ['C'] } = {}) => {
      let p = progression;
      if (progression === 'random') {
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) {
          p.push(allChords[ri(allChords.length - 1)]);
        }
      }
      return new ChordComposer(p);
    },
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? allModes[ri(allModes.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ModeComposer(n, r);
    },
    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new PentatonicComposer(r, t);
    },
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) => new TensionReleaseComposer(key, quality, tensionCurve),
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => new ModalInterchangeComposer(key, primaryMode, borrowProbability),
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => new HarmonicRhythmComposer(progression, key, measuresPerChord, quality),
    melodicDevelopment: ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) => new MelodicDevelopmentComposer(name, root, developmentIntensity),
    advancedVoiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new AdvancedVoiceLeadingComposer(name, root, commonToneWeight),
  };

  /**
   * Creates a composer instance from a config entry.
   * @param {{ type?: string, name?: string, root?: string, progression?: string[], key?: string, quality?: string, tensionCurve?: number, primaryMode?: string, borrowProbability?: number }} config
   * @returns {MeasureComposer}
   */
  static create(config = {}) {
    const type = config.type || 'scale';
    const factory = this.constructors[type];
    if (!factory) {
      console.warn(`Unknown composer type: ${type}. Falling back to random scale.`);
      return this.constructors.scale({ name: 'random', root: 'random' });
    }
    return factory(config);
  }
}

/**
 * Instantiates all composers from COMPOSERS config.
 * @type {MeasureComposer[]}
 */
composers = [];  // Lazy-loaded in play.js when all systems are ready

// Export classes and factory globally for testing
globalThis.MeasureComposer = MeasureComposer;
globalThis.ScaleComposer = ScaleComposer;
globalThis.RandomScaleComposer = RandomScaleComposer;
globalThis.ChordComposer = ChordComposer;
globalThis.RandomChordComposer = RandomChordComposer;
globalThis.ModeComposer = ModeComposer;
globalThis.RandomModeComposer = RandomModeComposer;
globalThis.PentatonicComposer = PentatonicComposer;
globalThis.RandomPentatonicComposer = RandomPentatonicComposer;
globalThis.ProgressionGenerator = ProgressionGenerator;
globalThis.TensionReleaseComposer = TensionReleaseComposer;
globalThis.ModalInterchangeComposer = ModalInterchangeComposer;
globalThis.HarmonicRhythmComposer = HarmonicRhythmComposer;
globalThis.MelodicDevelopmentComposer = MelodicDevelopmentComposer;
globalThis.AdvancedVoiceLeadingComposer = AdvancedVoiceLeadingComposer;
globalThis.ComposerFactory = ComposerFactory;

// Mirror into __POLYCHRON_TEST__ to keep test globals namespaced
if (typeof globalThis !== 'undefined') {
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  Object.assign(globalThis.__POLYCHRON_TEST__, {
    MeasureComposer,
    ScaleComposer,
    RandomScaleComposer,
    ChordComposer,
    RandomChordComposer,
    ModeComposer,
    RandomModeComposer,
    PentatonicComposer,
    RandomPentatonicComposer,
    ProgressionGenerator,
    TensionReleaseComposer,
    ModalInterchangeComposer,
    HarmonicRhythmComposer,
    MelodicDevelopmentComposer,
    AdvancedVoiceLeadingComposer,
    ComposerFactory,
  });
}
