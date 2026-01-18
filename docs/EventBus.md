<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# EventBus.ts - Typed Composition Event Bus

> **Status**: Core Utility  
> **Dependencies**: None (standalone)


## Overview

`EventBus.ts` provides a typed, singleton event bus for composition lifecycle events. It supports sync/async emission, one-time listeners, bounded history, and helper emitters for common lifecycle signals.

**Core Responsibilities:**
- Typed events for composition start/progress/completion/config changes/errors
- Subscribe, unsubscribe, once-listen, and inspect listener counts
- Emit synchronously or asynchronously with bounded event history
- Helper emitters for composition lifecycle convenience

## Architecture Role

- Used by composition orchestration (play/stage/writer) to decouple modules
- Event history aids debugging and optional replay/export

---

## API

### `enum EventType`

Lifecycle event types.

<!-- BEGIN: snippet:EventType -->

```typescript
enum EventType {
  COMPOSITION_STARTED = 'COMPOSITION_STARTED',
  MEASURE_COMPLETE = 'MEASURE_COMPLETE',
  LAYER_COMPLETE = 'LAYER_COMPLETE',
  COMPOSITION_COMPLETE = 'COMPOSITION_COMPLETE',
  ERROR_OCCURRED = 'ERROR_OCCURRED',
  CONFIG_CHANGED = 'CONFIG_CHANGED',
  MODULE_INITIALIZED = 'MODULE_INITIALIZED',
}
```

<!-- END: snippet:EventType -->

### `type EventPayload`

Union of all payload interfaces.

### `class EventBus`

Singleton event bus with history and sync/async emission.

<!-- BEGIN: snippet:EventBus -->

