/**
 * PolychronInit - Initialize the PolychronContext singleton
 * Called from play.ts after all modules are imported
 * Populates the context with utilities and state references
 */

import PolychronContext from './PolychronContext.js';
import type { IPolychronContext } from './PolychronContext.js';

export function initializePolychronContext(): IPolychronContext {
  if (PolychronContext.initialized) {
    return PolychronContext;
  }

  const g = globalThis as any;

  // ============================================================
  // POPULATE UTILS (immutable, stateless functions)
  // ============================================================
  PolychronContext.utils = {
    // Clamp functions
    m: Math,
    clamp: g.clamp,
    modClamp: g.modClamp,

    // Random generators
    rf: g.rf,
    ri: g.ri,
    rw: g.rw,
    rl: g.rl,
    rv: g.rv,

    // Aliases
    randomFloat: g.randomFloat,
    randomInt: g.randomInt,
    randomLimitedChange: g.randomLimitedChange,
    randomVariation: g.randomVariation,
    normalizeWeights: g.normalizeWeights,
  };

  // ============================================================
  // POPULATE COMPOSERS (class references)
  // ============================================================
  PolychronContext.composers = {
    MeasureComposer: g.MeasureComposer,
    ScaleComposer: g.ScaleComposer,
    RandomScaleComposer: g.RandomScaleComposer,
    ChordComposer: g.ChordComposer,
    RandomChordComposer: g.RandomChordComposer,
    ModeComposer: g.ModeComposer,
    RandomModeComposer: g.RandomModeComposer,
    PentatonicComposer: g.PentatonicComposer,
    RandomPentatonicComposer: g.RandomPentatonicComposer,
    ProgressionGenerator: g.ProgressionGenerator,
    TensionReleaseComposer: g.TensionReleaseComposer,
    ModalInterchangeComposer: g.ModalInterchangeComposer,
    MelodicDevelopmentComposer: g.MelodicDevelopmentComposer,
    AdvancedVoiceLeadingComposer: g.AdvancedVoiceLeadingComposer,
    VoiceLeadingScore: g.VoiceLeadingScore,
  };

  // ============================================================
  // POPULATE STATE (mutable global state)
  // ============================================================
  // State is proxied from globalThis to preserve mutation semantics
  // Compound assignments (+=, ++, --) require direct globalThis access
  PolychronContext.state = {
    bpmRatio: g.bpmRatio ?? 1,
    measureCount: g.measureCount ?? 0,
    subdivStart: g.subdivStart ?? 0,
    tpSec: g.tpSec ?? 0,
    subdivsOn: g.subdivsOn ?? 0,
    subdivsOff: g.subdivsOff ?? 0,
    divsOn: g.divsOn ?? 0,
    divsOff: g.divsOff ?? 0,
    beatsOn: g.beatsOn ?? 0,
    beatsOff: g.beatsOff ?? 0,
    numerator: g.numerator ?? 0,
    denominator: g.denominator ?? 0,
    divisions: g.divisions ?? 0,
    subdivisions: g.subdivisions ?? 0,
    beatsUntilBinauralShift: g.beatsUntilBinauralShift ?? 0,
  };

  // ============================================================
  // POPULATE TEST NAMESPACE (test-only state)
  // ============================================================
  PolychronContext.test = g.__POLYCHRON_TEST__ || {};

  // ============================================================
  // MARK AS INITIALIZED
  // ============================================================
  PolychronContext.initialized = true;

  // Expose to globalThis for debugging
  (globalThis as any).PolychronContext = PolychronContext;

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
