/**
 * Event System - Formalized event bus for decoupling modules
 * Replaces direct callbacks between Stage ↔ Writer with typed event emissions
 */

/**
 * Typed event payloads for all composition lifecycle events
 */
export enum EventType {
  COMPOSITION_STARTED = 'COMPOSITION_STARTED',
  MEASURE_COMPLETE = 'MEASURE_COMPLETE',
  LAYER_COMPLETE = 'LAYER_COMPLETE',
  COMPOSITION_COMPLETE = 'COMPOSITION_COMPLETE',
  ERROR_OCCURRED = 'ERROR_OCCURRED',
  CONFIG_CHANGED = 'CONFIG_CHANGED',
  MODULE_INITIALIZED = 'MODULE_INITIALIZED',
}

/**
 * Event payload types - minimal interfaces for each event
 */
export interface CompositionStartedEvent {
  type: EventType.COMPOSITION_STARTED;
  timestamp: number;
  config?: any;
}

export interface MeasureCompleteEvent {
  type: EventType.MEASURE_COMPLETE;
  timestamp: number;
  measureNumber: number;
  notes: any[];
  layer: string;
}

export interface LayerCompleteEvent {
  type: EventType.LAYER_COMPLETE;
  timestamp: number;
  layer: string;
  measureCount: number;
  totalNotes: number;
}

export interface CompositionCompleteEvent {
  type: EventType.COMPOSITION_COMPLETE;
  timestamp: number;
  duration: number; // milliseconds
  layers: string[];
}

export interface ErrorOccurredEvent {
  type: EventType.ERROR_OCCURRED;
  timestamp: number;
  error: Error;
  context?: any;
}

export interface ConfigChangedEvent {
  type: EventType.CONFIG_CHANGED;
  timestamp: number;
  changedKeys: string[];
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
}

export interface ModuleInitializedEvent {
  type: EventType.MODULE_INITIALIZED;
  timestamp: number;
  moduleName: string;
}

/**
 * Union type of all event payloads
 */
export type EventPayload =
  | CompositionStartedEvent
  | MeasureCompleteEvent
  | LayerCompleteEvent
  | CompositionCompleteEvent
  | ErrorOccurredEvent
  | ConfigChangedEvent
  | ModuleInitializedEvent;

/**
 * Event listener callback type
 */
export type EventListener = (event: EventPayload) => void | Promise<void>;

/**
 * Event listener with removal function
 */
export interface RegisteredListener {
  listener: EventListener;
  once: boolean;
  remove(): void;
}

/**
 * Event Bus - Singleton for global event management
 * Decouples modules by allowing them to emit and listen to typed events
 */
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

/**
 * Helper function to emit composition lifecycle events
 */
export function emitCompositionStarted(config?: any): void {
  EventBus.getInstance().emit({
    type: EventType.COMPOSITION_STARTED,
    timestamp: Date.now(),
    config,
  } as CompositionStartedEvent);
}

export function emitMeasureComplete(
  measureNumber: number,
  notes: any[],
  layer: string
): void {
  EventBus.getInstance().emit({
    type: EventType.MEASURE_COMPLETE,
    timestamp: Date.now(),
    measureNumber,
    notes,
    layer,
  } as MeasureCompleteEvent);
}

export function emitLayerComplete(
  layer: string,
  measureCount: number,
  totalNotes: number
): void {
  EventBus.getInstance().emit({
    type: EventType.LAYER_COMPLETE,
    timestamp: Date.now(),
    layer,
    measureCount,
    totalNotes,
  } as LayerCompleteEvent);
}

export function emitCompositionComplete(
  duration: number,
  layers: string[]
): void {
  EventBus.getInstance().emit({
    type: EventType.COMPOSITION_COMPLETE,
    timestamp: Date.now(),
    duration,
    layers,
  } as CompositionCompleteEvent);
}

export function emitError(error: Error, context?: any): void {
  EventBus.getInstance().emit({
    type: EventType.ERROR_OCCURRED,
    timestamp: Date.now(),
    error,
    context,
  } as ErrorOccurredEvent);
}

export function emitConfigChanged(
  changedKeys: string[],
  oldValues?: Record<string, any>,
  newValues?: Record<string, any>
): void {
  EventBus.getInstance().emit({
    type: EventType.CONFIG_CHANGED,
    timestamp: Date.now(),
    changedKeys,
    oldValues,
    newValues,
  } as ConfigChangedEvent);
}

export function emitModuleInitialized(moduleName: string): void {
  EventBus.getInstance().emit({
    type: EventType.MODULE_INITIALIZED,
    timestamp: Date.now(),
    moduleName,
  } as ModuleInitializedEvent);
}
