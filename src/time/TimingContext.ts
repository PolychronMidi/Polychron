// TimingContext.ts - Timing state management for layers.
// minimalist comments, details at: time.md

import { getPolychronContext } from '../PolychronInit.js';

/**
 * TimingContext class - encapsulates all timing state for a layer.
 * Provides methods to save/restore timing state and advance timing.
 */
export class TimingContext {
  phraseStart: number;
  phraseStartTime: number;
  sectionStart: number;
  sectionStartTime: number;
  sectionEnd: number;
  tpSec: number;
  tpSection: number;
  spSection: number;
  numerator: number;
  denominator: number;
  measuresPerPhrase: number;
  tpPhrase: number;
  spPhrase: number;
  measureStart: number;
  measureStartTime: number;
  tpMeasure: number;
  spMeasure: number;
  meterRatio: number;
  bufferName: string;
  buffer?: any; // CSVBuffer or Array

  constructor(initialState: Partial<TimingContext> = {}) {
    this.phraseStart = initialState.phraseStart || 0;
    this.phraseStartTime = initialState.phraseStartTime || 0;
    this.sectionStart = initialState.sectionStart || 0;
    this.sectionStartTime = initialState.sectionStartTime || 0;
    this.sectionEnd = initialState.sectionEnd || 0;
    this.tpSec = initialState.tpSec || 0;
    this.tpSection = initialState.tpSection || 0;
    this.spSection = initialState.spSection || 0;
    this.numerator = initialState.numerator || 4;
    this.denominator = initialState.denominator || 4;
    this.measuresPerPhrase = initialState.measuresPerPhrase || 1;
    this.tpPhrase = initialState.tpPhrase || 0;
    this.spPhrase = initialState.spPhrase || 0;
    this.measureStart = initialState.measureStart || 0;
    this.measureStartTime = initialState.measureStartTime || 0;
    const poly = getPolychronContext();
    const defaultPPQ = (poly && poly.state && typeof poly.state.PPQ === 'number') ? poly.state.PPQ : 480;
    this.tpMeasure = initialState.tpMeasure || (defaultPPQ * 4);
    this.spMeasure = initialState.spMeasure || 0;
    this.meterRatio = initialState.meterRatio || (this.numerator / this.denominator);
    this.bufferName = initialState.bufferName || '';
  }

  /**
   * Save timing values from globals object.
   */
  saveFrom(globals: any): void {
    this.phraseStart = globals.phraseStart;
    this.phraseStartTime = globals.phraseStartTime;
    this.sectionStart = globals.sectionStart;
    this.sectionStartTime = globals.sectionStartTime;
    this.sectionEnd = globals.sectionEnd;
    this.tpSec = globals.tpSec;
    this.tpSection = globals.tpSection;
    this.spSection = globals.spSection;
    this.numerator = globals.numerator;
    this.denominator = globals.denominator;
    this.measuresPerPhrase = globals.measuresPerPhrase;
    this.tpPhrase = globals.tpPhrase;
    this.spPhrase = globals.spPhrase;
    this.measureStart = globals.measureStart;
    this.measureStartTime = globals.measureStartTime;
    this.tpMeasure = globals.tpMeasure;
    this.spMeasure = globals.spMeasure;
    this.meterRatio = globals.numerator / globals.denominator;
  }

  /**
   * Restore timing values to globals object.
   */
  restoreTo(globals: any): void {
    globals.phraseStart = this.phraseStart;
    globals.phraseStartTime = this.phraseStartTime;
    globals.sectionStart = this.sectionStart;
    globals.sectionStartTime = this.sectionStartTime;
    globals.sectionEnd = this.sectionEnd;
    globals.tpSec = this.tpSec;
    globals.tpSection = this.tpSection;
    globals.spSection = this.spSection;
    globals.tpPhrase = this.tpPhrase;
    globals.spPhrase = this.spPhrase;
    globals.measureStart = this.measureStart;
    globals.measureStartTime = this.measureStartTime;
    globals.tpMeasure = this.tpMeasure;
    globals.spMeasure = this.spMeasure;
  }

  /**
   * Advance phrase timing.
   */
  advancePhrase(tpPhrase: number, spPhrase: number): void {
    this.phraseStart += tpPhrase;
    this.phraseStartTime += spPhrase;
    this.tpSection += tpPhrase;
    this.spSection += spPhrase;
  }

  /**
   * Advance section timing.
   */
  advanceSection(): void {
    this.sectionStart += this.tpSection;
    this.sectionStartTime += this.spSection;
    this.sectionEnd += this.tpSection;
    this.tpSection = 0;
    this.spSection = 0;
  }
}
