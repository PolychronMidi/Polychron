// composers/index.ts - Modular composer system
// This file organizes composer classes into logical modules and preserves module exports

// Load dependencies
import * as t from 'tonal';
import { allNotes, allScales, allChords, allModes } from '../venue.js';
import { clamp, rf, ri } from '../utils.js';

// Load composer modules (only the ones that exist)
import MeasureComposer from './MeasureComposer.js';
import ScaleComposer, { RandomScaleComposer } from './ScaleComposer.js';
import ModeComposer, { RandomModeComposer } from './ModeComposer.js';
import ChordComposer, { RandomChordComposer } from './ChordComposer.js';
import PentatonicComposer, { RandomPentatonicComposer } from './PentatonicComposer.js';
import ProgressionGenerator from './ProgressionGenerator.js';

// Base class
// MeasureComposer is at: ./MeasureComposer.ts

// Scale-based composers
// ScaleComposer and RandomScaleComposer at: ./ScaleComposer.ts

// Chord progression system
// ChordComposer, RandomChordComposer at: ./ChordComposer.ts
// ProgressionGenerator at: ./ProgressionGenerator.ts

// Modal composers
// ModeComposer, RandomModeComposer at: ./ModeComposer.ts

// Pentatonic composers
// PentatonicComposer, RandomPentatonicComposer at: ./PentatonicComposer.ts

// Advanced composers (in this file)
// TensionReleaseComposer
// ModalInterchangeComposer
// HarmonicRhythmComposer
// MelodicDevelopmentComposer
// AdvancedVoiceLeadingComposer

class TensionReleaseComposer {
  key: string;
  quality: string;
  tensionCurve: number;
  measureCount: number = 0;
  private base: ScaleComposer;

  constructor(key: string = 'C', quality: string = 'major', tensionCurve: number = 0.5) {
    this.key = key;
    this.quality = quality;
    this.tensionCurve = clamp(tensionCurve, 0, 1);
    this.measureCount = 0;
    this.base = new ScaleComposer(quality, key);
  }

  calculateTension(chordOrFunction: string): number {
    let chordFunction = chordOrFunction;

    if (chordOrFunction && typeof chordOrFunction === 'string') {
      const chordData = t.Chord.get(chordOrFunction);
      if (chordData && chordData.tonic) {
        const root = chordData.tonic;
        const keyScale = t.Scale.get(`${this.key} ${this.quality}`);
        const degree = keyScale.notes.indexOf(root);

        const degreeToFunction: Record<number, string> = {
          0: 'tonic', 1: 'supertonic', 2: 'mediant', 3: 'subdominant', 4: 'dominant', 5: 'submediant', 6: 'leadingTone'
        };
        chordFunction = degreeToFunction[degree] || chordOrFunction;
      }
    }

    const tensionMap: Record<string, number> = {
      'tonic': 0, 'subdominant': 0.5, 'dominant': 0.8, 'supertonic': 0.6, 'mediant': 0.3, 'submediant': 0.4, 'leadingTone': 0.9
    };
    return tensionMap[chordFunction] || 0.5;
  }

  selectChordByTension(targetTension: number): any[] {
    const chordFunctions = ['tonic', 'subdominant', 'dominant'];
    const tensions = chordFunctions.map(f => this.calculateTension(f));
    let bestIdx = 0;
    let minDiff = Math.abs(tensions[0] - targetTension);
    for (let i = 1; i < tensions.length; i++) {
      const diff = Math.abs(tensions[i] - targetTension);
      if (diff < minDiff) { minDiff = diff; bestIdx = i; }
    }
    const selectedFunction = chordFunctions[bestIdx];
    const functionDegrees: Record<string, number[]> = { 'tonic': [0,2,4], 'subdominant': [3,5,0], 'dominant': [4,6,1] };
    const degrees = functionDegrees[selectedFunction];
    const notes = this.base.notes || [];
    return degrees.map((d: number) => notes[d % notes.length]);
  }

  getNotes(octaveRange: number[] | null = null): any[] {
    this.measureCount++;
    return this.base.getNotes(octaveRange);
  }

