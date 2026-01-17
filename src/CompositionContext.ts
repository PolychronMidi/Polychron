// CompositionContext.ts - Encapsulates playhead state for compositions
// Provides alternative to global playhead variables while maintaining backward compatibility
// Initially keeps globals in sync, enables future DI migration

const g = globalThis as any;

/**
 * CompositionContext - Represents the current playhead position and timing state during composition.
 * Encapsulates all position tracking (sections, phrases, measures, beats) and timing calculations.
 *
 * Usage:
 *   const ctx = new CompositionContext();
 *   ctx.syncFromGlobals(); // Load current playhead position from globals
 *   ctx.sectionIndex; // Read current section
 *   ctx.syncToGlobals(); // Write changes back to globals
 *
 * Benefits:
 * - Type-safe access to playhead state
 * - Prepare for future DI-based architecture
 * - Enable context passing to composers (optional)
 * - Thread playhead through timing calculations
 *
 * Currently: Dual-mode (globals + context objects) for backward compatibility
 * Future: Can switch to context-only by removing global assignments in syncToGlobals()
 */
export interface PlayheadPosition {
  sectionIndex: number;
  phraseIndex: number;
  measureIndex: number;
  beatCount: number;
}

export interface PlayheadMarkers {
  sectionStart: number;
  phraseStart: number;
  measureStart: number;
  beatStart: number;
}

export interface RhythmState {
  beatRhythm: number[];
  divRhythm: number[];
  subdivRhythm: number[];
  subsubdivRhythm: number[];
}

export interface TimingState {
  tpBeat: number;
  tpMeasure: number;
  tpPhrase: number;
  tpSection: number;
  spBeat: number;
  spMeasure: number;
  spPhrase: number;
  spSection: number;
}

export class CompositionContext {
  // Position tracking (where we are in the composition)
  sectionIndex: number = 0;
  phraseIndex: number = 0;
  measureIndex: number = 0;
  beatCount: number = 0;

  // Additional position state
  noteCount: number = 0;
  phrasesPerSection: number = 0;
  measuresPerPhrase: number = 0;
  totalSections: number = 0;

  // Timing markers (tick positions for each level)
  sectionStart: number = 0;
  phraseStart: number = 0;
  measureStart: number = 0;
  beatStart: number = 0;

  // Timing markers (time positions)
  sectionStartTime: number = 0;
  phraseStartTime: number = 0;
  measureStartTime: number = 0;
  beatStartTime: number = 0;

  // Timing state (ticks per beat, measure, etc)
  tpBeat: number = 0;
  tpMeasure: number = 0;
  tpPhrase: number = 0;
  tpSection: number = 0;
  spBeat: number = 0;
  spMeasure: number = 0;
  spPhrase: number = 0;
  spSection: number = 0;

  // Rhythm patterns
  beatRhythm: number[] = [];
  divRhythm: number[] = [];
  subdivRhythm: number[] = [];
  subsubdivRhythm: number[] = [];

  /**
   * Load playhead position from global variables
   * Call after globals have been set by play engine
   */
  syncFromGlobals(): void {
    this.sectionIndex = g.sectionIndex ?? 0;
    this.phraseIndex = g.phraseIndex ?? 0;
    this.measureIndex = g.measureIndex ?? 0;
    this.beatCount = g.beatCount ?? 0;
    this.noteCount = g.noteCount ?? 0;
    this.phrasesPerSection = g.phrasesPerSection ?? 0;
    this.measuresPerPhrase = g.measuresPerPhrase ?? 0;
    this.totalSections = g.totalSections ?? 0;

    this.sectionStart = g.sectionStart ?? 0;
    this.phraseStart = g.phraseStart ?? 0;
    this.measureStart = g.measureStart ?? 0;
    this.beatStart = g.beatStart ?? 0;

    this.sectionStartTime = g.sectionStartTime ?? 0;
    this.phraseStartTime = g.phraseStartTime ?? 0;
    this.measureStartTime = g.measureStartTime ?? 0;
    this.beatStartTime = g.beatStartTime ?? 0;

    this.tpBeat = g.tpBeat ?? 0;
    this.tpMeasure = g.tpMeasure ?? 0;
    this.tpPhrase = g.tpPhrase ?? 0;
    this.tpSection = g.tpSection ?? 0;
    this.spBeat = g.spBeat ?? 0;
    this.spMeasure = g.spMeasure ?? 0;
    this.spPhrase = g.spPhrase ?? 0;
    this.spSection = g.spSection ?? 0;

    this.beatRhythm = g.beatRhythm ?? [];
    this.divRhythm = g.divRhythm ?? [];
    this.subdivRhythm = g.subdivRhythm ?? [];
    this.subsubdivRhythm = g.subsubdivRhythm ?? [];
  }

