/**
 * CompositionState - Central composition engine state management
 * Replaces scattered global assignments with a centralized, injectable service
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
  subsubdivsPerSub: number;
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
  PPQ: number;
  bpmRatio3: number;
  meterRatio: number;
  midiMeter: [number, number];
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
  beatsUntilBinauralShift: number;
  flipBin: boolean;
  binauralFreqOffset: number;
  binauralMinus: number;
  binauralPlus: number;
  crossModulation: number;
  lastCrossMod: number;
  velocity: number;
  flipBinT3: number[];
  flipBinF3: number[];
  stutterPanCHs: number[];
  // Backwards-compatible divisions alias
  divisions: number;

  // Sections config for testing
  SECTIONS?: { min: number; max: number };

  // Logging
  LOG: string;
}

import { getPolychronContext } from './PolychronInit.js';

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
  subsubdivsPerSub = 0;
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
  PPQ = 480;
  bpmRatio3 = 1;
  meterRatio = 1;
  midiMeter: [number, number] = [4, 4];
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
  flipBinT3: number[] = [];
  flipBinF3: number[] = [];
  stutterPanCHs: number[] = [];  // Backwards-compatible divisions alias
  divisions = 4;

  // Migration helpers and DI-provided instruments/state
  unitLabel?: string;
  _skipHandoffEnforcement = false;
  _enforceHandoffs = false;
  primaryInstrument: any = undefined;
  secondaryInstrument: any = undefined;
  bassInstrument: any = undefined;
  bassInstrument2: any = undefined;
  balOffset: number = 0;
  sideBias: number = 0;
  lBal: number = 0;
  rBal: number = 0;
  cBal: number = 64;
  cBal2: number = 64;
  bassVar: number = 0;
  subdivsPerMinute: number = 0;

  // Sections config for testing (allows tests to seed section ranges into state)
  SECTIONS = { min: 1, max: 1 };

  // Logging
  LOG = 'none';

  /**
   * Sync state with DI namespaces (poly.state & poly.test)
   */
  syncToGlobal() {
    // Sync to PolychronContext.state and PolychronContext.test for legacy compatibility without globals
    const poly = getPolychronContext();
    poly.state = poly.state || {} as any;
    poly.test = poly.test || {} as any;

    // State vars
    poly.state.sectionIndex = this.sectionIndex;
    // Only write totalSections if it's a valid positive number. This avoids transient writes of 0
    // during initialization that can overwrite a previously-computed non-zero value.
    if (Number.isFinite(this.totalSections) && this.totalSections > 0) {
      poly.state.totalSections = this.totalSections;
    } else {
      // skip writing invalid/zero totalSections (keep existing poly.state.totalSections if present)
    }
    try { import('./trace.js').then(({ trace }) => trace('anomaly', '[traceroute] syncToGlobal wrote totalSections', { polyTotalSections: poly.state.totalSections })).catch(() => {}); } catch (_e) {}
    poly.state.sectionStart = this.sectionStart;
    poly.state.phraseIndex = this.phraseIndex;
    poly.state.phrasesPerSection = this.phrasesPerSection;
    poly.state.phraseStart = this.phraseStart;
    poly.state.measureIndex = this.measureIndex;
    poly.state.measureStart = this.measureStart;
    poly.state.beatIndex = this.beatIndex;
    poly.state.numerator = this.numerator;
    poly.state.denominator = this.denominator;
    poly.state.beatCount = this.beatCount;
    poly.state.beatStart = this.beatStart;
    poly.state.divsPerBeat = this.divsPerBeat;
    poly.state.divisions = this.divisions;
    poly.state.divIndex = this.divIndex;
    poly.state.divStart = this.divStart;
    poly.state.subdivsPerDiv = this.subdivsPerDiv;
    poly.state.subdivIndex = this.subdivIndex;
    poly.state.subdivStart = this.subdivStart;
    poly.state.subsubdivIndex = this.subsubdivIndex;
    poly.state.composer = this.composer;
    poly.state.activeMotif = this.activeMotif;
    poly.state.BPM = this.BPM;
    poly.state.beatRhythm = this.beatRhythm;
    poly.state.divRhythm = this.divRhythm;
    poly.state.subdivRhythm = this.subdivRhythm;
    poly.state.measuresPerPhrase = this.measuresPerPhrase;
    poly.state.SECTIONS = this.SECTIONS;

    // Test namespace for logging/legacy read
    poly.test.LOG = this.LOG;

    // Do NOT write to the real global object; only keep DI-friendly namespaces in sync
    poly.state = poly.state || {} as any; // ensure state exists
  }

  /**
   * Sync state from DI namespaces (for test setup)
   */
  syncFromGlobal() {
    const poly = getPolychronContext();
    const gState = poly.state || {} as any;
    const gTest = poly.test || {} as any;

    // First read from the DI-friendly namespaces
    if (gState.sectionIndex !== undefined) this.sectionIndex = gState.sectionIndex;
    // Accept totalSections from global only when it is a valid positive number; ignore zero/invalid writes
    if (gState.totalSections !== undefined && Number.isFinite(gState.totalSections) && gState.totalSections > 0) {
      this.totalSections = gState.totalSections;
    } else {
      // ignore transient or invalid totalSections from global state
    }
    try { import('./trace.js').then(({ trace }) => trace('anomaly', '[traceroute] syncFromGlobal read totalSections', { polyTotalSections: gState.totalSections, thisTotalSections: this.totalSections })).catch(() => {}); } catch (_e) {}
    if (gState.phraseIndex !== undefined) this.phraseIndex = gState.phraseIndex;
    if (gState.measureIndex !== undefined) this.measureIndex = gState.measureIndex;
    if (gState.beatIndex !== undefined) this.beatIndex = gState.beatIndex;
    if (gState.numerator !== undefined) this.numerator = gState.numerator;
    if (gState.denominator !== undefined) this.denominator = gState.denominator;
    if (gState.beatCount !== undefined) this.beatCount = gState.beatCount;
    if (gState.divIndex !== undefined) this.divIndex = gState.divIndex;
    if (gState.divisions !== undefined) this.divisions = gState.divisions;
    if (gState.subdivIndex !== undefined) this.subdivIndex = gState.subdivIndex;
    if (gState.subsubdivIndex !== undefined) this.subsubdivIndex = gState.subsubdivIndex;
    if (gState.composer !== undefined) this.composer = gState.composer;
    if (gState.activeMotif !== undefined) this.activeMotif = gState.activeMotif;
    if (gState.BPM !== undefined) this.BPM = gState.BPM;
    if (gState.measuresPerPhrase !== undefined) this.measuresPerPhrase = gState.measuresPerPhrase;
    if (gState.SECTIONS !== undefined) this.SECTIONS = gState.SECTIONS;
    if (gState.flipBinT3 !== undefined) this.flipBinT3 = gState.flipBinT3;
    if (gState.flipBinF3 !== undefined) this.flipBinF3 = gState.flipBinF3;
    if (gTest.LOG !== undefined) this.LOG = gTest.LOG;

    // Do not read from the real global object; DI namespaces are authoritative (poly.state & poly.test)
    // (no-op - already read from poly.state and poly.test above)
  }

  /**
   * Reset to initial state
   */
  reset() {
    try { import('./trace.js').then(({ trace }) => trace('anomaly', '[traceroute] CompositionState.reset() called', new Error().stack)).catch(() => {}); } catch (_e) {}
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
