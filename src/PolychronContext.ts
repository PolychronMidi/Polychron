/**
 * PolychronContext - Centralized singleton for all global state
 * Replaces 278+ legacy global assignments with structured access
 *
 * Architecture:
 * - utils: Immutable utility functions (random generators, math helpers)
 * - composers: Class constructors and factories
 * - state: Mutable state variables (bpmRatio, measureCount, etc.)
 * - test: Test-only namespace (isolated from production state)
 */

// ============================================================
// UTILITIES INTERFACE (immutable, stateless functions)
// ============================================================

export interface PolychronUtils {
  rf: (min?: number, max?: number) => number;
  ri: (min1?: number, max1?: number, min2?: number, max2?: number) => number;
  rw: (min: number, max: number, weights: number[]) => number;
  rl: (currentValue: number, minChange: number, maxChange: number, minValue: number, maxValue: number, type?: string) => number;
  rv: (value: number, boostRange?: number[], frequency?: number, deboostRange?: number[]) => number;
  ra: (arrayOrRange: any) => any; // select random from array or range
  m: Math;
  clamp: (value: number, min: number, max: number) => number;
  modClamp: (value: number, min: number, max: number) => number;
  lowModClamp?: (value: number, min: number, max: number) => number;
  highModClamp?: (value: number, min: number, max: number) => number;
  scaleClamp?: (value: number, min: number, max: number, factor: number, maxFactor?: number, base?: number) => number;
  scaleBoundClamp?: (value: number, base: number, lowerScale: number, upperScale: number, minBound?: number, maxBound?: number) => number;
  softClamp?: (value: number, min: number, max: number, softness?: number) => number;
  stepClamp?: (value: number, min: number, max: number, step: number) => number;
  logClamp?: (value: number, min: number, max: number, base?: number) => number;
  expClamp?: (value: number, min: number, max: number, base?: number) => number;
  normalizeWeights: (weights: number[], min: number, max: number, variationLow?: number, variationHigh?: number) => number[];
  randomFloat: (min?: number, max?: number) => number;
  randomInt: (min1?: number, max1?: number, min2?: number, max2?: number) => number;
  randomLimitedChange: (currentValue: number, minChange: number, maxChange: number, minValue: number, maxValue: number, type?: string) => number;
  randomVariation: (value: number, boostRange?: number[], frequency?: number, deboostRange?: number[]) => number;
  randomInRangeOrArray?: (v: any) => any;
  randomWeightedInRange?: (min: number, max: number, weights: number[]) => number;
  randomWeightedInArray?: (items: any[], weights?: number[]) => any;
  randomWeightedSelection?: (weights: number[], items: any[]) => any;
}

// ============================================================
// COMPOSERS INTERFACE (class references)
// ============================================================

export interface PolychronComposers {
  MeasureComposer?: any;
  ScaleComposer?: any;
  RandomScaleComposer?: any;
  ChordComposer?: any;
  RandomChordComposer?: any;
  ModeComposer?: any;
  RandomModeComposer?: any;
  PentatonicComposer?: any;
  RandomPentatonicComposer?: any;
  ProgressionGenerator?: any;
  TensionReleaseComposer?: any;
  ModalInterchangeComposer?: any;
  MelodicDevelopmentComposer?: any;
  AdvancedVoiceLeadingComposer?: any;
  HarmonicRhythmComposer?: any;
  VoiceLeadingScore?: any;
}

// ============================================================
// STATE INTERFACE (mutable global state)
// ============================================================

export interface PolychronState {
  // Timing
  bpmRatio: number;
  measureCount: number;
  subdivStart: number;
  tpSec: number;
  subdivsOn: number;
  subdivsOff: number;
  divsOn: number;
  divsOff: number;
  beatsOn: number;
  beatsOff: number;
  numerator: number;
  denominator: number;
  divisions: number;
  subdivisions: number;
  beatsUntilBinauralShift: number;

  // Music theory (from venue)
  t?: any; // Tonal library
  allNotes?: string[];
  allScales?: string[];
  allChords?: string[];
  allModes?: string[];
  midiData?: any;

  // Composer instances
  primaryComposer?: any;
  secondaryComposer?: any;

  // Other state
  [key: string]: any;
}

// ============================================================
// TEST CONTEXT (isolated test-only namespace)
// ============================================================

export interface PolychronTestContext {
  bpmRatio?: number;
  measureCount?: number;
  subdivStart?: number;
  [key: string]: any;
}

// ============================================================
// MAIN CONTEXT INTERFACE
// ============================================================

export interface IPolychronContext {
  utils: PolychronUtils;
  composers: PolychronComposers;
  state: PolychronState;
  test: PolychronTestContext;
  initialized: boolean;
  init(): void;
}

// ============================================================
// SINGLETON INSTANCE (lazy initialized)
// ============================================================

export const PolychronContext: IPolychronContext = {
  utils: {} as PolychronUtils,
  composers: {} as PolychronComposers,
  state: {
    bpmRatio: 1,
    measureCount: 0,
    subdivStart: 0,
    tpSec: 0,
    subdivsOn: 0,
    subdivsOff: 0,
    divsOn: 0,
    divsOff: 0,
    beatsOn: 0,
    beatsOff: 0,
    numerator: 0,
    denominator: 0,
    divisions: 0,
    subdivisions: 0,
    beatsUntilBinauralShift: 0,
  } as PolychronState,
  test: {} as PolychronTestContext,
  initialized: false,

  init() {
    if (this.initialized) return;
    // Lazy initialization will be done from backstage.ts
    // This is called during module initialization
    this.initialized = true;
  }
};



export default PolychronContext;