```typescript
export class EventBus {
  private static instance: EventBus;
  private listeners: Map<EventType, Set<EventListener>> = new Map();
  private eventHistory: EventPayload[] = [];
  private maxHistorySize = 1000;
  private isEmitting = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Subscribe to events of a specific type
   * @returns Cleanup function to unsubscribe
   */
  on(eventType: EventType, listener: EventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }

    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => this.off(eventType, listener);
  }

  /**
   * Subscribe to event that fires only once
   * @returns Cleanup function
   */
  once(eventType: EventType, listener: EventListener): () => void {
    const onceWrapper = async (event: EventPayload) => {
      await listener(event);
      this.off(eventType, onceWrapper);
    };

    return this.on(eventType, onceWrapper);
  }

  /**
   * Unsubscribe from events
   */
  off(eventType: EventType, listener: EventListener): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Emit event synchronously to all listeners
   */
  emit(event: EventPayload): void {
    if (this.isEmitting) {
      // Prevent recursive emissions
      console.warn('EventBus: Recursive emission detected, queuing event');
      return;
    }

    this.isEmitting = true;

    try {
      // Add to history
      this.addToHistory(event);

      // Emit to all listeners
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (error) {
            console.error(
              `EventBus: Error in listener for ${event.type}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    } finally {
      this.isEmitting = false;
    }
  }

  /**
   * Emit event asynchronously to all listeners
   * Waits for all async listeners to complete
   */
  async emitAsync(event: EventPayload): Promise<void> {
    if (this.isEmitting) {
      console.warn('EventBus: Recursive async emission detected, queuing event');
      return;
    }

    this.isEmitting = true;

    try {
      // Add to history
      this.addToHistory(event);

      // Emit to all listeners in parallel
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        const promises = Array.from(listeners).map(async (listener) => {
          try {
            await listener(event);
          } catch (error) {
            console.error(
              `EventBus: Error in async listener for ${event.type}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        });

        await Promise.all(promises);
      }
    } finally {
      this.isEmitting = false;
    }
  }

  /**
   * Get all listeners for an event type
   */
  getListeners(eventType: EventType): EventListener[] {
    const listeners = this.listeners.get(eventType);
    return listeners ? Array.from(listeners) : [];
  }

  /**
   * Get listener count for an event type
   */
  getListenerCount(eventType: EventType): number {
    return this.listeners.get(eventType)?.size ?? 0;
  }

  /**
   * Get total listener count across all event types
   */
  getTotalListenerCount(): number {
    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.size;
    }
    return total;
  }

  /**
   * Add event to history (for debugging/replay)
   */
  private addToHistory(event: EventPayload): void {
    this.eventHistory.push(event);

    // Keep history size bounded
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history (for debugging)
   */
  getEventHistory(limit?: number): EventPayload[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  /**
   * Get event history for specific type
   */
  getEventHistoryByType(eventType: EventType, limit?: number): EventPayload[] {
    const filtered = this.eventHistory.filter((e) => e.type === eventType);
    if (limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * Clear all listeners (useful for testing)
   */
  clear(): void {
    this.listeners.clear();
    this.eventHistory = [];
  }

  /**
   * Clear listeners for specific event type
   */
  clearListeners(eventType: EventType): void {
    this.listeners.delete(eventType);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Set max history size
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    // Trim history if needed
    if (this.eventHistory.length > size) {
      this.eventHistory = this.eventHistory.slice(-size);
    }
  }

  /**
   * Export event history as JSON (for logging/debugging)
   */
  exportHistory(): string {
    return JSON.stringify(
      this.eventHistory.map((e) => ({
        type: e.type,
        timestamp: e.timestamp,
        // Only include non-circular properties
        ...Object.fromEntries(
          Object.entries(e).filter(([key]) => key !== 'type' && key !== 'timestamp' && key !== 'error')
        ),
      })),
      null,
      2
    );
  }
}
```

<!-- END: snippet:EventBus -->

#### `on(eventType, listener)` / `once(eventType, listener)` / `off(eventType, listener)`

Manage listeners with optional one-shot semantics.

<!-- BEGIN: snippet:EventBus_on -->

```typescript
on(eventType: EventType, listener: EventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }

    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => this.off(eventType, listener);
  }
```

<!-- END: snippet:EventBus_on -->

<!-- BEGIN: snippet:EventBus_once -->

```typescript
once(eventType: EventType, listener: EventListener): () => void {
    const onceWrapper = async (event: EventPayload) => {
      await listener(event);
      this.off(eventType, onceWrapper);
    };

    return this.on(eventType, onceWrapper);
  }
```

<!-- END: snippet:EventBus_once -->

<!-- BEGIN: snippet:EventBus_off -->

```typescript
off(eventType: EventType, listener: EventListener): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }
```

<!-- END: snippet:EventBus_off -->

#### `emit(event)` / `emitAsync(event)`

Broadcast events synchronously or asynchronously.

<!-- BEGIN: snippet:EventBus_emit -->

```typescript
emit(event: EventPayload): void {
    if (this.isEmitting) {
      // Prevent recursive emissions
      console.warn('EventBus: Recursive emission detected, queuing event');
      return;
    }

    this.isEmitting = true;

    try {
      // Add to history
      this.addToHistory(event);

      // Emit to all listeners
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (error) {
            console.error(
              `EventBus: Error in listener for ${event.type}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    } finally {
      this.isEmitting = false;
    }
  }
```

<!-- END: snippet:EventBus_emit -->

<!-- BEGIN: snippet:EventBus_emitAsync -->

```typescript
async emitAsync(event: EventPayload): Promise<void> {
    if (this.isEmitting) {
      console.warn('EventBus: Recursive async emission detected, queuing event');
      return;
    }

    this.isEmitting = true;

    try {
      // Add to history
      this.addToHistory(event);

      // Emit to all listeners in parallel
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        const promises = Array.from(listeners).map(async (listener) => {
          try {
            await listener(event);
          } catch (error) {
            console.error(
              `EventBus: Error in async listener for ${event.type}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        });

        await Promise.all(promises);
      }
    } finally {
      this.isEmitting = false;
    }
  }
```

<!-- END: snippet:EventBus_emitAsync -->

#### `getListeners(eventType)` / `getListenerCount(eventType)` / `getTotalListenerCount()`

Inspect listeners.

<!-- BEGIN: snippet:EventBus_getListeners -->

```typescript
getListeners(eventType: EventType): EventListener[] {
    const listeners = this.listeners.get(eventType);
    return listeners ? Array.from(listeners) : [];
  }
```

<!-- END: snippet:EventBus_getListeners -->

<!-- BEGIN: snippet:EventBus_getListenerCount -->

```typescript
getListenerCount(eventType: EventType): number {
    return this.listeners.get(eventType)?.size ?? 0;
  }
```

<!-- END: snippet:EventBus_getListenerCount -->

<!-- BEGIN: snippet:EventBus_getTotalListenerCount -->

```typescript
getTotalListenerCount(): number {
    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.size;
    }
    return total;
  }
```

<!-- END: snippet:EventBus_getTotalListenerCount -->

#### `getEventHistory(limit?)` / `getEventHistoryByType(eventType, limit?)` / `exportHistory()`

Access/export bounded history.

<!-- BEGIN: snippet:EventBus_getEventHistory -->

```typescript
getEventHistory(limit?: number): EventPayload[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }
```

<!-- END: snippet:EventBus_getEventHistory -->

<!-- BEGIN: snippet:EventBus_getEventHistoryByType -->

```typescript
getEventHistoryByType(eventType: EventType, limit?: number): EventPayload[] {
    const filtered = this.eventHistory.filter((e) => e.type === eventType);
    if (limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }
```

<!-- END: snippet:EventBus_getEventHistoryByType -->

<!-- BEGIN: snippet:EventBus_exportHistory -->

```typescript
exportHistory(): string {
    return JSON.stringify(
      this.eventHistory.map((e) => ({
        type: e.type,
        timestamp: e.timestamp,
        // Only include non-circular properties
        ...Object.fromEntries(
          Object.entries(e).filter(([key]) => key !== 'type' && key !== 'timestamp' && key !== 'error')
        ),
      })),
      null,
      2
    );
  }
```

<!-- END: snippet:EventBus_exportHistory -->

#### `clear()` / `clearListeners(eventType)` / `clearHistory()` / `setMaxHistorySize(size)`

Test helpers and limits.

<!-- BEGIN: snippet:EventBus_clear -->

```typescript
clear(): void {
    this.listeners.clear();
    this.eventHistory = [];
  }
```

<!-- END: snippet:EventBus_clear -->

<!-- BEGIN: snippet:EventBus_clearListeners -->

```typescript
clearListeners(eventType: EventType): void {
    this.listeners.delete(eventType);
  }
```

<!-- END: snippet:EventBus_clearListeners -->

<!-- BEGIN: snippet:EventBus_clearHistory -->

```typescript
clearHistory(): void {
    this.eventHistory = [];
  }
```

<!-- END: snippet:EventBus_clearHistory -->

<!-- BEGIN: snippet:EventBus_setMaxHistorySize -->

```typescript
setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    // Trim history if needed
    if (this.eventHistory.length > size) {
      this.eventHistory = this.eventHistory.slice(-size);
    }
  }
```

<!-- END: snippet:EventBus_setMaxHistorySize -->

### Lifecycle Emitters

Helper functions to emit typed lifecycle events: `emitCompositionStarted`, `emitMeasureComplete`, `emitLayerComplete`, `emitCompositionComplete`, `emitError`.

---

## Usage Example

```typescript
import { EventBus, EventType, emitCompositionStarted } from '../src/EventBus';

const bus = EventBus.getInstance();
const off = bus.on(EventType.MEASURE_COMPLETE, (ev) => {
  console.log(ev.measureNumber, ev.notes.length);
});

emitCompositionStarted({ bpm: 120 });
bus.emit({ type: EventType.CONFIG_CHANGED, timestamp: Date.now(), changedKeys: ['bpm'] });
off();
```

---

## Related Modules

- CompositionProgress.ts ([code](../src/CompositionProgress.ts)) ([doc](CompositionProgress.md)) - UI-facing progress events/cancellation
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Emits measure/layer completion
- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - Consumes events during playback
