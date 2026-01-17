/**
 * CompositionState - Central composition engine state management
 * Replaces scattered globalThis assignments with a centralized, injectable service
 * Holds all mutable state for the current composition run
 */

export interface CompositionState {
  // Section state
  sectionIndex: number;
  totalSections: number;
  sectionStart: number;
  sectionStartTime: number;
  sectionEnd: number;
  currentSectionType: string;
  currentSectionDynamics: string;

  // Phrase state
  phraseIndex: number;
  phrasesPerSection: number;
  phraseStart: number;
  phraseStartTime: number;
  measuresPerPhrase: number;
  measuresPerPhrase1: number;
  measuresPerPhrase2: number;

  // Measure state
  measureIndex: number;
  measureStart: number;
  measureStartTime: number;
  measureCount: number;

  // Beat state
  beatIndex: number;
  numerator: number;
  denominator: number;
  beatCount: number;
  beatStart: number;
  beatStartTime: number;
  divsPerBeat: number;

  // Division state
  divIndex: number;
  divStart: number;
  divStartTime: number;
  subdivsPerDiv: number;

  // Subdivision state
  subdivIndex: number;
  subdivStart: number;
  subdivStartTime: number;
  subsubdivIndex: number;
  subsubsPerSub: number;
  subsubdivStart: number;
  subsubdivStartTime: number;

  // Timing values (ticks per unit, seconds per unit)
  tpSection: number;
  spSection: number;
  tpPhrase: number;
  spPhrase: number;
  tpMeasure: number;
  spMeasure: number;
  tpBeat: number;
  spBeat: number;
  tpDiv: number;
  spDiv: number;
  tpSubdiv: number;
  spSubdiv: number;
  tpSubsubdiv: number;
  spSubsubdiv: number;
  tpSec: number;

  // Rhythm patterns (arrays of 0/1)
  beatRhythm: number[];
  divRhythm: number[];
  subdivRhythm: number[];
  subsubdivRhythm: number[];

  // Rhythm counters
  beatsOn: number;
  beatsOff: number;
  divsOn: number;
  divsOff: number;
  subdivsOn: number;
  subdivsOff: number;

  // BPM and timing
  BASE_BPM: number;
  BPM: number;
  midiBPM: number;
  bpmRatio3: number;
  meterRatio: number;
  midiMeterRatio: number;
  syncFactor: number;

  // Polyrhythm state
  polyNumerator: number;
  polyDenominator: number;
  polyMeterRatio: number;

  // Active composer and motif
  composer: any;
  activeMotif: any;

  // Binaural/stutter state
  beatCount: number;
  beatsUntilBinauralShift: number;
  flipBin: boolean;
  binauralFreqOffset: number;
  binauralMinus: number;
  binauralPlus: number;
  crossModulation: number;
  lastCrossMod: number;
  velocity: number;
  flipBinT3: number;
  flipBinF3: number;
  stutterPanCHs: number[];

  // Logging
  LOG: string;
}

export class CompositionStateService implements CompositionState {
  // Section state
  sectionIndex = 0;
  totalSections = 0;
  sectionStart = 0;
  sectionStartTime = 0;
  sectionEnd = 0;
  currentSectionType = '';
  currentSectionDynamics = '';

  // Phrase state
  phraseIndex = 0;
  phrasesPerSection = 0;
  phraseStart = 0;
  phraseStartTime = 0;
  measuresPerPhrase = 0;
  measuresPerPhrase1 = 0;
  measuresPerPhrase2 = 0;

  // Measure state
  measureIndex = 0;
  measureStart = 0;
  measureStartTime = 0;
  measureCount = 0;

  // Beat state
  beatIndex = 0;
  numerator = 4;
  denominator = 4;
  beatCount = 0;
  beatStart = 0;
  beatStartTime = 0;
  divsPerBeat = 0;

  // Division state
  divIndex = 0;
  divStart = 0;
  divStartTime = 0;
  subdivsPerDiv = 0;

  // Subdivision state
  subdivIndex = 0;
  subdivStart = 0;
  subdivStartTime = 0;
  subsubdivIndex = 0;
  subsubsPerSub = 0;
  subsubdivStart = 0;
  subsubdivStartTime = 0;

  // Timing values
  tpSection = 0;
  spSection = 0;
  tpPhrase = 0;
  spPhrase = 0;
  tpMeasure = 0;
  spMeasure = 0;
  tpBeat = 0;
  spBeat = 0;
  tpDiv = 0;
  spDiv = 0;
  tpSubdiv = 0;
  spSubdiv = 0;
  tpSubsubdiv = 0;
  spSubsubdiv = 0;
  tpSec = 960;

