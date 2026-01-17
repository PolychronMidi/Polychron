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
  return {
    state: new CompositionStateService(),
    BPM: config.BPM,
    PPQ: config.PPQ,
    SECTIONS: config.SECTIONS,
    COMPOSERS: config.COMPOSERS,
    container,
    eventBus,
    progressCallback,
    cancellationToken,
    csvBuffer,
    LOG
  };
}

/**
 * Sync composition context to globals for backward compatibility
 * Used during migration phase to support legacy code
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
 * Load composition context from globals for backward compatibility
 * Used during migration phase to support legacy initialization
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
