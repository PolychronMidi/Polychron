/**
 * PolychronInit - Initialize the PolychronContext singleton
 * Called from play.ts after all modules are imported
 * Populates the context with utilities and state references
 */

import PolychronContext from './PolychronContext.js';
import type { IPolychronContext } from './PolychronContext.js';
import * as Utils from './utils.js';
import * as Composers from './composers.js';

export function initializePolychronContext(): IPolychronContext {
  if (PolychronContext.initialized) {
    return PolychronContext;
  }

  // Populate utils directly from module imports to enforce DI-only usage
  PolychronContext.utils = {
    m: Math,
    clamp: Utils.clamp,
    modClamp: Utils.modClamp,
    lowModClamp: Utils.lowModClamp,
    highModClamp: Utils.highModClamp,
    scaleClamp: Utils.scaleClamp,
    scaleBoundClamp: Utils.scaleBoundClamp,
    softClamp: Utils.softClamp,
    stepClamp: Utils.stepClamp,
    logClamp: Utils.logClamp,
    expClamp: Utils.expClamp,
    rf: Utils.rf,
    ri: Utils.ri,
    ra: Utils.ra,
    rw: Utils.rw,
    rl: Utils.rl,
    rv: Utils.rv,
    randomFloat: Utils.randomFloat,
    randomInt: Utils.randomInt,
    randomLimitedChange: Utils.randomLimitedChange,
    randomVariation: Utils.randomVariation,
    randomWeightedInRange: Utils.randomWeightedInRange,
    randomWeightedInArray: Utils.randomWeightedInArray,
    randomWeightedSelection: Utils.randomWeightedSelection,
    normalizeWeights: Utils.normalizeWeights,
  };

  // ============================================================
  // POPULATE COMPOSERS (class references)
  // ============================================================
  PolychronContext.composers = {
    MeasureComposer: Composers.MeasureComposer,
    ScaleComposer: Composers.ScaleComposer,
    RandomScaleComposer: Composers.RandomScaleComposer,
    ChordComposer: Composers.ChordComposer,
    RandomChordComposer: Composers.RandomChordComposer,
    ModeComposer: Composers.ModeComposer,
    RandomModeComposer: Composers.RandomModeComposer,
    PentatonicComposer: Composers.PentatonicComposer,
    RandomPentatonicComposer: Composers.RandomPentatonicComposer,
    ProgressionGenerator: Composers.ProgressionGenerator,
    TensionReleaseComposer: Composers.TensionReleaseComposer,
    ModalInterchangeComposer: Composers.ModalInterchangeComposer,
    MelodicDevelopmentComposer: Composers.MelodicDevelopmentComposer,
    AdvancedVoiceLeadingComposer: Composers.AdvancedVoiceLeadingComposer,
  };

  // ============================================================
  // POPULATE STATE (mutable state copied from context defaults)
  // ============================================================
  PolychronContext.state = {
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
  };

  // ============================================================
  // POPULATE TEST NAMESPACE (test-only state)
  // ============================================================
  PolychronContext.test = (globalThis as any).__POLYCHRON_TEST__ || {};

  // ============================================================
  // MARK AS INITIALIZED
  // ============================================================
  PolychronContext.initialized = true;



  return PolychronContext;
}

/**
 * Get the PolychronContext singleton (lazy initialization)
 */
export function getPolychronContext(): IPolychronContext {
  if (!PolychronContext.initialized) {
    return initializePolychronContext();
  }
  return PolychronContext;
}

export default PolychronContext;
