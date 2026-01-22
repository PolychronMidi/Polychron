// play.ts - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md

// Import all dependencies in correct order
import './sheet.js';       // Constants and configuration
import './venue.js';       // Music theory (scales, chords)
import './backstage.js';   // Utilities and global state
import { registerWriterServices } from './writer.js';      // Output functions (DI registration)
import { registerTimeServices } from './time.js';        // Timing functions (DI registration)
import './composers.js';   // Composer classes
import './motifs.js';      // Motif generation
import './rhythm.js';      // Rhythm generation
import { playDrums, playDrums2 } from './rhythm.js';
import './fxManager.js';   // FX processing
import { fxManager } from './fxManager.js';
import './stage.js';       // Audio processing
import './structure.js';   // Section structure
import { resolveSectionProfile } from './structure.js';
import { Motif, clampMotifNote } from './motifs.js';
import { LayerManager } from './time/LayerManager.js';
import ComposerRegistry from './ComposerRegistry.js';

// Initialize PolychronContext
import { initializePolychronContext, getPolychronContext } from './PolychronInit.js';

// Dependency Injection Container
import { DIContainer } from './DIContainer.js';
import { Stage } from './stage.js';
import { CompositionStateService } from './CompositionState.js';
import { CancellationToken, CancellationTokenImpl, CompositionEventBusImpl, CompositionPhase } from './CompositionProgress.js';
import { ProgressCallback, CompositionProgress } from './CompositionProgress.js';

// Import utilities
import { rf, ri, ra, clamp } from './utils.js';

// Import composition context
import {
  createCompositionContext,
  ICompositionContext
} from './CompositionContext.js';

// Declare global dependencies
declare const BPM: number;
declare const SECTIONS: { min: number; max: number };
declare const COMPOSERS: any[];
declare const m: any;
declare const p: any;
declare const LM: any;

// Global mutable state for composition hierarchy
declare let composers: any[];
declare let BASE_BPM: number;
declare let sectionIndex: number;
declare let totalSections: number;
declare let phraseIndex: number;
declare let phrasesPerSection: number;
declare let currentSectionType: string;
declare let currentSectionDynamics: string;
declare let measureIndex: number;
declare let measuresPerPhrase: number;
declare let beatIndex: number;
declare let numerator: number;
declare let denominator: number;
declare let divsPerBeat: number;
declare let divIndex: number;
declare let subdivIndex: number;
declare let subdivsPerDiv: number;
declare let subsubdivIndex: number;
declare let subsubdivsPerSub: number;
declare let beatCount: number;
declare let measureCount: number;
declare let flipBin: boolean;
declare let flipBinT3: number;
declare let flipBinF3: number;
declare let stutterPanCHs: number[];
declare let activeMotif: any;
declare let composer: any;

// ============================================================
// Service Registration for Dependency Injection
// ============================================================

// Module-level composition context (Step 12: Context threading)
// Made available during composition to replace globals
let currentCompositionContext: ICompositionContext | null = null;

/**
 * Set the current composition context for use by module functions
 * This replaces global state with context-based architecture
 */
const setCurrentCompositionContext = (ctx: ICompositionContext | null): void => {
  currentCompositionContext = ctx;
};

/**
 * Get the current composition context
 * Returns null if no composition is in progress
 */
const getCurrentCompositionContext = (): ICompositionContext | null => {
  return currentCompositionContext;
};

/**
 * Helper to get a value from context state, with fallback to global
// Part of Step 13: Remove global fallbacks
 *
 * Usage:
 *   const bpm = getContextValue((ctx) => ctx.state.BPM, 'BPM');
 *   const beatIndex = getContextValue((ctx) => ctx.state.beatIndex);
 */
const getContextValue = <T>(
  contextGetter: (ctx: ICompositionContext) => T,
  globalKey?: string
): T => {
  const ctx = currentCompositionContext;
  if (ctx) {
    try {
      return contextGetter(ctx);
    } catch (e) {
      // Fallback to PolychronContext state if context property doesn't exist
    }
  }

  // Fallback to PolychronContext state value
  if (globalKey) {
    return getPolychronContext().state?.[globalKey];
  }

  return undefined as any;
};

