// @ts-check
// composers/index.js - Modular composer system
// This file organizes composer classes into logical modules while maintaining backward compatibility

// Load dependencies
require('../backstage');  // Load global utilities (m, rf, ri, ra, etc.)
require('../venue');      // Load music theory (allScales, allNotes, allModes, allChords)

// Load composer modules (only the ones that exist)
require('./MeasureComposer');
require('./ScaleComposer');
require('./ProgressionGenerator');

// Base class
// MeasureComposer is at: ./MeasureComposer.js

// Scale-based composers
// ScaleComposer and RandomScaleComposer at: ./ScaleComposer.js

// Chord progression system
// ChordComposer, RandomChordComposer at: ./ChordComposer.js
// ProgressionGenerator at: ./ProgressionGenerator.js

// Modal composers
// ModeComposer, RandomModeComposer at: ./ModeComposer.js

// Pentatonic composers
// PentatonicComposer, RandomPentatonicComposer at: ./PentatonicComposer.js

// Advanced composers (in main composers.js for now)
// TensionReleaseComposer
// ModalInterchangeComposer
// HarmonicRhythmComposer
// MelodicDevelopmentComposer
// AdvancedVoiceLeadingComposer

// Chord-based composers
class ChordComposer extends ScaleComposer {
  constructor(progression = ['C']) {
    // Normalize chord names (C -> Cmajor)
    const normalizedProgression = progression.map(chord => {
      // If it's just a note name (single letter possibly with sharp/flat), make it a major chord
      if (/^[A-G][b#]?$/.test(chord)) {
        return chord + 'major';
      }
      return chord;
    });

    // Filter invalid chords
    const validProgression = normalizedProgression.filter(chord => {
      try {
        const chordData = t.Chord.get(chord);
        if (!chordData || !chordData.notes || chordData.notes.length === 0) {
          console.warn(`Invalid chord: ${chord}`);
          return false;
        }
        return true;
      } catch (e) {
        console.warn(`Invalid chord: ${chord}`);
        return false;
      }
    });

    if (validProgression.length === 0) {
      console.warn('No valid chords in progression');
      super('major', 'C');
      this.progression = undefined;
      this.currentChordIndex = 0;
      return;
    }

    // Get the root of the first chord
    const firstChordData = t.Chord.get(validProgression[0]);
    const firstRoot = firstChordData.tonic || 'C';
    super('major', firstRoot);

    // Set up chord-specific properties
    this.progression = validProgression;
    this.currentChordIndex = 0;
    this.direction = 'R';

    // Set initial notes from first chord
    this.setChordProgression(validProgression, 'R');
  }

  /**
   * @param {Array<string | object>} progression
   * @param {string} direction
   */
  setChordProgression(progression, direction = 'R') {
    if (!progression || progression.length === 0) {
      this.notes = ['C', 'E', 'G'];
      return;
    }

    // Normalize chord names - only if needed
    const normalizedProgression = Array.isArray(progression) ? progression.map(chord => {
      if (typeof chord === 'string' && /^[A-G][b#]?$/.test(chord)) {
        return chord + 'major';
      }
      return typeof chord === 'string' ? chord : String(chord);
    }) : [typeof progression[0] === 'string' ? progression[0] : String(progression[0])];

    this.progression = normalizedProgression;
    this.direction = direction;

    // Set initial chord
    const currentChord = this.progression[this.currentChordIndex];
    const chordData = t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord based on direction
    if (direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (direction === 'E') {
      this.currentChordIndex = ri(this.progression.length - 1);
    } else if (direction === 'J') {
      const jump = ri(-2, 2);
      this.currentChordIndex = (this.currentChordIndex + jump + this.progression.length) % this.progression.length;
    }
  }

  /**
   * @param {Array<string | object> | string} progression
   * @param {string} direction
   */
  noteSet(progression, direction = 'R') {
    // Check if being called from parent ScaleComposer constructor
    if (typeof progression === 'string') {
      // This is being called from ScaleComposer.constructor with (scaleName, root)
      // Let ScaleComposer handle it
      super.noteSet(progression, direction);
      return;
    }
    // Otherwise use chord-specific logic
    this.setChordProgression(progression, direction);
  }

  x() {
    if (!this.progression || this.progression.length === 0) {
      return this.getNotes();
    }
    const currentChord = this.progression[this.currentChordIndex];
    const chordData = t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord
    if (this.direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (this.direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (this.direction === 'E') {
      this.currentChordIndex = ri(this.progression.length - 1);
    } else if (this.direction === 'J') {
      const jump = ri(-2, 2);
      this.currentChordIndex = (this.currentChordIndex + jump + this.progression.length) % this.progression.length;
    }

    return this.getNotes();
  }
}

class RandomChordComposer extends ChordComposer {
  constructor() {
    const len = ri(2, 5);
    const progression = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = ri(allChords.length - 1);
        chord = allChords[index];
        attempts++;
        // Give up after 10 attempts and use a fallback
        if (attempts > 10) {
          chord = 'Cmaj';
          break;
        }
      } while (!chord || typeof chord !== 'string' || chord.trim() === '');

      if (chord && typeof chord === 'string' && chord.trim() !== '') {
        progression.push(chord);
      }
    }
    // Ensure we have at least one chord
    if (progression.length === 0) {
      progression.push('Cmaj');
    }
    super(progression);
  }

  regenerateProgression() {
    const len = ri(2, 5);
    const progression = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = ri(allChords.length - 1);
        chord = allChords[index];
        attempts++;
        // Give up after 10 attempts and use a fallback
        if (attempts > 10) {
          chord = 'Cmaj';
          break;
        }
      } while (!chord || typeof chord !== 'string' || chord.trim() === '');

      if (chord && typeof chord === 'string' && chord.trim() !== '') {
        progression.push(chord);
      }
    }
    // Ensure we have at least one chord
    if (progression.length === 0) {
      progression.push('Cmaj');
    }
    // Reset chord index to 0 before setting new progression to avoid out-of-bounds access
    this.currentChordIndex = 0;
    this.setChordProgression(progression, 'R');
  }

  x() {
    this.regenerateProgression();
    return ChordComposer.prototype.x.call(this);
  }
}

class ModeComposer extends ScaleComposer {
  /**
   * @param {string} name
   * @param {string} root
   */
  constructor(name = 'ionian', root = 'C') {
    super('major', root);
    this.noteSet(name, root);
  }

