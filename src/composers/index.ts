// composers/index.ts - Modular composer system
// This file organizes composer classes into logical modules while maintaining backward compatibility

// Load dependencies
import '../backstage.js';  // Load global utilities (m, rf, ri, ra, etc.)
import '../venue.js';      // Load music theory (allScales, allNotes, allModes, allChords)

// Load composer modules (only the ones that exist)
import './MeasureComposer.js';
import './ScaleComposer.js';
import './ProgressionGenerator.js';

// Base class
// MeasureComposer is at: ./MeasureComposer.ts

// Scale-based composers
// ScaleComposer and RandomScaleComposer at: ./ScaleComposer.ts

// Chord progression system
// ChordComposer, RandomChordComposer at: ./ChordComposer.ts (in this file)
// ProgressionGenerator at: ./ProgressionGenerator.ts

// Modal composers
// ModeComposer, RandomModeComposer at: ./ModeComposer.ts (in this file)

// Pentatonic composers
// PentatonicComposer, RandomPentatonicComposer at: ./PentatonicComposer.ts (in this file)

// Advanced composers (in this file)
// TensionReleaseComposer
// ModalInterchangeComposer
// HarmonicRhythmComposer
// MelodicDevelopmentComposer
// AdvancedVoiceLeadingComposer

// Chord-based composers
class ChordComposer extends ScaleComposer {
  progression: string[] | undefined;
  currentChordIndex: number;
  direction: string;

  constructor(progression: string[] = ['C']) {
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
        const chordData = (globalThis as any).t.Chord.get(chord);
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
      this.direction = 'R';
      return;
    }

    // Get the root of the first chord
    const firstChordData = (globalThis as any).t.Chord.get(validProgression[0]);
    const firstRoot = firstChordData.tonic || 'C';
    super('major', firstRoot);

    // Set up chord-specific properties after super call
    this.progression = validProgression;
    this.currentChordIndex = 0;
    this.direction = 'R';

    // Set initial notes from first chord
    this.setChordProgression(validProgression, 'R');
  }

  setChordProgression(progression: string[], direction: string = 'R'): void {
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
    const chordData = (globalThis as any).t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord based on direction
    if (direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (direction === 'E') {
      this.currentChordIndex = (globalThis as any).ri(this.progression.length - 1);
    } else if (direction === 'J') {
      const jump = (globalThis as any).ri(-2, 2);
      this.currentChordIndex = (this.currentChordIndex + jump + this.progression.length) % this.progression.length;
    }
  }

  noteSet(progression: string[] | string, direction: string = 'R'): void {
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

  x(): any[] {
    if (!this.progression || this.progression.length === 0) {
      return this.getNotes();
    }
    const currentChord = this.progression[this.currentChordIndex];
    const chordData = (globalThis as any).t.Chord.get(currentChord);
    this.notes = chordData ? chordData.notes : ['C', 'E', 'G'];

    // Move to next chord
    if (this.direction === 'R') {
      this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    } else if (this.direction === 'L') {
      this.currentChordIndex = (this.currentChordIndex - 1 + this.progression.length) % this.progression.length;
    } else if (this.direction === 'E') {
      this.currentChordIndex = (globalThis as any).ri(this.progression.length - 1);
    } else if (this.direction === 'J') {
      const jump = (globalThis as any).ri(-2, 2);
      this.currentChordIndex = (this.currentChordIndex + jump + this.progression.length) % this.progression.length;
    }

    return this.getNotes();
  }
}

class RandomChordComposer extends ChordComposer {
  constructor() {
    const len = (globalThis as any).ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = (globalThis as any).ri((globalThis as any).allChords.length - 1);
        chord = (globalThis as any).allChords[index];
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

  regenerateProgression(): void {
    const len = (globalThis as any).ri(2, 5);
    const progression: string[] = [];
    for (let i = 0; i < len; i++) {
      let chord;
      let attempts = 0;
      do {
        const index = (globalThis as any).ri((globalThis as any).allChords.length - 1);
        chord = (globalThis as any).allChords[index];
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

  x(): any[] {
    this.regenerateProgression();
    return ChordComposer.prototype.x.call(this);
  }
}

class ModeComposer extends ScaleComposer {
  mode: any;

  constructor(name: string = 'ionian', root: string = 'C') {
    super('major', root);
    this.noteSet(name, root);
  }

  noteSet(modeName: string, root: string): void {
    this.root = root;
    this.mode = (globalThis as any).t.Mode.get(`${root} ${modeName}`);
    this.notes = this.mode.notes || this.mode.intervals || [];
    // If mode.notes is still empty, fall back to scale
    if (!this.notes || this.notes.length === 0) {
      const scale = (globalThis as any).t.Scale.get(`${root} ${modeName}`);
      this.notes = scale.notes || [];
    }
  }

  x(): any[] {
    return this.getNotes();
  }
}

class RandomModeComposer extends ModeComposer {
  constructor() {
    super('ionian', 'C');
    this.noteSet();
  }

  noteSet(): void {
    const randomMode = (globalThis as any).allModes[(globalThis as any).ri((globalThis as any).allModes.length - 1)];
    const randomRoot = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)];
    super.noteSet(randomMode, randomRoot);
  }

  x(): any[] {
    this.noteSet();
    return super.x();
  }
}

class PentatonicComposer extends ScaleComposer {
  type: string;

  constructor(root: string = 'C', scaleType: string = 'major') {
    const scaleName = scaleType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    super(scaleName, root);
    this.type = scaleType;
  }

  x(): any[] {
    return this.getNotes();
  }
}

class RandomPentatonicComposer extends PentatonicComposer {
  constructor() {
    const randomRoot = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)];
    const randomType = ['major', 'minor'][(globalThis as any).ri(1)];
    super(randomRoot, randomType);
  }

  noteSet(): void {
    const randomRoot = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)];
    const randomType = ['major', 'minor'][(globalThis as any).ri(1)];
    this.root = randomRoot;
    this.type = randomType;
    const scaleName = randomType === 'major' ? 'major pentatonic' : 'minor pentatonic';
    super.noteSet(scaleName, randomRoot);
  }

  x(): any[] {
    this.noteSet();
    return super.x();
  }
}