const registerCoreServices = (container: DIContainer) => {
  const poly = getPolychronContext();
  const g = poly.test || {} as any;

  // Register configuration service (singleton)
  container.register(
    'config',
    () => ({
      BPM: g.BPM,
      SECTIONS: g.SECTIONS,
      COMPOSERS: g.COMPOSERS,
    }),
    'singleton'
  );

  // Register EventBus service (singleton)
  container.register(
    'eventBus',
    () => g.eventBus || { emit: () => {}, on: () => {}, off: () => {} },
    'singleton'
  );

  // Register ComposerRegistry (singleton)
  container.register(
    'registry',
    () => ComposerRegistry.getInstance(),
    'singleton'
  );

  // Register FX Manager (singleton)
  container.register(
    'fxManager',
    () => fxManager,
    'singleton'
  );

  // Register Stage (singleton, depends on fxManager)
  container.register(
    'stage',
    () => new Stage(container.get('fxManager')),
    'singleton'
  );

  // Register LayerManager (singleton) using DI-friendly import
  container.register(
    'layerManager',
    () => LayerManager,
    'singleton'
  );

  // Register writer services via DI (preferred)
  // This ensures writer implementations (pushMultiple, grandFinale, CSVBuffer) are
  // provided by the `writer` module via `registerWriterServices(container)`.
  try {
    // Register writer services (no-op if already registered)
    // Use static import to avoid top-level await in this module
    registerWriterServices(container);
    // DEBUG: Confirm registration
    // console.log('registerWriterServices called; keys:', container.getServiceKeys());
  } catch (e) {
    console.warn('registerWriterServices not available; falling back to legacy writer globals');
  }

  try {
    // Register timing services for DI consumers
    registerTimeServices(container);
  } catch (e) {
    console.warn('registerTimeServices not available');
  }

  // Expose a composite `writers` helper that maps to DI-backed functions when available
  container.register(
    'writers',
    () => ({
      addToCSV: container.has('pushMultiple') ? container.get('pushMultiple') : g.addToCSV,
      emitMIDI: container.has('grandFinale') ? container.get('grandFinale') : g.grandFinale
    }),
    'singleton'
  );

  // Register CompositionState (singleton)
  container.register(
    'compositionState',
    () => new CompositionStateService(),
    'singleton'
  );

  // Register class factories (composers, utils) from globals
  // These are set by module imports and will be available on globalThis
  container.register('MeasureComposer', () => g.MeasureComposer, 'singleton');
  container.register('ScaleComposer', () => g.ScaleComposer, 'singleton');
  container.register('RandomScaleComposer', () => g.RandomScaleComposer, 'singleton');
  container.register('ChordComposer', () => g.ChordComposer, 'singleton');
  container.register('RandomChordComposer', () => g.RandomChordComposer, 'singleton');
  container.register('ModeComposer', () => g.ModeComposer, 'singleton');
  container.register('RandomModeComposer', () => g.RandomModeComposer, 'singleton');
  container.register('PentatonicComposer', () => g.PentatonicComposer, 'singleton');
  container.register('RandomPentatonicComposer', () => g.RandomPentatonicComposer, 'singleton');
  container.register('ProgressionGenerator', () => g.ProgressionGenerator, 'singleton');
  // VoiceLeadingScore imported directly in MeasureComposer - no global registration needed

  // Register music theory utilities from venue.js
  container.register('t', () => g.t, 'singleton');
  container.register('midiData', () => g.midiData, 'singleton');
  container.register('getMidiValue', () => g.getMidiValue, 'singleton');
  container.register('allNotes', () => g.allNotes, 'singleton');
  container.register('allScales', () => g.allScales, 'singleton');
  container.register('allChords', () => g.allChords, 'singleton');
  container.register('allModes', () => g.allModes, 'singleton');
};

