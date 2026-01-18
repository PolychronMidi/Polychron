// play.ts - Main composition engine orchestrating section, phrase, measure hierarchy.
// minimalist comments, details at: play.md

// Import all dependencies in correct order
import './sheet.js';       // Constants and configuration
import './venue.js';       // Music theory (scales, chords)
import './backstage.js';   // Utilities and global state
import './writer.js';      // Output functions
import './time.js';        // Timing functions
import './composers.js';   // Composer classes
import './motifs.js';      // Motif generation
import './rhythm.js';      // Rhythm generation
import { playDrums, playDrums2 } from './rhythm.js';
import './fxManager.js';   // FX processing
import { fxManager } from './fxManager.js';
import './stage.js';       // Audio processing
import './structure.js';   // Section structure

// Initialize PolychronContext (architecture migration)
import { initializePolychronContext } from './PolychronInit.js';

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
declare const Motif: any;
declare const m: any;
declare const p: any;
declare const LM: any;
declare const clampMotifNote: (note: number) => number;

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
declare let subsubsPerSub: number;
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
// Made available during composition for gradual migration from globals
let currentCompositionContext: ICompositionContext | null = null;

/**
 * Set the current composition context for use by module functions
 * This enables gradual migration from global state to context-based architecture
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
 * Part of Step 13: Remove global fallbacks (gradual migration)
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
      // Fallback to global if context property doesn't exist
    }
  }

  // Fallback to global value
  if (globalKey) {
    return (globalThis as any)[globalKey];
  }

  return undefined as any;
};

const registerCoreServices = (container: DIContainer) => {
  const g = globalThis as any;

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
    () => g.ComposerRegistry.getInstance(),
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

  // Register LayerManager (singleton)
  container.register(
    'layerManager',
    () => g.LM,
    'singleton'
  );

  // Register CSV Writers (singleton)
  container.register(
    'writers',
    () => ({
      addToCSV: g.addToCSV,
      emitMIDI: g.emitMIDI,
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
): Promise<void> => {
  const g = globalThis as any;

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
  g.DIContainer = container;  // Make available globally for testing/debugging

  const compositionState = container.get('compositionState');
  compositionState.BASE_BPM = g.BPM;
  compositionState.syncToGlobal();

  // Create composition context (Step 12: Context threading)
  // This encapsulates all state and services needed during composition
  const ctx = createCompositionContext(
    container,
    g.eventBus || { emit: () => {}, on: () => {}, off: () => {} },
    {
      BPM: g.BPM,
      PPQ: g.PPQ || 480,
      SECTIONS: g.SECTIONS,
      COMPOSERS: g.COMPOSERS
    },
    progressCallback,
    cancellationToken,
    g.c || { rows: [] },
    g.LOG || 'none'
  );

  // Make context available to module functions
  setCurrentCompositionContext(ctx);

  const BASE_BPM = g.BPM;

  // Initialize composers from configuration using new ComposerRegistry
  if (!g.composers || g.composers.length === 0) {
    const registry = g.ComposerRegistry.getInstance();
    g.composers = g.COMPOSERS.map((config: any) => registry.create(config));
  }

  // Resolve stage from container and assign to globals
  g.stage = container.get('stage');

  const { state: primary, buffer: c1 } = g.LM.register('primary', 'c1', {}, () => g.stage.setTuningAndInstruments());
  const { state: poly, buffer: c2 } = g.LM.register('poly', 'c2', {}, () => g.stage.setTuningAndInstruments());

  g.totalSections = g.ri(g.SECTIONS.min, g.SECTIONS.max);

  // Report composing phase started
  progressCallback?.({
    phase: 'composing',
    progress: 5,
    totalSections: g.totalSections,
    message: `Starting composition: ${g.totalSections} sections`
  });

  cancellationToken?.throwIfRequested();

  for (g.sectionIndex = 0; g.sectionIndex < g.totalSections; g.sectionIndex++) {
    // Report progress for each section
    const sectionProgress = 5 + (g.sectionIndex / g.totalSections) * 85;
    progressCallback?.({
      phase: 'composing',
      progress: sectionProgress,
      sectionIndex: g.sectionIndex,
      totalSections: g.totalSections,
      message: `Composing section ${g.sectionIndex + 1}/${g.totalSections}`
    });

    cancellationToken?.throwIfRequested();

    // Debug: check if resolveSectionProfile is available
    if (!g.resolveSectionProfile) {
      console.error('resolveSectionProfile not found on globalThis!', Object.keys(g).filter(k => k.includes('Section')));
      throw new Error('resolveSectionProfile is not defined');
    }
    const sectionProfile = g.resolveSectionProfile();
    g.phrasesPerSection = sectionProfile.phrasesPerSection;
    g.currentSectionType = sectionProfile.type;
    g.currentSectionDynamics = sectionProfile.dynamics;
    g.BPM = g.m.max(1, g.m.round(BASE_BPM * sectionProfile.bpmScale));
    g.activeMotif = sectionProfile.motif
      ? new g.Motif(sectionProfile.motif.map((offset: any) => ({ note: g.clampMotifNote(60 + offset) })))
      : null;

    for (g.phraseIndex = 0; g.phraseIndex < g.phrasesPerSection; g.phraseIndex++) {
      cancellationToken?.throwIfRequested();

      g.composer = g.ra(g.composers);
      [g.numerator, g.denominator] = g.composer.getMeter();
      g.getMidiTiming(ctx);
      g.getPolyrhythm(ctx);
      g.syncStateToGlobals(ctx);  // Sync timing values from ctx.state to globals for runtime

      g.LM.activate('primary', false);
      ctx.setUnitTiming('phrase');
      for (g.measureIndex = 0; g.measureIndex < g.measuresPerPhrase; g.measureIndex++) {
        g.measureCount++;
        ctx.setUnitTiming('measure');

        for (g.beatIndex = 0; g.beatIndex < g.numerator; g.beatIndex++) {
          g.beatCount++;
          ctx.setUnitTiming('beat');
          g.stage.setOtherInstruments(ctx);
          g.stage.setBinaural(ctx);
          g.stage.setBalanceAndFX(ctx);
          playDrums(ctx);
          g.stage.stutterFX(g.flipBin ? g.flipBinT3 : g.flipBinF3, ctx);
          g.stage.stutterFade(g.flipBin ? g.flipBinT3 : g.flipBinF3, ctx);
          g.rf() < 0.05 ? g.stage.stutterPan(g.flipBin ? g.flipBinT3 : g.flipBinF3, ctx) : g.stage.stutterPan(g.stutterPanCHs, ctx);

          for (g.divIndex = 0; g.divIndex < g.divsPerBeat; g.divIndex++) {
            ctx.setUnitTiming('division');

            for (g.subdivIndex = 0; g.subdivIndex < g.subdivsPerDiv; g.subdivIndex++) {
              ctx.setUnitTiming('subdivision');
              g.stage.playNotes();
            }

            for (g.subsubdivIndex = 0; g.subsubdivIndex < g.subsubsPerSub; g.subsubdivIndex++) {
                ctx.setUnitTiming('subsubdivision');
              g.stage.playNotes2();
            }
          }
        }
      }

      g.LM.advance('primary', 'phrase');

      g.LM.activate('poly', true);
      g.getMidiTiming(ctx);
      g.syncStateToGlobals(ctx);  // Sync timing values from ctx.state to globals for runtime
      ctx.setUnitTiming('phrase');
      for (g.measureIndex = 0; g.measureIndex < g.measuresPerPhrase; g.measureIndex++) {
        ctx.setUnitTiming('measure');

        for (g.beatIndex = 0; g.beatIndex < g.numerator; g.beatIndex++) {
          ctx.setUnitTiming('beat');
          g.stage.setOtherInstruments(ctx);
          g.stage.setBinaural(ctx);
          g.stage.setBalanceAndFX(ctx);
          playDrums2(ctx);
          g.stage.stutterFX(g.flipBin ? g.flipBinT3 : g.flipBinF3, ctx);
          g.stage.stutterFade(g.flipBin ? g.flipBinT3 : g.flipBinF3, ctx);
          g.rf() < 0.05 ? g.stage.stutterPan(g.flipBin ? g.flipBinT3 : g.flipBinF3, ctx) : g.stage.stutterPan(g.stutterPanCHs, ctx);

          for (g.divIndex = 0; g.divIndex < g.divsPerBeat; g.divIndex++) {
            ctx.setUnitTiming('division');

            for (g.subdivIndex = 0; g.subdivIndex < g.subdivsPerDiv; g.subdivIndex++) {
              ctx.setUnitTiming('subdivision');
              g.stage.playNotes();
            }

            for (g.subsubdivIndex = 0; g.subsubdivIndex < g.subsubsPerSub; g.subsubdivIndex++) {
              ctx.setUnitTiming('subsubdivision');
              g.stage.playNotes2();
            }
          }
        }
      }

      g.LM.advance('poly', 'phrase');
    }

    g.LM.advance('primary', 'section');
    ctx.logUnit('section');

    g.LM.advance('poly', 'section');
    ctx.logUnit('section');

    g.BPM = BASE_BPM;
    g.activeMotif = null;
  }

  // Report rendering phase
  progressCallback?.({
    phase: 'rendering',
    progress: 90,
    message: 'Finalizing composition'
  });

  cancellationToken?.throwIfRequested();

  g.grandFinale();

  // Report complete
  progressCallback?.({
    phase: 'complete',
    progress: 100,
    message: 'Composition complete'
  });

  // Clean up context (Step 12: Context threading)
  setCurrentCompositionContext(null);
};;

// Export initialization function and context accessors (Step 12: Context threading)
// Export helper for Step 13: Remove global fallbacks (gradual migration)
export {
  initializePlayEngine,
  getCurrentCompositionContext,
  setCurrentCompositionContext,
  getContextValue
};

// Expose to globalThis for backward compatibility
(globalThis as any).initializePlayEngine = initializePlayEngine;

initializePlayEngine().catch((err) => {
  console.error('Composition engine failed:', err);
});
