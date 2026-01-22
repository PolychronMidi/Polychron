/**
 * CompositionProgress.ts
 * Event types and interfaces for tracking composition progress and enabling cancellation
 */

// Phases of the composition process
export enum CompositionPhase {
  INITIALIZING = 'initializing',
  COMPOSING = 'composing',
  RENDERING = 'rendering',
  COMPLETE = 'complete',
  CANCELLED = 'cancelled',
  ERROR = 'error',
}

/**
 * Progress event emitted during composition
 * Allows UI/controllers to track and react to composition state
 */
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

/**
 * Callback for receiving composition progress events
 */
export type ProgressCallback = (progress: CompositionProgress) => void;

/**
 * Token for requesting composition cancellation
 */
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

/**
 * Implementation of CancellationToken
 */
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

/**
 * Event bus for composition events
 * Allows emitting progress, errors, and completion
 */
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

/**
 * Simple event bus implementation for composition events
 */
export class CompositionEventBusImpl implements CompositionEventBus {
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (_e) {
          console.error(`Error in ${event} handler:`, _e);
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
