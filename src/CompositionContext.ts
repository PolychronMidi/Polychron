/**
 * CompositionContext.ts - Thread composition state and services through call stacks
 * Replaces global state dependency with explicit context passing
 *
 * This context object encapsulates all mutable and immutable state needed
 * during composition, enabling pure functions and easier testing/debugging.
 */

import { CompositionStateService } from './CompositionState.js';
import { DIContainer } from './DIContainer.js';
import { CompositionEventBus, ProgressCallback, CancellationToken } from './CompositionProgress.js';
import { setUnitTiming as setUnitTimingFn } from './time.js';
import { logUnit as logUnitFn } from './writer.js';
import { getPolychronContext } from './PolychronInit.js';

/**
 * Composition context - contains all state and services needed for composition
 * Threaded through the call stack instead of relying on globals
 */
export interface ICompositionContext {
  // State management
  state: CompositionStateService;

  // Configuration and environment
  BPM: number;
  PPQ: number;
  SECTIONS: { min: number; max: number };
  COMPOSERS: any[];

  // Services (DI container)
  container: DIContainer;
  eventBus: CompositionEventBus;

  // Convenience aliases (some tests expect `services`, and some code references `LM` and `stage`)
  services?: any;
  LM?: any;
  stage?: any;

  // Progress tracking
  progressCallback?: ProgressCallback;
  cancellationToken?: CancellationToken;

  // CSV output buffer
  csvBuffer: any;

  // Logging
  LOG: string;

  // Timing functions
  logUnit: (unitType: string) => void;
  setUnitTiming: (unitType: string) => void;
}

/**
 * Create a new composition context with all required state and services
 */
export function createCompositionContext(
  container: DIContainer,
  eventBus: CompositionEventBus,
  config: { BPM: number; PPQ: number; SECTIONS: any; COMPOSERS: any[] },
  progressCallback?: ProgressCallback,
  cancellationToken?: CancellationToken,
  csvBuffer?: any,
  LOG: string = 'none'
): ICompositionContext {
  const ctx: ICompositionContext = {
    state: new CompositionStateService(),
    BPM: config.BPM,
    PPQ: config.PPQ,
    SECTIONS: config.SECTIONS,
    COMPOSERS: config.COMPOSERS,
    container,
    // Provide a `services` alias to match test helpers and to support requirePush(ctx)
    services: container as any,
    eventBus,
    progressCallback,
    cancellationToken,
    csvBuffer,
    LOG,
    // Ensure logUnit honors the current active buffer and respects ctx.LOG
    logUnit: (unitType: string) => logUnitFn(unitType, ctx),
    setUnitTiming: (unitType: string) => setUnitTimingFn(unitType, ctx)
  };
  return ctx;
}

/**
 * Sync composition context to globals
 * Used to support initialization flows that rely on globals
 */
export function syncContextToGlobals(ctx: ICompositionContext): void {
  // Avoid writing to globalThis; sync into PolychronContext.test and PolychronContext.state namespaces
  const poly = getPolychronContext();

  // State
  ctx.state.syncToGlobal();

  // Config (store in test namespace for legacy read paths)
  poly.test = poly.test || {};
  poly.test.BPM = ctx.BPM;
  poly.test.PPQ = ctx.PPQ;
  poly.test.SECTIONS = ctx.SECTIONS;
  poly.test.COMPOSERS = ctx.COMPOSERS;

  // Services
  poly.test.DIContainer = ctx.container;
  poly.test.eventBus = ctx.eventBus;

  // Logging
  poly.test.LOG = ctx.LOG;

  // CSV buffer
  if (ctx.csvBuffer) {
    poly.test.c = ctx.csvBuffer;
  }
}

/**
 * Load composition context from globals
 * Used to support initialization flows that rely on globals
 */
export function loadContextFromGlobals(container: DIContainer, eventBus: CompositionEventBus): ICompositionContext {
  const poly = getPolychronContext();
  const g = poly.test || {};

  const ctx = createCompositionContext(
    container,
    eventBus,
    {
      BPM: g.BPM || 120,
      PPQ: g.PPQ || 480,
      SECTIONS: g.SECTIONS || { min: 1, max: 4 },
      COMPOSERS: g.COMPOSERS || []
    },
    undefined,
    undefined,
    g.c || { rows: [] },
    g.LOG || 'none'
  );

  // Load state from test namespace if available
  ctx.state.syncFromGlobal();

  return ctx;
}

export { CompositionStateService };
