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
    logUnit: (unitType: string) => logUnitFn(unitType),
    setUnitTiming: (unitType: string) => setUnitTimingFn(unitType, ctx)
  };
  return ctx;
}

/**
 * Sync composition context to globals
 * Used to support initialization flows that rely on globals
 */
export function syncContextToGlobals(ctx: ICompositionContext): void {
  const g = globalThis as any;

  // State
  ctx.state.syncToGlobal();

  // Config
  g.BPM = ctx.BPM;
  g.PPQ = ctx.PPQ;
  g.SECTIONS = ctx.SECTIONS;
  g.COMPOSERS = ctx.COMPOSERS;

  // Services
  g.DIContainer = ctx.container;
  g.eventBus = ctx.eventBus;

  // Logging
  g.LOG = ctx.LOG;

  // CSV buffer
  if (ctx.csvBuffer) {
    g.c = ctx.csvBuffer;
  }
}

/**
 * Load composition context from globals
 * Used to support initialization flows that rely on globals
 */
export function loadContextFromGlobals(container: DIContainer, eventBus: CompositionEventBus): ICompositionContext {
  const g = globalThis as any;

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

  // Load state from globals if available
  ctx.state.syncFromGlobal();

  return ctx;
}

export { CompositionStateService };