  /**
   * @param {string} modeName
   * @param {string} root
   */
  noteSet(modeName, root) {
    this.root = root;
    this.mode = t.Mode.get(`${root} ${modeName}`);
    this.notes = this.mode.notes || this.mode.intervals || [];
    // If mode.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }

  x() {
    return this.getNotes();
  }
}

class RandomModeComposer extends ModeComposer {
  constructor() {
    super('ionian', 'C');
    this.noteSet();
  }

  noteSet() {
    const randomMode = allModes[ri(allModes.length - 1)];
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    super.noteSet(randomMode, randomRoot);
  }

  x() {
    this.noteSet();
    return super.x();
  }
}

class PentatonicComposer extends ScaleComposer {
  constructor(root = 'C', scaleType = 'major') {
    const scaleName = scaleType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    super(scaleName, root);
    this.type = scaleType;
  }

  x() {
    return this.getNotes();
  }
}

class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomType = ['major', 'minor'][ri(1)];
    super(randomRoot, randomType);
  }

  noteSet() {
    const randomRoot = allNotes[ri(allNotes.length - 1)];
    const randomType = ['major', 'minor'][ri(1)];
    this.root = randomRoot;
    this.type = randomType;
    const scaleName = randomType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    super.noteSet(scaleName, randomRoot);
  }

  x() {
    this.noteSet();
    return super.x();
  }
}

class TensionReleaseComposer extends ScaleComposer {
  constructor(key = 'C', quality = 'major', tensionCurve = 0.5) {
    super(quality, key);
    this.key = key;
    this.quality = quality;
    this.tensionCurve = clamp(tensionCurve, 0, 1);
    this.measureCount = 0;
  }

