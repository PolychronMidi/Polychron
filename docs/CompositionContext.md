# CompositionContext.ts - Shared Composition Runtime

> **Status**: Core Context  
> **Dependencies**: CompositionStateService, DIContainer, CompositionProgress, time.ts, writer.ts


## Overview

`CompositionContext.ts` constructs and threads a single context object containing state, services, timing/logging hooks, and progress/cancellation wiring. It also provides helpers to sync this context to legacy globals during migration.

**Core Responsibilities:**
- Build a typed context (`ICompositionContext`) with state, DI container, event bus, composers/config, progress/cancellation, and logging hooks
- Sync context to/from globals for backward compatibility
- Expose CompositionStateService for consumers

## Architecture Role

- Used by initialization to carry shared services through composition calls instead of globalThis
- Supports progressive migration by syncing state/config to legacy globals when needed

---

## API

### `interface ICompositionContext`

Shape of the composition context passed through the system.

<!-- BEGIN: snippet:ICompositionContext -->

```typescript
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
```

<!-- END: snippet:ICompositionContext -->

### `createCompositionContext(container, eventBus, config, progressCallback?, cancellationToken?, csvBuffer?, LOG?)`

Build a fresh context with state, services, config, progress hooks, and logging helpers.

### `syncContextToGlobals(ctx)`

Copy context state/config/services to `globalThis` for legacy consumers.

### `loadContextFromGlobals(container, eventBus)`

Create a context using legacy globals, then sync state into the new service.

### `CompositionStateService`

State service re-export for convenience.

---

## Usage Example

```typescript
import { createCompositionContext, syncContextToGlobals } from '../src/CompositionContext';
import { CompositionEventBusImpl } from '../src/CompositionProgress';
import { DIContainer } from '../src/DIContainer';

const ctx = createCompositionContext(
  new DIContainer(),
  new CompositionEventBusImpl(),
  { BPM: 120, PPQ: 480, SECTIONS: { min: 1, max: 4 }, COMPOSERS: [] }
);

syncContextToGlobals(ctx);
```

---

## Related Modules

- CompositionState.ts ([code](../src/CompositionState.ts)) ([doc](CompositionState.md)) - Underlying state service
- CompositionProgress.ts ([code](../src/CompositionProgress.ts)) ([doc](CompositionProgress.md)) - Progress/cancellation contracts
- DIContainer.ts ([code](../src/DIContainer.ts)) ([doc](DIContainer.md)) - Service wiring
- time.ts ([code](../src/time.ts)) ([doc](time.md)) and writer.ts ([code](../src/writer.ts)) ([doc](writer.md)) - Timing/logging hooks used in context