  /**
   * Write playhead state back to global variables
   * Maintains backward compatibility with code that reads globals
   * Future: Remove these assignments when migrating to context-only mode
   */
  syncToGlobals(): void {
    g.sectionIndex = this.sectionIndex;
    g.phraseIndex = this.phraseIndex;
    g.measureIndex = this.measureIndex;
    g.beatCount = this.beatCount;
    g.noteCount = this.noteCount;
    g.phrasesPerSection = this.phrasesPerSection;
    g.measuresPerPhrase = this.measuresPerPhrase;
    g.totalSections = this.totalSections;

    g.sectionStart = this.sectionStart;
    g.phraseStart = this.phraseStart;
    g.measureStart = this.measureStart;
    g.beatStart = this.beatStart;

    g.sectionStartTime = this.sectionStartTime;
    g.phraseStartTime = this.phraseStartTime;
    g.measureStartTime = this.measureStartTime;
    g.beatStartTime = this.beatStartTime;

    g.tpBeat = this.tpBeat;
    g.tpMeasure = this.tpMeasure;
    g.tpPhrase = this.tpPhrase;
    g.tpSection = this.tpSection;
    g.spBeat = this.spBeat;
    g.spMeasure = this.spMeasure;
    g.spPhrase = this.spPhrase;
    g.spSection = this.spSection;

    g.beatRhythm = this.beatRhythm;
    g.divRhythm = this.divRhythm;
    g.subdivRhythm = this.subdivRhythm;
    g.subsubdivRhythm = this.subsubdivRhythm;
  }

  /**
   * Reset all playhead state to defaults
   * Used in tests and composition resets
   */
  reset(): void {
    this.sectionIndex = 0;
    this.phraseIndex = 0;
    this.measureIndex = 0;
    this.beatCount = 0;
    this.noteCount = 0;
    this.phrasesPerSection = 0;
    this.measuresPerPhrase = 0;
    this.totalSections = 0;

    this.sectionStart = 0;
    this.phraseStart = 0;
    this.measureStart = 0;
    this.beatStart = 0;

    this.sectionStartTime = 0;
    this.phraseStartTime = 0;
    this.measureStartTime = 0;
    this.beatStartTime = 0;

    this.tpBeat = 0;
    this.tpMeasure = 0;
    this.tpPhrase = 0;
    this.tpSection = 0;
    this.spBeat = 0;
    this.spMeasure = 0;
    this.spPhrase = 0;
    this.spSection = 0;

    this.beatRhythm = [];
    this.divRhythm = [];
    this.subdivRhythm = [];
    this.subsubdivRhythm = [];
  }

  /**
   * Get current position snapshot
   */
  getPosition(): PlayheadPosition {
    return {
      sectionIndex: this.sectionIndex,
      phraseIndex: this.phraseIndex,
      measureIndex: this.measureIndex,
      beatCount: this.beatCount
    };
  }

  /**
   * Get current timing markers snapshot
   */
  getMarkers(): PlayheadMarkers {
    return {
      sectionStart: this.sectionStart,
      phraseStart: this.phraseStart,
      measureStart: this.measureStart,
      beatStart: this.beatStart
    };
  }

  /**
   * Get rhythm state snapshot
   */
  getRhythms(): RhythmState {
    return {
      beatRhythm: [...this.beatRhythm],
      divRhythm: [...this.divRhythm],
      subdivRhythm: [...this.subdivRhythm],
      subsubdivRhythm: [...this.subsubdivRhythm]
    };
  }

  /**
   * Get timing calculations snapshot
   */
  getTimingState(): TimingState {
    return {
      tpBeat: this.tpBeat,
      tpMeasure: this.tpMeasure,
      tpPhrase: this.tpPhrase,
      tpSection: this.tpSection,
      spBeat: this.spBeat,
      spMeasure: this.spMeasure,
      spPhrase: this.spPhrase,
      spSection: this.spSection
    };
  }
}

// Export singleton instance for convenience
export const compositionContext = new CompositionContext();

// Register on globals for backward compatibility
g.CompositionContext = CompositionContext;
g.compositionContext = compositionContext;