  x(): any[] { return this.getNotes(); }

  // Delegate common properties and APIs to the underlying ScaleComposer
  get root() { return (this.base as any).root; }
  get item() { return (this.base as any).item; }
  get notes() { return (this.base as any).notes; }
  get scale() { return (this.base as any).scale; }
  getMeter(...args: any[]) { return (this.base as any).getMeter?.(...args); }
  getDivisions(...args: any[]) { return (this.base as any).getDivisions?.(...args); }
  getSubdivisions(...args: any[]) { return (this.base as any).getSubdivisions?.(...args); }
  getSubsubdivs(...args: any[]) { return (this.base as any).getSubsubdivs?.(...args); }
  getVoices(...args: any[]) { return (this.base as any).getVoices?.(...args); }
}

class ModalInterchangeComposer {
  key: string;
  primaryMode: string;
  borrowProbability: number;
  borrowModes: string[];
  private base: ScaleComposer;

  constructor(key: string = 'C', primaryMode: string = 'major', borrowProbability: number = 0.25) {
    this.key = key;
    this.primaryMode = primaryMode;
    this.borrowProbability = clamp(borrowProbability, 0, 1);
    this.borrowModes = this.getBorrowModes(primaryMode);
    this.base = new ScaleComposer(primaryMode, key);
  }

  getBorrowModes(primaryMode: string): string[] {
    if (primaryMode === 'major') return ['minor', 'dorian', 'phrygian', 'mixolydian'];
    return ['major', 'dorian', 'lydian', 'mixolydian'];
  }

  borrowChord(): any[] | null {
    if (rf() < this.borrowProbability && this.borrowModes.length > 0) {
      const borrowMode = this.borrowModes[ri(this.borrowModes.length - 1)];
      const borrowScale = t.Scale.get(`${this.key} ${borrowMode}`);
      const chordRoot = borrowScale.notes[ri(borrowScale.notes.length - 1)];
      const chordData = t.Chord.get(`${chordRoot}major`);
      return chordData ? chordData.notes : null;
    }
    return null;
  }

  getNotes(octaveRange: number[] | null = null): any[] {
    const borrowedNotes = this.borrowChord();
    if (borrowedNotes) {
      const originalNotes = this.base.notes;
      (this.base as any).notes = borrowedNotes;
      const result = this.base.getNotes(octaveRange);
      (this.base as any).notes = originalNotes;
      return result;
    }
    return this.base.getNotes(octaveRange);
  }

  x(): any[] { return this.getNotes(); }

  // Delegate commonly used composer APIs to the base ScaleComposer
  getMeter(...args: any[]) { return (this.base as any).getMeter?.(...args); }
  getDivisions(...args: any[]) { return (this.base as any).getDivisions?.(...args); }
  getSubdivisions(...args: any[]) { return (this.base as any).getSubdivisions?.(...args); }
  getSubsubdivs(...args: any[]) { return (this.base as any).getSubsubdivs?.(...args); }
  getVoices(...args: any[]) { return (this.base as any).getVoices?.(...args); }

  // Delegate common properties
  get root() { return (this.base as any).root; }
  get item() { return (this.base as any).item; }
  get notes() { return (this.base as any).notes; }
  get scale() { return (this.base as any).scale; }
}

class HarmonicRhythmComposer {
  progression: string[];
  measuresPerChord: number;
  private base: ScaleComposer;

  constructor(progression: string[] = ['I','IV','V','I'], key: string = 'C', measuresPerChord: number = 2, quality: string = 'major') {
    this.base = new ScaleComposer(quality, key);
    this.progression = progression;
    this.measuresPerChord = measuresPerChord;
  }

  // Delegate common methods
  getNotes(...args: any[]) { return (this.base as any).getNotes?.(...args); }
  x() { return this.getNotes(); }
  getMeter(...args: any[]) { return (this.base as any).getMeter?.(...args); }
  getDivisions(...args: any[]) { return (this.base as any).getDivisions?.(...args); }
  getSubdivisions(...args: any[]) { return (this.base as any).getSubdivisions?.(...args); }
  getVoices(...args: any[]) { return (this.base as any).getVoices?.(...args); }

