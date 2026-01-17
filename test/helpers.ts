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

import { CompositionState } from '../src/CompositionState.js';

/**
 * Creates a fresh CompositionState for testing
 * Exposes state to __POLYCHRON_TEST__ namespace for test instrumentation
 */
export function createTestState(): CompositionState {
  const state = new CompositionState();

  // Expose to test namespace for instrumentation
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
  }
  globalThis.__POLYCHRON_TEST__.state = state;

  return state;
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

  // Initialize test namespace
  if (!globalThis.__POLYCHRON_TEST__) {
    globalThis.__POLYCHRON_TEST__ = {};
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