  // Rhythm patterns
  beatRhythm: number[] = [];
  divRhythm: number[] = [];
  subdivRhythm: number[] = [];
  subsubdivRhythm: number[] = [];

  // Rhythm counters
  beatsOn = 0;
  beatsOff = 0;
  divsOn = 0;
  divsOff = 0;
  subdivsOn = 0;
  subdivsOff = 0;

  // BPM and timing
  BASE_BPM = 120;
  BPM = 120;
  midiBPM = 120;
  bpmRatio3 = 1;
  meterRatio = 1;
  midiMeterRatio = 1;
  syncFactor = 1;

  // Polyrhythm state
  polyNumerator = 4;
  polyDenominator = 4;
  polyMeterRatio = 1;

  // Active composer and motif
  composer: any = null;
  activeMotif: any = null;

  // Binaural/stutter state
  beatsUntilBinauralShift = 0;
  flipBin = false;
  binauralFreqOffset = 0;
  binauralMinus = -10;
  binauralPlus = 10;
  crossModulation = 2.5;
  lastCrossMod = 0;
  velocity = 99;
  flipBinT3 = 0;
  flipBinF3 = 0;
  stutterPanCHs: number[] = [];

  // Logging
  LOG = 'none';

  /**
   * Sync state with globalThis
   */
  syncToGlobal() {
    const g = globalThis as any;
    g.sectionIndex = this.sectionIndex;
    g.totalSections = this.totalSections;
    g.sectionStart = this.sectionStart;
    g.phraseIndex = this.phraseIndex;
    g.phrasesPerSection = this.phrasesPerSection;
    g.phraseStart = this.phraseStart;
    g.measureIndex = this.measureIndex;
    g.measureStart = this.measureStart;
    g.beatIndex = this.beatIndex;
    g.numerator = this.numerator;
    g.denominator = this.denominator;
    g.beatCount = this.beatCount;
    g.beatStart = this.beatStart;
    g.divsPerBeat = this.divsPerBeat;
    g.divIndex = this.divIndex;
    g.divStart = this.divStart;
    g.subdivsPerDiv = this.subdivsPerDiv;
    g.subdivIndex = this.subdivIndex;
    g.subdivStart = this.subdivStart;
    g.subsubdivIndex = this.subsubdivIndex;
    g.composer = this.composer;
    g.activeMotif = this.activeMotif;
    g.BPM = this.BPM;
    g.beatRhythm = this.beatRhythm;
    g.divRhythm = this.divRhythm;
    g.subdivRhythm = this.subdivRhythm;
    g.LOG = this.LOG;
  }

  /**
   * Sync state from globalThis (for test setup compatibility)
   */
  syncFromGlobal() {
    const g = globalThis as any;
    if (g.sectionIndex !== undefined) this.sectionIndex = g.sectionIndex;
    if (g.totalSections !== undefined) this.totalSections = g.totalSections;
    if (g.phraseIndex !== undefined) this.phraseIndex = g.phraseIndex;
    if (g.measureIndex !== undefined) this.measureIndex = g.measureIndex;
    if (g.beatIndex !== undefined) this.beatIndex = g.beatIndex;
    if (g.numerator !== undefined) this.numerator = g.numerator;
    if (g.denominator !== undefined) this.denominator = g.denominator;
    if (g.beatCount !== undefined) this.beatCount = g.beatCount;
    if (g.divIndex !== undefined) this.divIndex = g.divIndex;
    if (g.subdivIndex !== undefined) this.subdivIndex = g.subdivIndex;
    if (g.subsubdivIndex !== undefined) this.subsubdivIndex = g.subsubdivIndex;
    if (g.composer !== undefined) this.composer = g.composer;
    if (g.activeMotif !== undefined) this.activeMotif = g.activeMotif;
    if (g.BPM !== undefined) this.BPM = g.BPM;
    if (g.LOG !== undefined) this.LOG = g.LOG;
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.sectionIndex = 0;
    this.totalSections = 0;
    this.phraseIndex = 0;
    this.measureIndex = 0;
    this.beatIndex = 0;
    this.beatCount = 0;
    this.divIndex = 0;
    this.subdivIndex = 0;
    this.subsubdivIndex = 0;
    this.composer = null;
    this.activeMotif = null;
    this.BPM = this.BASE_BPM;
    this.LOG = 'none';
  }
}
