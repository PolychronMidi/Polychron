/**
 * Test Helper Utilities
 *
 * Provides shared test setup functions following Polychron's test philosophy:
 * - Import actual functions, not mocks
 * - Use __POLYCHRON_TEST__ namespace for test-specific state
 * - Test real implementations to support experimental development
 */

// Ensure core modules are loaded for all tests
import '../src/backstage.js'; // Load random helpers
import '../src/venue.js'; // Load Tonal library
import '../src/sheet.js'; // Load configuration

import { CompositionState, CompositionStateService } from '../src/CompositionState.js';
import { ICompositionContext } from '../src/CompositionContext.js';
import { DIContainer } from '../src/DIContainer.js';
import { CompositionEventBusImpl, CancellationTokenImpl } from '../src/CompositionProgress.js';
import { registerWriterServices, CSVBuffer, logUnit } from '../src/writer.js';
import * as tonal from 'tonal';
import { allNotes, allScales, allChords, allModes, getMidiValue, registerVenueServices } from '../src/venue.js';

/**
 * Creates a fresh CompositionState for testing
 * Exposes state to __POLYCHRON_TEST__ namespace for test instrumentation
 */
export function createTestState(): CompositionState {
  const state = new CompositionStateService();

  // Expose to test namespace for instrumentation
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  globalThis.__POLYCHRON_TEST__.state = state;

  return state;
}

/**
 * Creates a minimal test composition context for testing context-aware functions
 * Provides a properly initialized ICompositionContext with sensible defaults
 */
export function createTestContext(overrides?: Partial<ICompositionContext>): ICompositionContext {
  const state = createTestState();
  const services = new DIContainer();
  const eventBus = new CompositionEventBusImpl();
  const cancelToken = new CancellationTokenImpl();

  // Set default timing values on state
  state.numerator = 4;
  state.denominator = 4;
  state.BPM = 120;
  state.PPQ = 480;
  state.beatCount = 0;
  state.beatStart = 0;
  state.measureStart = 0;
  state.phraseStart = 0;
  state.sectionStart = 0;

  // Ensure writer services are available in the test context
  registerWriterServices(services);

  // Ensure venue/theory services are available in the test DI container for tests
  // that still rely on tonal-derived helpers (preferred DI over globals)
  registerVenueServices(services);

  const csvBuffer = new CSVBuffer('test');

  const ctx: ICompositionContext = {
    state,
    // Provide both `services` and `container` aliases for compatibility
    services,
    container: services,
    eventBus,
    cancellationToken: cancelToken,
    BPM: 120,
    PPQ: 480,
    csvBuffer,
    LOG: 'none',
    // Provide a context-bound logger for tests
    logUnit: (unitType: string) => {
      // @ts-ignore - use imported writer.logUnit
      logUnit(unitType, ctx);
    },
    setUnitTiming: (unitType: string) => {
      const setUnitTimingFn = require('../src/time.js').setUnitTiming;
      // @ts-ignore - forward to actual function
      setUnitTimingFn(unitType, ctx);
    },
    ...overrides
  };

  return ctx;
}

/**
 * Sets up test logging in __POLYCHRON_TEST__ namespace
 * Used by functions that check for test logging flags
 */
export function setupTestLogging(): void {
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  globalThis.__POLYCHRON_TEST__.enableLogging = true;
}

/**
 * Disables test logging
 */
export function disableTestLogging(): void {
  if (globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__.enableLogging = false;
  }
}

/**
 * Cleans up __POLYCHRON_TEST__ namespace after tests
 * Call this in afterEach() to ensure clean state between tests
 */
