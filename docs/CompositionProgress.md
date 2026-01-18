# CompositionProgress.ts - Progress + Cancellation Contracts

> **Source**: `src/CompositionProgress.ts`  
> **Status**: Core Contracts  
> **Dependencies**: None

## Overview

`CompositionProgress.ts` defines the progress phases, payloads, cancellation token, and a lightweight event bus for UI/controllers to observe composition state. It separates progress reporting from the main event bus and provides a simple cancellation hook.

**Core Responsibilities:**
- Enumerate composition phases and structure progress payloads
- Provide a cancellation token interface + implementation
- Offer a minimal event bus for progress/error/complete/cancel signals

## Architecture Role

- Used by CompositionContext to pass callbacks/tokens through composition
- Consumed by play/stage orchestration and UI layers to track progress and cancel work

---

## API

### `enum CompositionPhase`

Phases of the composition lifecycle.

<!-- BEGIN: snippet:CompositionPhase -->

```typescript
enum CompositionPhase {
  INITIALIZING = 'initializing',
  COMPOSING = 'composing',
  RENDERING = 'rendering',
  COMPLETE = 'complete',
  CANCELLED = 'cancelled',
  ERROR = 'error',
}
```

<!-- END: snippet:CompositionPhase -->

### `interface CompositionProgress`

Progress payload structure for UI/telemetry.

<!-- BEGIN: snippet:CompositionProgress -->

```typescript
export interface CompositionProgress {
  // Execution phase
  phase: CompositionPhase | string;

  // Overall progress 0-100
  progress: number;

  // Detailed progress info
  message: string;

  // Section/phrase tracking (for composing phase)
  sectionIndex?: number;
  totalSections?: number;
  phraseIndex?: number;
  measuresPerPhrase?: number;

  // Error info (for error phase)
  error?: Error;
  errorCode?: string;

  // Timing info
  elapsedMs?: number;
  estimatedTotalMs?: number;
}
```

<!-- END: snippet:CompositionProgress -->

### `type ProgressCallback`

Callback signature for progress events.

### `interface CancellationToken`

Cancellation contract with query and throw helpers.

<!-- BEGIN: snippet:CancellationToken -->

```typescript
export interface CancellationToken {
  /**
   * Check if cancellation was requested
   */
  isCancelled: boolean;

  /**
   * Throw error if cancellation was requested
   * Used to interrupt composition loops safely
   */
  throwIfRequested(): void;

  /**
   * Request cancellation
   */
  cancel(): void;
}
```

<!-- END: snippet:CancellationToken -->

### `class CancellationTokenImpl`

Default cancellation token implementation.

<!-- BEGIN: snippet:CancellationTokenImpl -->

```typescript
export class CancellationTokenImpl implements CancellationToken {
  private _cancelled = false;

  get isCancelled(): boolean {
    return this._cancelled;
  }

  throwIfRequested(): void {
    if (this._cancelled) {
      throw new Error('Composition cancelled by user');
    }
  }

  cancel(): void {
    this._cancelled = true;
  }
}
```

<!-- END: snippet:CancellationTokenImpl -->

### `interface CompositionEventBus`

Minimal event bus contract for progress/cancel/error events.

<!-- BEGIN: snippet:CompositionEventBus -->

```typescript
export interface CompositionEventBus {
  emit(event: 'progress', data: CompositionProgress): void;
  emit(event: 'error', error: Error): void;
  emit(event: 'complete'): void;
  emit(event: 'cancelled'): void;

  on(event: 'progress', handler: (data: CompositionProgress) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'complete', handler: () => void): void;
  on(event: 'cancelled', handler: () => void): void;

  off(event: string, handler: (...args: any[]) => void): void;
  clear(): void;
}
```

<!-- END: snippet:CompositionEventBus -->

### `class CompositionEventBusImpl`

In-memory implementation of `CompositionEventBus`.

<!-- BEGIN: snippet:CompositionEventBusImpl -->

```typescript
export class CompositionEventBusImpl implements CompositionEventBus {
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (e) {
          console.error(`Error in ${event} handler:`, e);
        }
      });
    }
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
```

<!-- END: snippet:CompositionEventBusImpl -->

#### `emit(event, data)` / `on(event, handler)` / `off(event, handler)` / `clear()`

Dispatch and manage progress bus listeners.

<!-- BEGIN: snippet:CompositionEventBusImpl_emit -->

```typescript
emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (e) {
          console.error(`Error in ${event} handler:`, e);
        }
      });
    }
  }
```

<!-- END: snippet:CompositionEventBusImpl_emit -->

<!-- BEGIN: snippet:CompositionEventBusImpl_on -->

```typescript
on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }
```

<!-- END: snippet:CompositionEventBusImpl_on -->

<!-- BEGIN: snippet:CompositionEventBusImpl_off -->

```typescript
off(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }
```

<!-- END: snippet:CompositionEventBusImpl_off -->

<!-- BEGIN: snippet:CompositionEventBusImpl_clear -->

```typescript
clear(): void {
    this.listeners.clear();
  }
```

<!-- END: snippet:CompositionEventBusImpl_clear -->

---

## Usage Example

```typescript
import { CompositionEventBusImpl, CompositionPhase, CancellationTokenImpl } from '../src/CompositionProgress';

const bus = new CompositionEventBusImpl();
const token = new CancellationTokenImpl();

bus.on('progress', (p) => console.log(p.phase, p.progress));

bus.emit('progress', { phase: CompositionPhase.INITIALIZING, progress: 5, message: 'Booting' });
// Later from UI
// token.cancel();
```

---

## Related Modules

- CompositionContext.ts ([code](../src/CompositionContext.ts)) ([doc](CompositionContext.md)) - Threads progress/cancellation through the system
- EventBus.ts ([code](../src/EventBus.ts)) ([doc](EventBus.md)) - Main typed event bus for lifecycle events
