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
import './fxManager.js';   // FX processing
import './stage.js';       // Audio processing
import './structure.js';   // Section structure

// Initialize PolychronContext (architecture migration)
import { initializePolychronContext } from './PolychronInit.js';

// Dependency Injection Container
import { DIContainer } from './DIContainer.js';
import { Stage } from './stage.js';
import { CompositionStateService } from './CompositionState.js';

// Declare global dependencies
declare const BPM: number;
declare const SECTIONS: { min: number; max: number };
declare const COMPOSERS: any[];
declare const Motif: any;
declare const m: any;
declare const p: any;
declare const rf: (min?: number, max?: number) => number;
declare const ra: <T>(arr: T[]) => T;
declare const ri: (min: number, max: number) => number;
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
    () => g.fxManager,
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
  container.register('VoiceLeadingScore', () => g.VoiceLeadingScore, 'singleton');

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
const initializePlayEngine = () => {
  const g = globalThis as any;

  // Initialize PolychronContext singleton (lazy, on first engine startup)
  initializePolychronContext();

  // Initialize DI Container and register core services
  const container = new DIContainer();
  registerCoreServices(container);
  g.DIContainer = container;  // Make available globally for testing/debugging

  // Get CompositionState and sync it with globalThis for backward compatibility
  const compositionState = container.get('compositionState');
  compositionState.BASE_BPM = g.BPM;
  compositionState.syncToGlobal();  // Ensure all composition state is accessible via globalThis

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

  for (g.sectionIndex = 0; g.sectionIndex < g.totalSections; g.sectionIndex++) {
    const sectionProfile = g.resolveSectionProfile();
    g.phrasesPerSection = sectionProfile.phrasesPerSection;
    g.currentSectionType = sectionProfile.type;
    g.currentSectionDynamics = sectionProfile.dynamics;
    g.BPM = g.m.max(1, g.m.round(BASE_BPM * sectionProfile.bpmScale));
    g.activeMotif = sectionProfile.motif
      ? new g.Motif(sectionProfile.motif.map((offset: any) => ({ note: g.clampMotifNote(60 + offset) })))
      : null;

    for (g.phraseIndex = 0; g.phraseIndex < g.phrasesPerSection; g.phraseIndex++) {
      g.composer = g.ra(g.composers);
      [g.numerator, g.denominator] = g.composer.getMeter();
      g.getMidiTiming();
      g.getPolyrhythm();

      g.LM.activate('primary', false);
      g.setUnitTiming('phrase');
      for (g.measureIndex = 0; g.measureIndex < g.measuresPerPhrase; g.measureIndex++) {
        g.measureCount++;
        g.setUnitTiming('measure');

        for (g.beatIndex = 0; g.beatIndex < g.numerator; g.beatIndex++) {
          g.beatCount++;
          g.setUnitTiming('beat');
          g.stage.setOtherInstruments();
          g.stage.setBinaural();
          g.stage.setBalanceAndFX();
          g.playDrums();
          g.stage.stutterFX(g.flipBin ? g.flipBinT3 : g.flipBinF3);
          g.stage.stutterFade(g.flipBin ? g.flipBinT3 : g.flipBinF3);
          g.rf() < 0.05 ? g.stage.stutterPan(g.flipBin ? g.flipBinT3 : g.flipBinF3) : g.stage.stutterPan(g.stutterPanCHs);

          for (g.divIndex = 0; g.divIndex < g.divsPerBeat; g.divIndex++) {
            g.setUnitTiming('division');

            for (g.subdivIndex = 0; g.subdivIndex < g.subdivsPerDiv; g.subdivIndex++) {
              g.setUnitTiming('subdivision');
              g.stage.playNotes();
            }

            for (g.subsubdivIndex = 0; g.subsubdivIndex < g.subsubsPerSub; g.subsubdivIndex++) {
              g.setUnitTiming('subsubdivision');
              g.stage.playNotes2();
            }
          }
        }
      }

      g.LM.advance('primary', 'phrase');

      g.LM.activate('poly', true);
      g.getMidiTiming();
      g.setUnitTiming('phrase');
      for (g.measureIndex = 0; g.measureIndex < g.measuresPerPhrase; g.measureIndex++) {
        g.setUnitTiming('measure');

        for (g.beatIndex = 0; g.beatIndex < g.numerator; g.beatIndex++) {
          g.setUnitTiming('beat');
          g.stage.setOtherInstruments();
          g.stage.setBinaural();
          g.stage.setBalanceAndFX();
          g.playDrums2();
          g.stage.stutterFX(g.flipBin ? g.flipBinT3 : g.flipBinF3);
          g.stage.stutterFade(g.flipBin ? g.flipBinT3 : g.flipBinF3);
          g.rf() < 0.05 ? g.stage.stutterPan(g.flipBin ? g.flipBinT3 : g.flipBinF3) : g.stage.stutterPan(g.stutterPanCHs);

          for (g.divIndex = 0; g.divIndex < g.divsPerBeat; g.divIndex++) {
            g.setUnitTiming('division');

            for (g.subdivIndex = 0; g.subdivIndex < g.subdivsPerDiv; g.subdivIndex++) {
              g.setUnitTiming('subdivision');
              g.stage.playNotes();
            }

            for (g.subsubdivIndex = 0; g.subsubdivIndex < g.subsubsPerSub; g.subsubdivIndex++) {
              g.setUnitTiming('subsubdivision');
              g.stage.playNotes2();
            }
          }
        }
      }

      g.LM.advance('poly', 'phrase');
    }

    g.LM.advance('primary', 'section');
    g.logUnit('section');

    g.LM.advance('poly', 'section');
    g.logUnit('section');

    g.BPM = BASE_BPM;
    g.activeMotif = null;
  }

  g.grandFinale();
};

// Export initialization function
export { initializePlayEngine };

// Also expose to global for backward compatibility
(globalThis as any).initializePlayEngine = initializePlayEngine;

// Execute immediately when module is loaded
initializePlayEngine();