class TensionReleaseComposer extends ScaleComposer {
  key: string;
  quality: string;
  tensionCurve: number;
  measureCount: number = 0;

  constructor(key: string = 'C', quality: string = 'major', tensionCurve: number = 0.5) {
    super(quality, key);
    this.key = key;
    this.quality = quality;
    this.tensionCurve = (globalThis as any).clamp(tensionCurve, 0, 1);
    this.measureCount = 0;
  }

  calculateTension(chordOrFunction: string): number {
    // Map chord names to functions based on scale degree
    let chordFunction = chordOrFunction;

    // If it's a chord name, try to determine its function
    if (chordOrFunction && typeof chordOrFunction === 'string') {
      const chordData = (globalThis as any).t.Chord.get(chordOrFunction);
      if (chordData && chordData.tonic) {
        const root = chordData.tonic;
        const keyScale = (globalThis as any).t.Scale.get(`${this.key} ${this.quality}`);
        const degree = keyScale.notes.indexOf(root);

        // Map scale degree to function
        const degreeToFunction: Record<number, string> = {
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

    const tensionMap: Record<string, number> = {
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

  selectChordByTension(targetTension: number): any[] {
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
    const functionDegrees: Record<string, number[]> = {
      'tonic': [0, 2, 4],      // I chord (1-3-5)
      'subdominant': [3, 5, 0], // IV chord (4-6-1)
      'dominant': [4, 6, 1]     // V chord (5-7-2)
    };
    const degrees = functionDegrees[selectedFunction];
    return degrees.map((d: number) => this.notes[d % this.notes.length]);
  }

  getNotes(octaveRange: number[] | null = null): any[] {
    const targetTension = this.tensionCurve;
    const chordFunction = this.selectChordByTension(targetTension);
    this.measureCount++;
    return super.getNotes(octaveRange);
  }

  x(): any[] {
    return this.getNotes();
  }
}

class ModalInterchangeComposer extends ScaleComposer {
  key: string;
  primaryMode: string;
  borrowProbability: number;
  borrowModes: string[];

  constructor(key: string = 'C', primaryMode: string = 'major', borrowProbability: number = 0.25) {
    super(primaryMode, key);
    this.key = key;
    this.primaryMode = primaryMode;
    this.borrowProbability = (globalThis as any).clamp(borrowProbability, 0, 1);
    this.borrowModes = this.getBorrowModes(primaryMode);
  }

  getBorrowModes(primaryMode: string): string[] {
    if (primaryMode === 'major') {
      return ['minor', 'dorian', 'phrygian', 'mixolydian'];
    } else {
      return ['major', 'dorian', 'lydian', 'mixolydian'];
    }
  }

  borrowChord(): any[] | null {
    if ((globalThis as any).rf() < this.borrowProbability && this.borrowModes.length > 0) {
      const borrowMode = this.borrowModes[(globalThis as any).ri(this.borrowModes.length - 1)];
      const borrowScale = (globalThis as any).t.Scale.get(`${this.key} ${borrowMode}`);
      // Return chord notes as array
      const chordRoot = borrowScale.notes[(globalThis as any).ri(borrowScale.notes.length - 1)];
      const chordData = (globalThis as any).t.Chord.get(`${chordRoot}major`);
      return chordData ? chordData.notes : null;
    }
    return null;
  }

  getNotes(octaveRange: number[] | null = null): any[] {
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

  x(): any[] {
    return this.getNotes();
  }
}

class HarmonicRhythmComposer extends ScaleComposer {
  progression: string[];
  measuresPerChord: number;

  constructor(progression: string[] = ['I','IV','V','I'], key: string = 'C', measuresPerChord: number = 2, quality: string = 'major') {
    super(quality, key);
    this.progression = progression;
    this.measuresPerChord = measuresPerChord;
  }
}

class MelodicDevelopmentComposer extends ScaleComposer {
  developmentIntensity: number;
  measureCount: number = 0;
  developmentPhase: string = 'exposition';
  responseMode: boolean = false;

  constructor(name: string = 'major', root: string = 'C', developmentIntensity: number = 0.5) {
    const scaleName = name === 'random' ? (globalThis as any).allScales[(globalThis as any).ri((globalThis as any).allScales.length - 1)] : name;
    const rootNote = root === 'random' ? (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)] : root;
    super(scaleName, rootNote);
    this.developmentIntensity = (globalThis as any).clamp(developmentIntensity, 0, 1);
    this.measureCount = 0;
    this.developmentPhase = 'exposition';
    this.responseMode = false;
  }

  getNotes(octaveRange: number[] | null = null): any[] {
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

  x(): any[] {
    return this.getNotes();
  }
}

class AdvancedVoiceLeadingComposer extends ScaleComposer {
  commonToneWeight: number;
  previousNotes: any[] = [];
  voiceBalanceThreshold: number = 3;
  contraryMotionPreference: number = 0.4;

  constructor(name: string = 'major', root: string = 'C', commonToneWeight: number = 0.7) {
    const scaleName = name === 'random' ? (globalThis as any).allScales[(globalThis as any).ri((globalThis as any).allScales.length - 1)] : name;
    const rootNote = root === 'random' ? (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)] : root;
    super(scaleName, rootNote);
    this.commonToneWeight = (globalThis as any).clamp(commonToneWeight, 0, 1);
    this.previousNotes = [];
    this.voiceBalanceThreshold = 3;
    this.contraryMotionPreference = 0.4;
  }

  getNotes(octaveRange: number[] | null = null): any[] {
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
    const optimizedNotes = baseNotes.map((noteObj: any, idx: number) => {
      if (idx < this.previousNotes.length && (globalThis as any).rf() < this.commonToneWeight) {
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

  x(): any[] {
    return this.getNotes();
  }
}

// Export composers to global scope
(globalThis as any).ChordComposer = ChordComposer;
(globalThis as any).RandomChordComposer = RandomChordComposer;
(globalThis as any).ModeComposer = ModeComposer;
(globalThis as any).RandomModeComposer = RandomModeComposer;
(globalThis as any).PentatonicComposer = PentatonicComposer;
(globalThis as any).RandomPentatonicComposer = RandomPentatonicComposer;
(globalThis as any).TensionReleaseComposer = TensionReleaseComposer;
(globalThis as any).ModalInterchangeComposer = ModalInterchangeComposer;
(globalThis as any).HarmonicRhythmComposer = HarmonicRhythmComposer;
(globalThis as any).MelodicDevelopmentComposer = MelodicDevelopmentComposer;
(globalThis as any).AdvancedVoiceLeadingComposer = AdvancedVoiceLeadingComposer;

// ComposerFactory creates instances

/**
 * Centralized factory for composer creation
 */
class ComposerFactory {
  static constructors: Record<string, Function> = {
    measure: () => new (globalThis as any).MeasureComposer(),
    scale: ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? (globalThis as any).allScales[(globalThis as any).ri((globalThis as any).allScales.length - 1)] : name;
      const r = root === 'random' ? (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)] : root;
      return new ScaleComposer(n, r);
    },
    chords: ({ progression = ['C'] } = {}) => {
      let p = Array.isArray(progression) ? progression : ['C'];
      if (typeof progression === 'string' && progression === 'random') {
        const len = (globalThis as any).ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) {
          p.push((globalThis as any).allChords[(globalThis as any).ri((globalThis as any).allChords.length - 1)]);
        }
      }
      return new ChordComposer(p);
    },
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? (globalThis as any).allModes[(globalThis as any).ri((globalThis as any).allModes.length - 1)] : name;
      const r = root === 'random' ? (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)] : root;
      return new ModeComposer(n, r);
    },
    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[(globalThis as any).ri(2)] : scaleType;
      return new PentatonicComposer(r, t);
    },
    tensionRelease: ({ key = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) => new TensionReleaseComposer(key, quality, tensionCurve),
    modalInterchange: ({ key = (globalThis as any).allNotes[(globalThis as any).ri((globalThis as any).allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => new ModalInterchangeComposer(key, primaryMode, borrowProbability),
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) => new HarmonicRhythmComposer(progression, key, measuresPerChord, quality),
    melodicDevelopment: ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) => new MelodicDevelopmentComposer(name, root, developmentIntensity),
    advancedVoiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new AdvancedVoiceLeadingComposer(name, root, commonToneWeight),
  };

  /**
   * Creates a composer instance from a config entry.
   */
  static create(config: any = {}): any {
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
 */
let composers: any[] = [];  // Lazy-loaded in play.ts when all systems are ready

// Export to global scope for backward compatibility
(globalThis as any).ComposerFactory = ComposerFactory;
(globalThis as any).composers = composers;
