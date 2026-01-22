// helpers.module.ts - module exports for test helpers
import { CompositionState, CompositionStateService } from '../src/CompositionState.js';
import { ICompositionContext, createCompositionContext } from '../src/CompositionContext.js';
import { DIContainer } from '../src/DIContainer.js';
import { CompositionEventBusImpl, CancellationTokenImpl } from '../src/CompositionProgress.js';
import { registerWriterServices, CSVBuffer, logUnit } from '../src/writer.js';
import * as tonal from 'tonal';
import { allNotes, allScales, allChords, allModes, getMidiValue, registerVenueServices, midiData } from '../src/venue.js';
import {
  rf, ri, rv, rw, clamp, modClamp, m, ra, randomWeightedSelection,
  cCH1, cCH2, cCH3, lCH1, rCH1, lCH2, rCH2, lCH3, rCH3, lCH4, rCH4, lCH5, rCH5, lCH6, rCH6,
  bass, source, source2, reflection, reflectionBinaural, reflect, reflect2,
  binauralL, binauralR, flipBinF, flipBinT, flipBinF2, flipBinT2, flipBinF3, flipBinT3,
  stutterFadeCHs, allCHs, stutterPanCHs, FX,
  tuningPitchBend, allNotesOff, muteAll
} from '../src/backstage.js';
import {
  MeasureComposer,
  ScaleComposer,
  RandomScaleComposer,
  ChordComposer,
  RandomChordComposer,
  ModeComposer,
  RandomModeComposer
} from '../src/composers.js';
import { initializePolychronContext, setPolychronTestNamespace, getPolychronContext } from '../src/PolychronInit.js';

export function createTestState(): CompositionState {
  const state = new CompositionStateService();

  // Use DI-compatible test namespace instead of relying on globalThis
  initializePolychronContext();
  setPolychronTestNamespace({ state });

  return state;
}

export function createTestContext(overrides?: Partial<ICompositionContext>): ICompositionContext {
  const state = createTestState();
  const services = new DIContainer();
  const eventBus = new CompositionEventBusImpl();
  const cancelToken = new CancellationTokenImpl();

  // Initialize state with sensible defaults for tests
  state.numerator = 4;
  state.denominator = 4;
  state.BPM = 120;
  state.composer = createMinimalTestComposer() as any;
  state.PPQ = 480;
  state.beatCount = 0;
  state.beatStart = 0;
  state.measureStart = 0;
  state.phraseStart = 0;
  state.sectionStart = 0;

  registerWriterServices(services);
  registerVenueServices(services);

  const csvBuffer = new CSVBuffer('test');

  const ctx = createCompositionContext(
    services,
    eventBus,
    { BPM: state.BPM || 120, PPQ: state.PPQ || 480, SECTIONS: { min: 1, max: 4 }, COMPOSERS: [] },
    undefined,
    cancelToken,
    csvBuffer,
    'none'
  );

  // Wire the created state into ctx.state
  ctx.state = state as any;

  // Ensure services alias exists
  ctx.services = services as any;

  // Expose `LOG` on ctx so tests can set logging mode in a DI-friendly way.
  // Setting `ctx.LOG` will propagate to global LOG so `initializePlayEngine` picks it up.
  let _LOG = 'none';
  Object.defineProperty(ctx, 'LOG', {
    configurable: true,
    enumerable: true,
    get() { return _LOG; },
    set(v: any) { _LOG = v; const poly = getPolychronContext(); poly.test = poly.test || {}; poly.test.LOG = v; }
  });
  // Ensure initial test namespace LOG reflects ctx default
  getPolychronContext().test = getPolychronContext().test || {} as any; getPolychronContext().test.LOG = (ctx as any).LOG;

  // Initialize balance/Fx defaults so tests can assert deltas
  ctx.state.balOffset = ctx.state.balOffset ?? 0;
  ctx.state.sideBias = ctx.state.sideBias ?? 0;
  ctx.state.lBal = ctx.state.lBal ?? 0;
  ctx.state.rBal = ctx.state.rBal ?? 127;
  ctx.state.cBal = ctx.state.cBal ?? 64;
  ctx.state.cBal2 = ctx.state.cBal2 ?? 64;
  ctx.state.cBal3 = ctx.state.cBal3 ?? 64;
  ctx.state.bassVar = ctx.state.bassVar ?? 0;

  // Allow tests to enable verbose timing/logUnit debugging via shared test namespace
  // NOTE: enabled by default during debugging sessions to aid tracing of NaN/undefined
  ctx.state.DEBUG_LOGUNIT = true;
  ctx.state.DEBUG_TIME = true;

  // Populate Polychron test namespace with a minimal composers array and state so DI-based
  // initialization can pick up composers and BPM without relying on globals
  const poly = getPolychronContext();
  poly.test = poly.test || {} as any;
  poly.test.COMPOSERS = [createMinimalTestComposer()];
  // Also mirror the provided state into the authoritative poly.state namespace
  poly.state = state as any;

  return ctx;
}

export function setupTestLogging(): void {
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  (globalThis as any).__POLYCHRON_TEST__.enableLogging = true;
}

export function disableTestLogging(): void {
  if (globalThis.__POLYCHRON_TEST__) {
    (globalThis as any).__POLYCHRON_TEST__.enableLogging = false;
  }
}

export function cleanupTestState(): void {
  if (globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
}

export function setupTestDefaults(options?: any) {
  const g = globalThis as any;
  options = options || {};

  if (options.smallComposition) {
    g.SECTIONS = { min: 1, max: 1 };
    g.PHRASES_PER_SECTION = { min: 1, max: 1 };
  }
  if (typeof options.log === 'string') {
    g.LOG = options.log;
  }
}

export function createMinimalTestComposer() {
  return {
    getMeter: () => [4, 4] as [number, number],
    getDivisions: () => 2,
    getSubdivisions: () => 2,
    getNotes: () => [{ note: 60, velocity: 80 }],
    constructor: { name: 'TestComposer' }
  };
}

export function hasTestNamespace(): boolean {
  return typeof globalThis.__POLYCHRON_TEST__ !== 'undefined';
}

export function getTestValue<T>(key: string, defaultValue: T): T {
  if (!globalThis.__POLYCHRON_TEST__) {
    return defaultValue;
  }
  return (globalThis.__POLYCHRON_TEST__ as any)[key] ?? defaultValue;
}

export function setTestValue(key: string, value: any): void {
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  (globalThis.__POLYCHRON_TEST__ as any)[key] = value;
}

export function getWriterServices(ctx: ICompositionContext) {
  return {
    pushMultiple: ctx.services.get('pushMultiple'),
    grandFinale: ctx.services.get('grandFinale'),
    CSVBuffer: ctx.services.get('CSVBuffer')
  } as const;
}