  // Delegate common properties
  get root() { return (this.base as any).root; }
  get item() { return (this.base as any).item; }
  get notes() { return (this.base as any).notes; }
  get scale() { return (this.base as any).scale; }
}

class MelodicDevelopmentComposer {
  developmentIntensity: number;
  measureCount: number = 0;
  developmentPhase: string = 'exposition';
  responseMode: boolean = false;
  private base: ScaleComposer;

  constructor(name: string = 'major', root: string = 'C', developmentIntensity: number = 0.5) {
    const scaleName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    const rootNote = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    this.base = new ScaleComposer(scaleName, rootNote);
    this.developmentIntensity = clamp(developmentIntensity, 0, 1);
    this.measureCount = 0;
    this.developmentPhase = 'exposition';
    this.responseMode = false;
  }

  getNotes(octaveRange: number[] | null = null): any[] {
    const baseNotes = this.base.getNotes(octaveRange);
    if (!baseNotes || baseNotes.length === 0) return [];
    this.measureCount++;
    const phaseCount = Math.floor(this.measureCount / 4);
    const phases = ['exposition', 'development', 'recapitulation'];
    this.developmentPhase = phases[phaseCount % phases.length];
    return baseNotes;
  }

  x(): any[] { return this.getNotes(); }

  // Delegate common properties and APIs
  get root() { return (this.base as any).root; }
  get item() { return (this.base as any).item; }
  get notes() { return (this.base as any).notes; }
  get scale() { return (this.base as any).scale; }
  getMeter(...args: any[]) { return (this.base as any).getMeter?.(...args); }
  getDivisions(...args: any[]) { return (this.base as any).getDivisions?.(...args); }
  getSubdivisions(...args: any[]) { return (this.base as any).getSubdivisions?.(...args); }
  getSubsubdivs(...args: any[]) { return (this.base as any).getSubsubdivs?.(...args); }
  getVoices(...args: any[]) { return (this.base as any).getVoices?.(...args); }
}

class AdvancedVoiceLeadingComposer {
  commonToneWeight: number;
  previousNotes: any[] = [];
  voiceBalanceThreshold: number = 3;
  contraryMotionPreference: number = 0.4;
  private base: ScaleComposer;

  constructor(name: string = 'major', root: string = 'C', commonToneWeight: number = 0.7) {
    const scaleName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    const rootNote = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    this.base = new ScaleComposer(scaleName, rootNote);
    this.commonToneWeight = clamp(commonToneWeight, 0, 1);
    this.previousNotes = [];
    this.voiceBalanceThreshold = 3;
    this.contraryMotionPreference = 0.4;
  }

  getNotes(octaveRange: number[] | null = null): any[] {
    const baseNotes = this.base.getNotes(octaveRange);

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
      if (idx < this.previousNotes.length && rf() < this.commonToneWeight) {
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

  x(): any[] { return this.getNotes(); }

  // Delegate common properties and APIs
  get root() { return (this.base as any).root; }
  get item() { return (this.base as any).item; }
  get notes() { return (this.base as any).notes; }
  get scale() { return (this.base as any).scale; }
  getMeter(...args: any[]) { return (this.base as any).getMeter?.(...args); }
  getDivisions(...args: any[]) { return (this.base as any).getDivisions?.(...args); }
  getSubdivisions(...args: any[]) { return (this.base as any).getSubdivisions?.(...args); }
  getSubsubdivs(...args: any[]) { return (this.base as any).getSubsubdivs?.(...args); }
  getVoices(...args: any[]) { return (this.base as any).getVoices?.(...args); }
}

// Note: Do NOT attach composers to runtime globals. Export named symbols for DI usage.

// ComposerFactory creates instances

/**
 * Centralized factory for composer creation
 */
class ComposerFactory {
  static constructors: Record<string, Function> = {
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

// Named exports for composers (DI-friendly; avoid attaching to runtime globals)
export {
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
  composers
};