  /**
   * @param {string} chordOrFunction
   */
  calculateTension(chordOrFunction) {
    // Map chord names to functions based on scale degree
    let chordFunction = chordOrFunction;

    // If it's a chord name, try to determine its function
    if (chordOrFunction && typeof chordOrFunction === 'string') {
      const chordData = t.Chord.get(chordOrFunction);
      if (chordData && chordData.tonic) {
        const root = chordData.tonic;
        const keyScale = t.Scale.get(`${this.key} ${this.quality}`);
        const degree = keyScale.notes.indexOf(root);

        // Map scale degree to function
        /** @type {Record<number, string>} */
        const degreeToFunction = {
          0: 'tonic',       // I
          1: 'supertonic',  // ii
          2: 'mediant',     // iii
          3: 'subdominant', // IV
          4: 'dominant',    // V
          5: 'submediant',  // vi
          6: 'leadingTone'  // vii
        };
        chordFunction = degreeToFunction[degree] || chordOrFunction;
      }
    }

    /** @type {Record<string, number>} */
    const tensionMap = {
      'tonic': 0,
      'subdominant': 0.5,
      'dominant': 0.8,
      'supertonic': 0.6,
      'mediant': 0.3,
      'submediant': 0.4,
      'leadingTone': 0.9
    };
    return tensionMap[chordFunction] || 0.5;
  }

  /**
   * @param {number} targetTension
   */
  selectChordByTension(targetTension) {
    // Simplified chord selection based on tension - returns chord notes array
    const chordFunctions = ['tonic', 'subdominant', 'dominant'];
    const tensions = chordFunctions.map(f => this.calculateTension(f));
    let bestIdx = 0;
    let minDiff = Math.abs(tensions[0] - targetTension);
    for (let i = 1; i < tensions.length; i++) {
      const diff = Math.abs(tensions[i] - targetTension);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
    // Return the notes for the selected chord function
    const selectedFunction = chordFunctions[bestIdx];
    // Get scale degrees for the function
    /** @type {Record<string, number[]>} */
    const functionDegrees = {
      'tonic': [0, 2, 4],      // I chord (1-3-5)
      'subdominant': [3, 5, 0], // IV chord (4-6-1)
      'dominant': [4, 6, 1]     // V chord (5-7-2)
    };
    const degrees = functionDegrees[selectedFunction];
    return degrees.map((/** @type {number} */ d) => this.notes[d % this.notes.length]);
  }

  getNotes(octaveRange = null) {
    const targetTension = this.tensionCurve;
    const chordFunction = this.selectChordByTension(targetTension);
    this.measureCount++;
    return super.getNotes(octaveRange);
  }

  x() {
    return this.getNotes();
  }
}

class ModalInterchangeComposer extends ScaleComposer {
  /**
   * @param {string} key
   * @param {string} primaryMode
   * @param {number} borrowProbability
   */
  constructor(key = 'C', primaryMode = 'major', borrowProbability = 0.25) {
    super(primaryMode, key);
    this.key = key;
    this.primaryMode = primaryMode;
    this.borrowProbability = clamp(borrowProbability, 0, 1);
    this.borrowModes = this.getBorrowModes(primaryMode);
  }

  /**
   * @param {string} primaryMode
   */
  getBorrowModes(primaryMode) {
    if (primaryMode === 'major') {
      return ['minor', 'dorian', 'phrygian', 'mixolydian'];
    } else {
      return ['major', 'dorian', 'lydian', 'mixolydian'];
    }
  }

  borrowChord() {
    if (rf() < this.borrowProbability && this.borrowModes.length > 0) {
      const borrowMode = this.borrowModes[ri(this.borrowModes.length - 1)];
      const borrowScale = t.Scale.get(`${this.key} ${borrowMode}`);
      // Return chord notes as array
      const chordRoot = borrowScale.notes[ri(borrowScale.notes.length - 1)];
      const chordData = t.Chord.get(`${chordRoot}major`);
      return chordData ? chordData.notes : null;
    }
    return null;
  }

