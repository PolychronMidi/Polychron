// play.ts - Main composition engine orchestrating section, phrase, measure hierarchy.
/* eslint-disable @typescript-eslint/no-unused-vars */
// minimalist comments, details at: play.md

// Import all dependencies in correct order
import './sheet.js';       // Constants and configuration
import './venue.js';       // Music theory (scales, chords)
import './backstage.js';   // Utilities and global state
import { registerWriterServices } from './writer.js';      // Output functions (DI registration)
import { registerTimeServices } from './time.js';        // Timing functions (DI registration)
import * as Composers from './composers.js';
import { registerVenueServices, midiData } from './venue.js';
import * as tLib from 'tonal';
// Composer classes (imported as module for DI registration)
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
// Engine concurrency guard: prevents concurrent initialization runs from colliding
let __engineRunning = false;

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
    } catch (_e) {
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
  } catch (_e) {
    console.warn('registerWriterServices not available; falling back to legacy writer globals');
  }

  try {
    // Register timing services for DI consumers
    registerTimeServices(container);
  } catch (_e) {
    console.warn('registerTimeServices not available');
  }

  try {
    // Register venue services (music theory utilities) for DI consumers
    registerVenueServices(container);
    // Register raw midiData for convenience
    if (!container.has('midiData')) {
      container.register('midiData', () => midiData, 'singleton');
    }
    // Register tonal library reference
    if (!container.has('t')) {
      container.register('t', () => tLib, 'singleton');
    }
  } catch (_e) {
    console.warn('registerVenueServices not available');
  }

  // Expose a composite `writers` helper that maps to DI-backed functions when available
  container.register(
    'writers',
    () => ({
      addToCSV: container.has('pushMultiple') ? container.get('pushMultiple') : () => {},
      emitMIDI: container.has('grandFinale') ? container.get('grandFinale') : () => {}
    }),
    'singleton'
  );

  // Register CompositionState (singleton)
  container.register(
    'compositionState',
    () => new CompositionStateService(),
    'singleton'
  );

  // Register class factories (composers, utils) from the `composers` module (DI-first)
  container.register('MeasureComposer', () => Composers.MeasureComposer, 'singleton');
  container.register('ScaleComposer', () => Composers.ScaleComposer, 'singleton');
  container.register('RandomScaleComposer', () => Composers.RandomScaleComposer, 'singleton');
  container.register('ChordComposer', () => Composers.ChordComposer, 'singleton');
  container.register('RandomChordComposer', () => Composers.RandomChordComposer, 'singleton');
  container.register('ModeComposer', () => Composers.ModeComposer, 'singleton');
  container.register('RandomModeComposer', () => Composers.RandomModeComposer, 'singleton');
  container.register('PentatonicComposer', () => Composers.PentatonicComposer, 'singleton');
  container.register('RandomPentatonicComposer', () => Composers.RandomPentatonicComposer, 'singleton');
  container.register('ProgressionGenerator', () => Composers.ProgressionGenerator, 'singleton');
  // VoiceLeadingScore imported directly in MeasureComposer - no global registration needed

  // Register music theory utilities via DI (venue services)
  // `registerVenueServices` registers getMidiValue, allNotes, allScales, allChords, allModes
  // `midiData` and `t` are registered here as singletons
  if (!container.has('t')) {
    container.register('t', () => tLib, 'singleton');
  }
  if (!container.has('midiData')) {
    container.register('midiData', () => midiData, 'singleton');
  }
};