export function cleanupTestState(): void {
  if (globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
}

/**
 * Sets up basic global state for legacy tests
 * Use this temporarily during migration, then replace with createTestState()
 *
 * @deprecated Use createTestState() and explicit state passing instead
 */
export function setupGlobalState(): void {
  // Reset global event buffer
  globalThis.c = [];

  // Reset CSV buffer
  globalThis.csvRows = [];

  // Ensure DI container and writer services are available for tests
  const container = new DIContainer();
  registerWriterServices(container);
  // Writer services are available in DI (registered above). Tests should use DI
  // directly via `createTestContext()` and `ctx.services.get('pushMultiple')`.
  // Legacy global exposure has been removed; prefer DI-based access for all tests.

  // Ensure venue/theory globals are available for legacy tests
  // Register venue services in DI container (useful for DI-based tests)
  registerVenueServices(container);
  // Expose Tonal API and derived helpers to global scope for legacy code
  globalThis.t = tonal;
  globalThis.getMidiValue = getMidiValue;
  globalThis.allNotes = allNotes;
  globalThis.allScales = allScales;
  globalThis.allChords = allChords;
  globalThis.allModes = allModes;

  // Reset timing state
  globalThis.numerator = 4;
  globalThis.denominator = 4;
  globalThis.BPM = 120;
  globalThis.PPQ = 480;

  // Reset counters
  globalThis.beatCount = 0;
  globalThis.loopIdx = 0;
  globalThis.measureCount = 0;
  globalThis.phraseCount = 0;

  // Reset rhythm state
  globalThis.subdivIndex = 0;
  globalThis.beatStart = 0;

  // Reset channel assignments
  globalThis.drumCH = 9;

  /**
   * NOTE: setupTestDefaults is defined at module scope (see below).
   * This placeholder kept here while we keep setupGlobalState compact.
   */
  // [setupTestDefaults defined after setupGlobalState]

  // Initialize test namespace
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
}

// Module-scope helpers
export function setupTestDefaults(options?: { smallComposition?: boolean; log?: string }) {
  const g = globalThis as any;
  options = options || {};
  // Ensure legacy globals are initialized for tests that rely on global exposure
  setupGlobalState();

  if (options.smallComposition) {
    g.SECTIONS = { min: 1, max: 1 };
    g.PHRASES_PER_SECTION = { min: 1, max: 1 };
  }
  if (typeof options.log === 'string') {
    g.LOG = options.log;
  }
}

/**
 * Creates a minimal test composer for testing functions that require a composer
 * Only used when absolutely necessary (per test philosophy - prefer real composers)
 */
export function createMinimalTestComposer() {
  return {
    getMeter: () => [4, 4] as [number, number],
    getDivisions: () => 2,
    getSubdivisions: () => 2,
    getNotes: () => [{ note: 60, velocity: 80 }],
    constructor: { name: 'TestComposer' }
  };
}

/**
 * Type guard for checking if __POLYCHRON_TEST__ namespace exists
 */
export function hasTestNamespace(): boolean {
  return typeof globalThis.__POLYCHRON_TEST__ !== 'undefined';
}

/**
 * Gets a value from __POLYCHRON_TEST__ namespace safely
 */
export function getTestValue<T>(key: string, defaultValue: T): T {
  if (!globalThis.__POLYCHRON_TEST__) {
    return defaultValue;
  }
  return (globalThis.__POLYCHRON_TEST__ as any)[key] ?? defaultValue;
}

/**
 * Sets a value in __POLYCHRON_TEST__ namespace
 */
export function setTestValue(key: string, value: any): void {
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  (globalThis.__POLYCHRON_TEST__ as any)[key] = value;
}

// Legacy helper removed: explicit exposure of writer globals is no longer supported.
// Use `registerWriterServices(ctx.services)` and access writers via the DI container
// (e.g., `ctx.services.get('pushMultiple')` or the helper `getWriterServices(ctx)`).

// Convenience to obtain writer services from a context without touching globals
export function getWriterServices(ctx: ICompositionContext) {
  return {
    pushMultiple: ctx.services.get('pushMultiple'),
    grandFinale: ctx.services.get('grandFinale'),
    CSVBuffer: ctx.services.get('CSVBuffer')
  } as const;
}