  getNotes(octaveRange = null) {
    const borrowedNotes = this.borrowChord();
    if (borrowedNotes) {
      const originalNotes = this.notes;
      this.notes = borrowedNotes;
      const result = super.getNotes(octaveRange);
      this.notes = originalNotes;
      return result;
    }
    return super.getNotes(octaveRange);
  }

  x() {
    return this.getNotes();
  }
}

class HarmonicRhythmComposer extends ScaleComposer {
  constructor(progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major') {
    super(quality, key);
    this.progression = progression;
    this.measuresPerChord = measuresPerChord;
  }
}

class MelodicDevelopmentComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', developmentIntensity = 0.5) {
    const scaleName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    const rootNote = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    super(scaleName, rootNote);
    this.developmentIntensity = clamp(developmentIntensity, 0, 1);
    this.measureCount = 0;
    this.developmentPhase = 'exposition';
    this.responseMode = false;
  }

  getNotes(octaveRange = null) {
    const baseNotes = super.getNotes(octaveRange);
    if (baseNotes.length === 0) {
      return [];
    }

    this.measureCount++;

    // Cycle through development phases
    const phaseCount = Math.floor(this.measureCount / 4);
    const phases = ['exposition', 'development', 'recapitulation'];
    this.developmentPhase = phases[phaseCount % phases.length];

    return baseNotes;
  }

  x() {
    return this.getNotes();
  }
}

class AdvancedVoiceLeadingComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', commonToneWeight = 0.7) {
    const scaleName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    const rootNote = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    super(scaleName, rootNote);
    this.commonToneWeight = clamp(commonToneWeight, 0, 1);
    /** @type {any[]} */
    this.previousNotes = [];
    this.voiceBalanceThreshold = 3;
    this.contraryMotionPreference = 0.4;
  }

  getNotes(octaveRange = null) {
    const baseNotes = super.getNotes(octaveRange);

    if (!baseNotes || baseNotes === null) {
      return baseNotes;
    }

    if (baseNotes.length === 0) {
      return baseNotes;
    }

    if (this.previousNotes.length === 0) {
      this.previousNotes = baseNotes;
      return baseNotes;
    }

    // Apply voice leading optimization
    const optimizedNotes = baseNotes.map((noteObj, idx) => {
      if (idx < this.previousNotes.length && rf() < this.commonToneWeight) {
        // Try to maintain common tones
        const prevNote = this.previousNotes[idx].note;
        const chromaPrev = prevNote % 12;
        const chromaCurrent = noteObj.note % 12;

        if (chromaPrev === chromaCurrent) {
          return { note: prevNote };
        }
      }
      return noteObj;
    });

    this.previousNotes = optimizedNotes;
    return optimizedNotes;
  }

  x() {
    return this.getNotes();
  }
}

// Export composers to global scope
globalThis.ChordComposer = ChordComposer;
globalThis.RandomChordComposer = RandomChordComposer;
globalThis.ModeComposer = ModeComposer;
globalThis.RandomModeComposer = RandomModeComposer;
globalThis.PentatonicComposer = PentatonicComposer;
globalThis.RandomPentatonicComposer = RandomPentatonicComposer;
globalThis.TensionReleaseComposer = TensionReleaseComposer;
globalThis.ModalInterchangeComposer = ModalInterchangeComposer;
globalThis.HarmonicRhythmComposer = HarmonicRhythmComposer;
globalThis.MelodicDevelopmentComposer = MelodicDevelopmentComposer;
globalThis.AdvancedVoiceLeadingComposer = AdvancedVoiceLeadingComposer;

// ComposerFactory creates instances

/**
 * Centralized factory for composer creation
 * @class
 */
class ComposerFactory {
  /** @type {Record<string, Function>} */
  static constructors = {
    measure: () => new MeasureComposer(),
    scale: ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ScaleComposer(n, r);
    },
    chords: ({ progression = ['C'] } = {}) => {
      let p = Array.isArray(progression) ? progression : ['C'];
      if (typeof progression === 'string' && progression === 'random') {
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
let composers = [];  // Lazy-loaded in play.js when all systems are ready

// Export to global scope for backward compatibility
globalThis.ComposerFactory = ComposerFactory;
globalThis.composers = composers;