// Initialize the composition engine
const initializePlayEngine = async (
  progressCallback?: ProgressCallback,
  cancellationToken?: CancellationToken
): Promise<ICompositionContext> => {
  const poly = getPolychronContext();
  const g = poly.test || {} as any;

  // Report initialization phase
  progressCallback?.({
    phase: 'initializing',
    progress: 0,
    message: 'Initializing composition engine'
  });

  // Check for cancellation
  cancellationToken?.throwIfRequested();

  // Initialize PolychronContext singleton (lazy, on first engine startup)
  initializePolychronContext();

  // Initialize DI Container and register core services
  const container = new DIContainer();
  registerCoreServices(container);
  // Expose DI container to the test namespace (avoid globalThis writes)
  poly.test = poly.test || {};
  poly.test.DIContainer = container;  // Make available on PolychronContext.test for testing/debugging

  // registerCoreServices called; writer services should be available on the container

  const compositionState = container.get('compositionState');
  // First import any test-seeded values from poly.state into the composition state
  compositionState.syncFromGlobal();
  // Apply explicit test-provided overrides where present
  compositionState.BASE_BPM = g.BPM ?? poly.state?.BPM ?? compositionState.BASE_BPM;
  compositionState.LOG = g.LOG !== undefined ? g.LOG : compositionState.LOG;
  // Persist authoritative composition state back into the DI test namespace
  compositionState.syncToGlobal();


  // Create composition context (Step 12: Context threading)
  // This encapsulates all state and services needed during composition
  const ctx = createCompositionContext(
    container,
    g.eventBus || container.get('eventBus') || { emit: () => {}, on: () => {}, off: () => {} },
    {
      BPM: g.BPM ?? container.get('config').BPM,
      PPQ: g.PPQ || 480,
      SECTIONS: g.SECTIONS ?? compositionState.SECTIONS ?? container.get('config').SECTIONS,
      COMPOSERS: g.COMPOSERS ?? container.get('config').COMPOSERS
    },
    progressCallback,
    cancellationToken,
    g.c || { rows: [] },
    g.LOG || 'none'
  );

  // Ensure the DI-provided compositionState singleton is used by the context
  ctx.state = compositionState;

  // Ensure ctx-level BPM/PPQ reflect the authoritative composition state so timing
  // functions like getMidiTiming have the expected inputs
  ctx.BPM = compositionState.BPM ?? g.BPM ?? compositionState.BASE_BPM ?? 120;
  ctx.PPQ = g.PPQ ?? compositionState.PPQ ?? 480;

  // Ensure the composition context also has writer services available (defensive)
  try {
    registerWriterServices((ctx as any).services || (ctx as any).container);
  } catch (e) {
    // If registration fails, continue and let requirePush throw meaningful error downstream
  }

  // Make context available to module functions
  setCurrentCompositionContext(ctx);

  // Ensure LOG from ctx is set in state (no globals)
  (ctx as any).state.LOG = ctx.LOG;

  // Provide DI-based LayerManager and stage references on context
  (ctx as any).LM = container.get('layerManager');
  (ctx as any).stage = container.get('stage');

  // Provide file system via DI-friendly require
  (ctx as any).fs = require('fs');
  // Do not overwrite ctx.PPQ if already set by composition state or config
  if (typeof g.PPQ === 'number') {
    (ctx as any).PPQ = g.PPQ;
  }
  (ctx as any).SILENT_OUTRO_SECONDS = g.SILENT_OUTRO_SECONDS;

  const BASE_BPM = g.BPM;

  // Initialize composers from configuration using ComposerRegistry, but respect a pre-seeded ctx.state.composer (used by tests)
  // Prepare a composers array from DI test namespace, seeded ctx.state, or configuration
  let composersArray: any[] = (g.composers && g.composers.length) ? g.composers : ((g.COMPOSERS && g.COMPOSERS.length) ? g.COMPOSERS : []);
  if (!composersArray.length && ctx.state && ctx.state.composer) {
    composersArray = [ctx.state.composer];
  }
  if (!composersArray.length) {
    const registry = container.get('registry');
    const composersConfig = (container.get('config') && container.get('config').COMPOSERS) || g.COMPOSERS || [];
    composersArray = composersConfig.map((config: any) => registry.create(config));
  }

  // Normalize composers array to ensure instances (with getMeter) are present
  const registry = container.get('registry');
  composersArray = composersArray.map((c: any) => {
    if (c && typeof c.getMeter === 'function') return c;
    if (c && c.type) return registry.create(c);
    if (typeof c === 'function') {
      try { const inst = new c(); if (inst && typeof inst.getMeter === 'function') return inst; } catch (e) {}
    }
    return c;
  });

  g.composers = composersArray;

  // Resolve stage from container and assign to context and globals
  g.stage = container.get('stage');
  (ctx as any).stage = g.stage;

  const { state: primary, buffer: c1 } = ctx.LM.register('primary', 'c1', {}, () => ctx.stage.setTuningAndInstruments());
  const { state: polyState, buffer: c2 } = ctx.LM.register('poly', 'c2', {}, () => ctx.stage.setTuningAndInstruments());

  // Use DI-provided randomInt (ri) from PolychronContext rather than relying on g.ri global
  const { ri: riFn } = getPolychronContext().utils;
  const sectionsCfg = g.SECTIONS || (container.get('config') && container.get('config').SECTIONS) || { min: 1, max: 1 };
  ctx.state.totalSections = typeof riFn === 'function' ? riFn(sectionsCfg.min, sectionsCfg.max) : 1;

  // Report composing phase started
  progressCallback?.({
    phase: 'composing',
    progress: 5,
    totalSections: ctx.state.totalSections,
    message: `Starting composition: ${ctx.state.totalSections} sections`
  });

  cancellationToken?.throwIfRequested();

  for (ctx.state.sectionIndex = 0; ctx.state.sectionIndex < ctx.state.totalSections; ctx.state.sectionIndex++) {
    // Sync minimal state to globals for legacy consumers and report progress
    ctx.state.syncToGlobal();

    const sectionProgress = 5 + (ctx.state.sectionIndex / ctx.state.totalSections) * 85;
    progressCallback?.({
      phase: 'composing',
      progress: sectionProgress,
      sectionIndex: ctx.state.sectionIndex,
      totalSections: ctx.state.totalSections,
      message: `Composing section ${ctx.state.sectionIndex + 1}/${ctx.state.totalSections}`
    });

    cancellationToken?.throwIfRequested();

    if (typeof resolveSectionProfile !== 'function') {
      throw new Error('resolveSectionProfile is not defined');
    }
    const sectionProfile = resolveSectionProfile();
    ctx.state.phrasesPerSection = sectionProfile.phrasesPerSection;
    ctx.state.currentSectionType = sectionProfile.type;
    ctx.state.currentSectionDynamics = sectionProfile.dynamics;
    const baseBpm = (typeof BASE_BPM === 'number' && !isNaN(BASE_BPM)) ? BASE_BPM : (ctx.BPM || 120);
    ctx.state.BPM = Math.max(1, Math.round(baseBpm * sectionProfile.bpmScale));
    ctx.state.activeMotif = sectionProfile.motif
      ? new Motif(sectionProfile.motif.map((offset: any) => ({ note: clampMotifNote(60 + offset) })))
      : null;

    for (ctx.state.phraseIndex = 0; ctx.state.phraseIndex < ctx.state.phrasesPerSection; ctx.state.phraseIndex++) {
      cancellationToken?.throwIfRequested();

      // Select composer for this phrase and initialize timing (use DI utils)
      const utils = getPolychronContext().utils;
      ctx.state.composer = utils.ra(g.composers);
      const [num, den] = ctx.state.composer.getMeter();
      ctx.state.numerator = num;
      ctx.state.denominator = den;

      // Initialize timing using context-aware functions
      (await import('./time.js')).getMidiTiming(ctx);
      (await import('./time.js')).getPolyrhythm(ctx);
      // Keep legacy globals in sync for compatibility
      ctx.state.syncToGlobal();

      // Respect any test-seeded measuresPerPhrase value (DI-only override)
      if (compositionState.measuresPerPhrase && compositionState.measuresPerPhrase > 0) {
        ctx.state.measuresPerPhrase = compositionState.measuresPerPhrase;
      }

      ctx.LM.activate('primary', false);
      ctx.setUnitTiming('phrase');
      for (ctx.state.measureIndex = 0; ctx.state.measureIndex < ctx.state.measuresPerPhrase; ctx.state.measureIndex++) {
        ctx.state.measureCount++;
        ctx.setUnitTiming('measure');

        for (ctx.state.beatIndex = 0; ctx.state.beatIndex < ctx.state.numerator; ctx.state.beatIndex++) {
          ctx.state.beatCount++;
          ctx.setUnitTiming('beat');
          ctx.stage.setOtherInstruments(ctx);
          ctx.stage.setBinaural(ctx);
          ctx.stage.setBalanceAndFX(ctx);
          playDrums(ctx);
          ctx.stage.stutterFX(ctx.state.flipBin ? ctx.state.flipBinT3 : ctx.state.flipBinF3, ctx);
          ctx.stage.stutterFade(ctx.state.flipBin ? ctx.state.flipBinT3 : ctx.state.flipBinF3, ctx);
          {
            const rfFn = ctx?.utils?.rf ?? getPolychronContext().utils.rf ?? Math.random;
            rfFn() < 0.05 ? ctx.stage.stutterPan(ctx.state.flipBin ? ctx.state.flipBinT3 : ctx.state.flipBinF3, ctx) : ctx.stage.stutterPan(ctx.state.stutterPanCHs, ctx);
          }

          for (ctx.state.divIndex = 0; ctx.state.divIndex < ctx.state.divsPerBeat; ctx.state.divIndex++) {
            ctx.setUnitTiming('division');

            for (ctx.state.subdivIndex = 0; ctx.state.subdivIndex < ctx.state.subdivsPerDiv; ctx.state.subdivIndex++) {
              ctx.setUnitTiming('subdivision');
              ctx.stage.playNotes(ctx);
            }

            for (ctx.state.subsubdivIndex = 0; ctx.state.subsubdivIndex < ctx.state.subsubdivsPerSub; ctx.state.subsubdivIndex++) {
                ctx.setUnitTiming('subsubdivision');
              ctx.stage.playNotes2(ctx);
            }
          }
        }
      }

      ctx.LM.advance('primary', 'phrase');

      ctx.LM.activate('poly', true);
      (await import('./time.js')).getMidiTiming(ctx);
      ctx.state.syncToGlobal();  // Sync timing values from ctx.state to globals for runtime
      ctx.setUnitTiming('phrase');
      for (ctx.state.measureIndex = 0; ctx.state.measureIndex < ctx.state.measuresPerPhrase; ctx.state.measureIndex++) {
        ctx.setUnitTiming('measure');

        for (ctx.state.beatIndex = 0; ctx.state.beatIndex < ctx.state.numerator; ctx.state.beatIndex++) {
          ctx.setUnitTiming('beat');
          ctx.stage.setOtherInstruments(ctx);
          ctx.stage.setBinaural(ctx);
          ctx.stage.setBalanceAndFX(ctx);
          playDrums2(ctx);
          ctx.stage.stutterFX(ctx.state.flipBin ? ctx.state.flipBinT3 : ctx.state.flipBinF3, ctx);
          ctx.stage.stutterFade(ctx.state.flipBin ? ctx.state.flipBinT3 : ctx.state.flipBinF3, ctx);
          {
            const rfFn = ctx?.utils?.rf ?? getPolychronContext().utils.rf ?? Math.random;
            rfFn() < 0.05 ? ctx.stage.stutterPan(ctx.state.flipBin ? ctx.state.flipBinT3 : ctx.state.flipBinF3, ctx) : ctx.stage.stutterPan(ctx.state.stutterPanCHs, ctx);
          }

          for (ctx.state.divIndex = 0; ctx.state.divIndex < ctx.state.divsPerBeat; ctx.state.divIndex++) {
            ctx.setUnitTiming('division');

            for (ctx.state.subdivIndex = 0; ctx.state.subdivIndex < ctx.state.subdivsPerDiv; ctx.state.subdivIndex++) {
              ctx.setUnitTiming('subdivision');
              ctx.stage.playNotes(ctx);
            }

            for (ctx.state.subsubdivIndex = 0; ctx.state.subsubdivIndex < ctx.state.subsubdivsPerSub; ctx.state.subsubdivIndex++) {
              ctx.setUnitTiming('subsubdivision');
              ctx.stage.playNotes2(ctx);
            }
          }
        }
      }

      ctx.LM.advance('poly', 'phrase');
    }

    ctx.LM.advance('primary', 'section');
    // Ensure the context's buffer points to the active buffer before logging section markers
    (ctx as any).csvBuffer = (ctx as any).LM.layers[(ctx as any).LM.activeLayer].buffer;
    ctx.logUnit('section');

    ctx.LM.advance('poly', 'section');
    (ctx as any).csvBuffer = (ctx as any).LM.layers[(ctx as any).LM.activeLayer].buffer;
    ctx.logUnit('section');

    // Do not write to legacy globals; update PolychronContext state instead if needed
    // PolychronContext.state.baseBPM = BASE_BPM; // intentionally omitted to avoid globals
    // activeMotif is managed on the composition context (ctx.state.activeMotif)
  }

  // Report rendering phase
  progressCallback?.({
    phase: 'rendering',
    progress: 90,
    message: 'Finalizing composition'
  });

  cancellationToken?.throwIfRequested();

  // Prefer DI-registered writer for finalization rather than relying on a global
  try {
    const grandFinaleFn = container.get('grandFinale');
    if (typeof grandFinaleFn === 'function') grandFinaleFn(ctx);
  } catch (e) {
    // If DI is missing, propagate the error (no global fallback allowed)
    throw e;
  }

  // Report complete
  progressCallback?.({
    phase: 'complete',
    progress: 100,
    message: 'Composition complete'
  });

  // Clean up context: In test environments, keep context available for assertions
  if (process.env.NODE_ENV !== 'test') {
    setCurrentCompositionContext(null);
  }

  return ctx;
};;

// Export initialization function and context accessors (Step 12: Context threading)
// Export helper for Step 13: Remove global fallbacks
export {
  initializePlayEngine,
  getCurrentCompositionContext,
  setCurrentCompositionContext,
  getContextValue
};



if (process.env.NODE_ENV !== 'test') {
  initializePlayEngine().catch((err) => {
    console.error('Composition engine failed:', err);
  });
}