// Initialize the composition engine
const initializePlayEngine = async (
  progressCallback?: ProgressCallback,
  cancellationToken?: CancellationToken,
  options?: { seed?: number }
): Promise<ICompositionContext> => {
  const poly = getPolychronContext();
  const g = poly.test || {} as any;

  // Prevent concurrent runs
  if (__engineRunning) {
    console.error('[traceroute] initializePlayEngine: concurrent run detected; rejecting second invocation');
    throw new Error('initializePlayEngine: concurrent run detected');
  }
  __engineRunning = true;
  try { console.error('[traceroute] initializePlayEngine: entry stack', new Error().stack); } catch (_e) {}

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
  // Expose DI container to the test namespace (avoid writing to the real global object)
  poly.test = poly.test || {};
  poly.test.DIContainer = container;  // Make available on PolychronContext.test for testing/debugging

  // registerCoreServices called; writer services should be available on the container

  const compositionState = container.get('compositionState');
  // First import any test-seeded values from poly.state into the composition state
  compositionState.syncFromGlobal();

  // If fastTrace is enabled (via poly.test.fastTrace or env POLYCHRON_FAST_TRACE=1), reduce composition scope to make runs quick
  const fastTrace = g.fastTrace || process.env.POLYCHRON_FAST_TRACE === '1';
  if (fastTrace) {
    try { console.error('[traceroute] FAST TRACE mode enabled: minimizing composition work for quick runs'); } catch (_e) {}
    g.SECTIONS = { min: 1, max: 1 };
    compositionState.SECTIONS = { min: 1, max: 1 } as any;
    compositionState.measuresPerPhrase = 1;
    compositionState.phrasesPerSection = 1;
    compositionState.totalSections = 1;
    poly.test._fastTrace = true;
  }

  // Apply explicit test-provided overrides where present
  compositionState.BASE_BPM = g.BPM ?? poly.state?.BPM ?? compositionState.BASE_BPM;
  compositionState.LOG = g.LOG !== undefined ? g.LOG : compositionState.LOG;
  // Persist authoritative composition state back into the DI test namespace
  try { console.error('[traceroute] BEFORE compositionState.syncToGlobal (startup)', { comp_totalSections: compositionState.totalSections }); } catch (_e) {}
  compositionState.syncToGlobal();
  try { console.error('[traceroute] AFTER compositionState.syncToGlobal (startup)', { comp_totalSections: compositionState.totalSections, poly_totalSections: (getPolychronContext && getPolychronContext().state && getPolychronContext().state.totalSections) || null }); } catch (_e) {}


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
  } catch (_e) {
    // If registration fails, continue and let requirePush throw meaningful error downstream
  }

  // Make context available to module functions
  setCurrentCompositionContext(ctx);
  try { console.error('[traceroute] initializePlayEngine ctx created', { totalSections: ctx.state.totalSections, BPM: ctx.BPM, PPQ: ctx.PPQ, SECTIONS: ctx.SECTIONS, COMPOSERS: ctx.COMPOSERS || null }); } catch (_e) {}

  // Diagnostic hook: force a short sample of NOTE generation in the real context when requested
  try {
    if (process.env.POLYCHRON_FORCE_NOTE_SAMPLE === '1') {
      try {
        console.error('[initializePlayEngine] POLYCHRON_FORCE_NOTE_SAMPLE active: forcing a few stage.playNotes/playNotes2 calls');
        ctx.state.bpmRatio3 = 1;
        const st = container.get('stage');
        for (let i = 0; i < 5; i++) {
          st.playNotes(ctx);
          st.playNotes2(ctx);
        }
        console.error('[initializePlayEngine] forced sample pushed, global note pushes:', (globalThis as any).__PUSH_NOTE_COUNT || 0);
      } catch (_e) {
        console.error('[initializePlayEngine] forced sample failed', _e && (_e as Error).message ? (_e as Error).message : _e);
      }
    }
  } catch (_e) {}

  // Ensure LOG from ctx is set in state (no globals)
  (ctx as any).state.LOG = ctx.LOG;

  // Provide DI-based LayerManager and stage references on context
  (ctx as any).LM = container.get('layerManager');
  (ctx as any).stage = container.get('stage');

  // Defensive: ensure an initial unitLabel exists on the active buffer immediately
  try {
    const activeName = (ctx as any).LM && (ctx as any).LM.activeLayer;
    const active = (ctx as any).LM && (ctx as any).LM.layers && (ctx as any).LM.layers[activeName];
    if (active && active.buffer) {
      const buf: any = active.buffer;
      if (!buf.unitLabel) {
        const secIdx = ctx.state.sectionIndex ?? 0;
        const phrIdx = ctx.state.phraseIndex ?? 0;
        const measureIdx = ctx.state.measureIndex ?? 0;
        const startTick = ctx.state.measureStart ?? 0;
        const endTick = startTick + (ctx.state.tpMeasure ?? 0);
        const label = `${activeName}section${secIdx + 1}phrase${phrIdx + 1}measure${measureIdx + 1} start: ${startTick.toFixed(4)} end: ${endTick.toFixed(4)}`;
        try { buf.unitLabel = label; } catch (_e) {}
        try { ctx.state.unitLabel = label; } catch (_e) {}
      }
      // Ensure we emit an initial unit marker so any early events are associated correctly
      try { ctx.logUnit && ctx.logUnit('measure'); } catch (_e) {}
    }
  } catch (_e) {}

  // Provide file system via DI-friendly dynamic import (ESM-safe)
  try {
    const fsModule = await import('fs');
    (ctx as any).fs = fsModule;
  } catch (_e) {
    // Fallback for non-ESM environments: try require if available
    try { (ctx as any).fs = require('fs'); } catch (__e) {}
  }
  // Do not overwrite ctx.PPQ if already set by composition state or config
  if (typeof g.PPQ === 'number') {
    (ctx as any).PPQ = g.PPQ;
  }
  (ctx as any).SILENT_OUTRO_SECONDS = g.SILENT_OUTRO_SECONDS;

  // If caller provided an explicit seed via options.seed, install deterministic RNG helpers
  try {
    if (options && typeof options.seed === 'number') {
      // Simple LCG for deterministic runs in tests
      let s = (options.seed >>> 0) || 1;
      const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0xffffffff) / 0x100000000; };
      const seededUtils: any = {
        rf: (min = 0, max = 1) => ((next() * (max - min)) + min),
        ri: (min = 0, max = 1) => Math.floor((next() * (max - min + 1)) + min),
        rv: (value: number) => value, // deterministic identity variation for safety
        ra: (arr: any[]) => arr[Math.floor(next() * arr.length)],
        rw: (weights: number[]) => {
          // deterministic weighted choice (index)
          const total = weights.reduce((a, b) => a + b, 0);
          let r = next() * total;
          for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
          return weights.length - 1;
        }
      };
      // Persist deterministic utils into ctx only (avoid mutating the global PolychronContext.utils which can unexpectedly affect other modules)
      if (!ctx.utils) throw new Error('initializePlayEngine: ctx.utils must be provided via DI before seeding deterministic RNG');
      Object.assign(ctx.utils, seededUtils);
      // For diagnostics, record that ctx-level seeded utils were installed
      (getPolychronContext().test as any).lastSeed = options.seed;
      console.log('[initializePlayEngine] deterministic RNG installed on ctx (seed=' + options.seed + ')');
    }
  } catch (_e) {}


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
      try { const inst = new c(); if (inst && typeof inst.getMeter === 'function') return inst; } catch (_e) {}
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
  // Prefer ctx.utils (DI-provided) when available, otherwise fallback to global PolychronContext.utils and finally the module's ri helper
  const polyUtils = (getPolychronContext && getPolychronContext().utils) ? getPolychronContext().utils : {} as any;
  const riFn = (ctx.utils && ctx.utils.ri) || polyUtils.ri || ri;
  const sectionsCfg = g.SECTIONS || (container.get('config') && container.get('config').SECTIONS) || { min: 1, max: 1 };
  // Compute totalSections using DI-provided ri; include identity and test-call logging to detect unexpected behavior
  let computedSections = 1;
  try {
    if (typeof riFn === 'function') {
      const test1 = riFn(sectionsCfg.min, sectionsCfg.max);
      const test2 = riFn(sectionsCfg.min, sectionsCfg.max);
      const funcSrcHead = String(riFn).slice(0,200);
      try { console.error('[traceroute] riFn test', { isCtxRi: Boolean(ctx.utils && ctx.utils.ri === riFn), isPolyRi: Boolean(polyUtils && polyUtils.ri === riFn), isModuleRi: Boolean(ri === riFn), test1, test2, funcSrcHead, funcLen: String(riFn).length, sectionsCfg }); } catch (_e) {}
      computedSections = test1;
    }
  } catch (e) {
    try { console.error('[traceroute] riFn threw', e); } catch (_e) {}
  }
  ctx.state.totalSections = computedSections;
  try { console.error('[traceroute] computed totalSections', { hasRiFn: typeof riFn === 'function', sectionsCfg, totalSections: ctx.state.totalSections }); } catch (_e) {}
  try { console.error('[traceroute] totalSectionsAssignmentStack', new Error().stack); } catch (_e) {}

  // Report composing phase started
  progressCallback?.({
    phase: 'composing',
    progress: 5,
    totalSections: ctx.state.totalSections,
    message: `Starting composition: ${ctx.state.totalSections} sections`
  });

  cancellationToken?.throwIfRequested();

  // Temporarily skip handoff enforcement during initial composition population so we don't
  // fail while instrumentation and handoff markers are being generated.
  ctx.state._skipHandoffEnforcement = true;
  try { console.error('[traceroute] before sections loop', { totalSections: ctx.state.totalSections }); } catch (_e) {}
  const sectionsToRun = ctx.state.totalSections;
  try { console.error('[traceroute] sectionsToRun snapshot', { sectionsToRun }); } catch (_e) {}
  for (ctx.state.sectionIndex = 0; ctx.state.sectionIndex < sectionsToRun; ctx.state.sectionIndex++) {
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
      let composer:any = undefined;
      try {
        composer = (typeof utils.ra === 'function') ? utils.ra(g.composers) : undefined;
      } catch (_e) {}
      if (!composer) {
        composer = (g.composers && g.composers.length) ? g.composers[0] : undefined;
      }
      if (!composer) {
        try { composer = registry.create({ type: 'measure' }); } catch (_e) {}
      }
      if (!composer) {
        console.warn('initializePlayEngine: failed to select composer; using default meter 4/4');
        ctx.state.numerator = 4;
        ctx.state.denominator = 4;
      } else {
        ctx.state.composer = composer;
        const [num, den] = (composer && typeof composer.getMeter === 'function') ? composer.getMeter() : [4,4];
        ctx.state.numerator = num;
        ctx.state.denominator = den;
      }

      // Initialize timing using context-aware functions
      (await import('./time.js')).getMidiTiming(ctx);
      (await import('./time.js')).getPolyrhythm(ctx);
      // Keep legacy globals in sync for compatibility
      try { console.error('[traceroute] BEFORE ctx.state.syncToGlobal (post timing)', { totalSections: ctx.state.totalSections }); } catch (_e) {}
      ctx.state.syncToGlobal();
      try { console.error('[traceroute] AFTER ctx.state.syncToGlobal (post timing)', { totalSections: ctx.state.totalSections, poly_totalSections: getPolychronContext().state?.totalSections }); } catch (_e) {}

      // Respect any test-seeded measuresPerPhrase value (DI-only override)
      if (compositionState.measuresPerPhrase && compositionState.measuresPerPhrase > 0) {
        ctx.state.measuresPerPhrase = compositionState.measuresPerPhrase;
      }

      ctx.LM.activate('primary', false);
      ctx.setUnitTiming('phrase');
      for (ctx.state.measureIndex = 0; ctx.state.measureIndex < ctx.state.measuresPerPhrase; ctx.state.measureIndex++) {
        ctx.state.measureCount++;
        try { console.error('[traceroute] composing BEFORE measure', { sectionIndex: ctx.state.sectionIndex, phraseIndex: ctx.state.phraseIndex, measureIndex: ctx.state.measureIndex, currentMeasureStart: ctx.state.measureStart, tpMeasure: ctx.state.tpMeasure }); } catch (_e) {}
        ctx.setUnitTiming('measure');
        try { console.error('[traceroute] composing AFTER measure', { measureIndex: ctx.state.measureIndex, measureStart: ctx.state.measureStart, measureStartTime: ctx.state.measureStartTime, tpMeasure: ctx.state.tpMeasure, csvBufUnitTiming: (ctx.csvBuffer && (ctx.csvBuffer.unitTiming)) || null }); } catch (_e) {}

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
      // Immediately persist timing for the newly-advanced poly phrase
      ctx.setUnitTiming('phrase');
    }

    ctx.LM.advance('primary', 'section');
    // Persist timing after section advancement so subsequent phrases/measures are absolute
    ctx.setUnitTiming('phrase');
    // Ensure the context's buffer points to the active buffer before logging section markers
    try {
      const activeName = (ctx as any).LM.activeLayer;
      const active = (ctx as any).LM.layers[activeName];
      if (active && active.buffer) {
        (ctx as any).csvBuffer = active.buffer;
        // Ensure an initial unitLabel exists so events emitted before the first setUnitTiming are labeled
        try {
          const buf: any = active.buffer;
          if (!buf.unitLabel) {
            const secIdx = ctx.state.sectionIndex ?? 0;
            const phrIdx = ctx.state.phraseIndex ?? 0;
            const measureIdx = (ctx.state.measureIndex ?? 0);
            const startTick = ctx.state.measureStart ?? 0;
            const endTick = startTick + (ctx.state.tpMeasure ?? 0);
            const label = `${activeName}section${secIdx + 1}phrase${phrIdx + 1}measure${measureIdx + 1} start: ${startTick.toFixed(4)} end: ${endTick.toFixed(4)}`;
            buf.unitLabel = label;
            ctx.state.unitLabel = label;
          }
        } catch (_e) {}
        ctx.logUnit('section');
      } else {
        console.warn('initializePlayEngine: active layer missing or no buffer', activeName, Object.keys((ctx as any).LM.layers));
      }
    } catch (e) {
      console.warn('initializePlayEngine: failed to set ctx.csvBuffer', e && (e as Error).message ? (e as Error).message : e);
    }

    ctx.LM.advance('poly', 'section');
    // Persist timing after poly section advancement
    ctx.setUnitTiming('phrase');
    // Re-enable handoff enforcement; initial instrumentation and markers should now be present
    ctx.state._skipHandoffEnforcement = false;
    try {
      const activeName = (ctx as any).LM.activeLayer;
      const active = (ctx as any).LM.layers[activeName];
      if (active && active.buffer) {
        (ctx as any).csvBuffer = active.buffer;
        // Ensure an initial unitLabel exists so events emitted before the first setUnitTiming are labeled
        try {
          const buf: any = active.buffer;
          if (!buf.unitLabel) {
            const secIdx = ctx.state.sectionIndex ?? 0;
            const phrIdx = ctx.state.phraseIndex ?? 0;
            const measureIdx = (ctx.state.measureIndex ?? 0);
            const startTick = ctx.state.measureStart ?? 0;
            const endTick = startTick + (ctx.state.tpMeasure ?? 0);
            const label = `${activeName}section${secIdx + 1}phrase${phrIdx + 1}measure${measureIdx + 1} start: ${startTick.toFixed(4)} end: ${endTick.toFixed(4)}`;
            buf.unitLabel = label;
            ctx.state.unitLabel = label;
          }
        } catch (_e) {}
        ctx.logUnit('section');
      } else {
        console.warn('initializePlayEngine: active layer missing or no buffer (poly)', activeName, Object.keys((ctx as any).LM.layers));
      }
    } catch (e) {
      console.warn('initializePlayEngine: failed to set ctx.csvBuffer (poly)', e && (e as Error).message ? (e as Error).message : e);
    }

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
    // In fastTrace (debug) mode skip heavy finalization to keep runs short
    if (!poly.test || !poly.test._fastTrace) {
      const grandFinaleFn = container.get('grandFinale');
      if (typeof grandFinaleFn === 'function') grandFinaleFn(ctx);
    } else {
      console.error('[traceroute] FAST TRACE mode: skipping grandFinale to keep run fast');
    }
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

  // Emit a compact tracing summary if present (non-verbose)
  try {
    const poly = getPolychronContext();
    if (poly && poly.test && typeof poly.test._reportTotalSectionsWrites === 'function') {
      try { poly.test._reportTotalSectionsWrites(); } catch (_e) {}
    }

    // If full-file trace mode was requested, write collected snapshots to disk as a single JSON file
    if (poly && poly.test && poly.test._traceMode === 'full-file' && Array.isArray(poly.test._traceSnapshots) && poly.test._traceSnapshots.length > 0) {
      try {
        const snapshots = poly.test._traceSnapshots;
        const outPath = poly.test._traceFilePath || 'output/trace-full.json';
        const fsModule = (ctx && (ctx as any).fs) ? (ctx as any).fs : await import('fs');
        // Ensure directory exists
        try {
          const p = (await import('path')).dirname(outPath);
          try { fsModule.mkdirSync(p, { recursive: true }); } catch (_e) {}
        } catch (_e) {}
        try { fsModule.writeFileSync(outPath, JSON.stringify({ meta: { seed: (ctx as any).state && (ctx as any).state.tracerouteSeed, snapshotLimit: poly.test._traceSnapshotLimit }, snapshots }, null, 2)); } catch (e) { console.error('[trace-summary] failed to write trace file', e); }
        console.error('[trace-summary] wrote full trace file', { outPath, snapshotCount: snapshots.length });
      } catch (_e) {
        // Non-fatal
      }
    }
  } catch (_e) {}

  // Clean up context: In test environments, keep context available for assertions
  if (process.env.NODE_ENV !== 'test') {
    setCurrentCompositionContext(null);
  }

  // Release concurrency guard
  try { __engineRunning = false; } catch (_e) {}

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



if (process.env.NODE_ENV !== 'test' && !(globalThis as any).__POLYCHRON_PREVENT_AUTO_START) {
  initializePlayEngine().catch((err) => {
    console.error('Composition engine failed:', err);
  });
}
