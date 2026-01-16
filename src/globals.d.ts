// Global type declarations for Polychron
// This file declares types for variables attached to globalThis

import { Scale, Chord, Note } from 'tonal';

// Extend tonal types
interface Mode {
  name: string;
  notes?: string[];
  intervals?: string[];
}

interface Key {
  tonic: string;
  type: string;
  alteration: number;
  natural: string;
  scale: string[];
  chords: string[];
}

declare global {
  // Tonal library utilities
  var t: {
    Scale: typeof Scale;
    Chord: typeof Chord;
    Note: typeof Note;
    Mode: {
      get: (name: string) => Mode;
    };
    Key: {
      majorKey: (tonic: string) => Key;
      minorKey: (tonic: string) => Key;
    };
  };

  // Music theory data
  var allNotes: string[];
  var allScales: string[];
  var allChords: string[];
  var allModes: string[];

  // MIDI data and utilities
  var midiData: {
    program: Array<{ number: number; name: string }>;
    control: Array<{ number: number; name: string }>;
  };
  var getMidiValue: (category: string, name: string) => number;

  // Configuration constants
  var primaryInstrument: string;
  var secondaryInstrument: string;
  var otherInstruments: string[];
  var bassInstrument: string;
  var bassInstrument2: string;
  var otherBassInstruments: string[];
  var drumSets: number[];
  var LOG: string;
  var TUNING_FREQ: number;
  var BINAURAL: { min: number; max: number };
  var PPQ: number;
  var BPM: number;
  var NUMERATOR: { min: number; max: number; weights?: number[] };
  var DENOMINATOR: { min: number; max: number; weights?: number[] };
  var OCTAVE: { min: number; max: number; weights?: number[] };
  var VOICES: { min: number; max: number; weights?: number[] };
  var SECTION_TYPES: string[];
  var SECTIONS: { min: number; max: number };
  var COMPOSERS: any[];
  var DIVISIONS: { min: number; max: number; weights?: number[] };
  var SUBDIVISIONS: { min: number; max: number; weights?: number[] };
  var SUBSUBDIVS: { min: number; max: number; weights?: number[] };

  // Timing and structure
  var numerator: number;
  var denominator: number;
  var meterRatio: number;
  var midiMeter: number;
  var midiMeterRatio: number;
  var syncFactor: number;
  var midiBPM: number;
  var tpSec: number;
  var tpBeat: number;
  var tpDiv: number;
  var tpSubdiv: number;
  var tpSubsubdiv: number;
  var measureStart: number;
  var beatStart: number;
  var divStart: number;
  var subdivStart: number;
  var subsubdivStart: number;
  var measureIndex: number;
  var beatIndex: number;
  var divIndex: number;
  var subdivIndex: number;
  var subsubdivIndex: number;
  var sectionIndex: number;
  var totalSections: number;
  var phraseIndex: number;
  var phraseStart: number;
  var measuresPerPhrase: number;
  var divsPerBeat: number;
  var subdivsPerDiv: number;
  var subdivsPerBeat: number;
  var subsubsPerSub: number;
  var beatsOn: number;
  var beatsOff: number;
  var divsOn: number;
  var divsOff: number;
  var subdivsOn: number;
  var subdivsOff: number;
  var subdivsPerDiv: number;
  var subdivsPerBeat: number;
  var subdivsPerMinute: number;
  var subsubsPerSub: number;
  var beatsOn: number;
  var beatsOff: number;
  var beatRhythm: number[];
  var divRhythm: number[];
  var subdivRhythm: number[];
  var subsubdivRhythm: number[];

  // Timing functions
  var getMidiTiming: () => any;
  var setMidiTiming: (bpm: number, numerator: number, denominator: number) => void;
  var getPolyrhythm: () => any;
  var setUnitTiming: (unitType: string) => void;
  var formatTime: (seconds: number) => string;
  var TimingCalculator: any;
  var TimingContext: any;
  var LM: any;
  var layerManager: any;

  // Structure functions
  var normalizeSectionType: (type: string) => string;
  var selectSectionType: () => string;
  var resolveSectionProfile: () => any;

  // Random utilities
  var m: Math;
  var rf: (min?: number, max?: number, min2?: number, max2?: number) => number;
  var ri: (min?: number, max?: number, min2?: number, max2?: number) => number;
  var rl: (currentValue: number, minChange: number, maxChange: number, minValue: number, maxValue: number, type?: string) => number;
  var rv: (value: number, boostRange?: number[], frequency?: number, deboostRange?: number[]) => number;
  var ra: (array: any[]) => any;
  var clamp: (value: number, min: number, max: number) => number;
  var modClamp: (value: number, min: number, max: number) => number;
  var lowModClamp: (value: number, min: number, max: number) => number;
  var highModClamp: (value: number, min: number, max: number) => number;
  var scaleClamp: (value: number, min: number, max: number, factor: number) => number;
  var scaleBoundClamp: (value: number, min: number, max: number, factor: number) => number;
  var softClamp: (value: number, min: number, max: number, softness: number) => number;
  var stepClamp: (value: number, min: number, max: number, step: number) => number;
  var logClamp: (value: number, min: number, max: number) => number;
  var expClamp: (value: number, min: number, max: number) => number;

  // MIDI channels
  var cCH1: number;
  var cCH2: number;
  var cCH3: number;
  var lCH1: number;
  var lCH2: number;
  var lCH3: number;
  var lCH4: number;
  var lCH5: number;
  var lCH6: number;
  var rCH1: number;
  var rCH2: number;
  var rCH3: number;
  var rCH4: number;
  var rCH5: number;
  var rCH6: number;
  var drumCH: number;
  var binauralL: number[];
  var binauralR: number[];
  var reflectionBinaural: number[];
  var bassBinaural: number[];
  var source: number[];
  var source2: number[];
  var reflection: number[];
  var bass: number[];
  var allCHs: number[];
  var stutterFadeCHs: number[];
  var stutterPanCHs: number[];
  var reflect: number[];
  var reflect2: number[];

  // FX and effects
  var FX: any;
  var flipBin: boolean;
  var flipBinF: number[];
  var flipBinT: number[];
  var flipBinF2: number[];
  var flipBinT2: number[];
  var flipBinF3: number[];
  var flipBinT3: number[];
  var binauralFreqOffset: number;
  var binauralPlus: number;
  var binauralMinus: number;
  var tuningPitchBend: number;
  var velocity: number;
  var beatCount: number;
  var beatsUntilBinauralShift: number;
  var bpmRatio: number;
  var bpmRatio2: number;
  var bpmRatio3: number;
  var measureCount: number;
  var rlFX: (ch: number, cc: number, min: number, max: number, condition?: (c: number) => boolean, condMin?: number, condMax?: number) => any;
  var allNotesOff: (tick?: number) => any[];
  var muteAll: () => void;

  // Writer utilities
  var CSVBuffer: any;
  var p: (...items: any[]) => void;
  var pushMultiple: (...items: any[]) => void;
  var c1: any;
  var c2: any;
  var c: any;
  var logUnit: (unitType: string) => void;
  var grandFinale: () => void;
  var _: any; // Temporary variable for object spreading

  // Rhythm functions
  var drummer: (drumNames: string[], beatOffsets: number[], offsetJitter: number, stutterChance: number, stutterRange: number[], stutterDecayFactor: number) => void;
  var euclid: (steps: number, pulses: number) => number[];
  var rotate: (pattern: number[], n: number) => number[];
  var morph: (patternA: number[], patternB: number[], amount: number) => number[];
  var setRhythm: (level: string) => number[];
  var makeOnsets: (pattern: number[]) => number[];
  var patternLength: (pattern: number[], length?: number) => number[];
  var closestDivisor: (target: number, divisors: number[]) => number;
  var getRhythm: (level: string) => number[];
  var trackBeatRhythm: () => void;
  var trackDivRhythm: () => void;
  var trackSubdivRhythm: () => void;
  var trackSubsubdivRhythm: () => void;
  var drumMap: Record<string, { note: number; velocityRange: number[] }>;

  // Stage and audio processing
  var stage: any;
  var fxManager: any;

  // Voice leading
  var VoiceLeadingScore: any;

  // Motif and composition
  var activeMotif: any;
  var applyMotifToNotes: (notes: any[], motif: any) => any[];
  var generateMotif: () => any;
  var transformMotif: (motif: any, transformation: string) => any;

  // Composers
  var composers: any[];
  var composer: any;
  var ComposerFactory: any;
  var ScaleComposer: any;
  var ChordComposer: any;
  var ModeComposer: any;
  var PentatonicComposer: any;
  var TensionReleaseComposer: any;
  var ModalInterchangeComposer: any;
  var MelodicDevelopmentComposer: any;
  var RandomScaleComposer: any;
  var MeasureComposer: any;
  var ProgressionGenerator: any;

  // Composition state
  var crossModulation: number;
  var lastCrossMod: number;
  var balOffset: number;
  var sideBias: number;
  var lBal: number;
  var rBal: number;
  var cBal: number;
  var cBal2: number;
  var cBal3: number;
  var refVar: number;
  var bassVar: number;
  var firstLoop: number;

  // Test namespace
  var __POLYCHRON_TEST__: {
    stage?: any;
    enableLogging?: boolean;
    [key: string]: any;
  };

  // Temporary variable for FX object spreading
  var _: any;

  // Play engine
  var initializePlayEngine: () => void;

  // ============================================================
  // POLYCHRON CONTEXT (centralized global state singleton)
  // ============================================================
  var PolychronContext: {
    utils: any;
    composers: any;
    state: Record<string, any>;
    test: Record<string, any>;
    initialized: boolean;
    init(): void;
  };
}

export {};
