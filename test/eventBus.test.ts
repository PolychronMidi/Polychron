import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EventBus,
  EventType,
  EventPayload,
  CompositionStartedEvent,
  MeasureCompleteEvent,
  CompositionCompleteEvent,
  ErrorOccurredEvent,
  emitCompositionStarted,
  emitMeasureComplete,
  emitLayerComplete,
  emitCompositionComplete,
  emitError,
  emitConfigChanged,
  emitModuleInitialized,
} from '../src/EventBus';

describe('EventBus - Event System', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = EventBus.getInstance();
    bus.clear();
  });

  afterEach(() => {
    bus.clear();
  });

  describe('EventBus singleton', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = EventBus.getInstance();
      const instance2 = EventBus.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should start with no listeners', () => {
      expect(bus.getTotalListenerCount()).toBe(0);
    });

    it('should start with empty history', () => {
      expect(bus.getEventHistory()).toHaveLength(0);
    });
  });

  describe('Event subscription (on)', () => {
    it('should add listener for event type', () => {
      const listener = vi.fn();
      bus.on(EventType.COMPOSITION_STARTED, listener);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(1);
    });

    it('should support multiple listeners for same event type', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_STARTED, listener2);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(2);
    });

    it('should return unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = bus.on(EventType.COMPOSITION_STARTED, listener);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(1);

      unsubscribe();

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(0);
    });

    it('should support multiple event types', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_COMPLETE, listener2);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(1);
      expect(bus.getListenerCount(EventType.COMPOSITION_COMPLETE)).toBe(1);
      expect(bus.getTotalListenerCount()).toBe(2);
    });
  });

  describe('One-time subscription (once)', () => {
    it('should fire listener only once', async () => {
      const listener = vi.fn();
      bus.once(EventType.COMPOSITION_STARTED, listener);

      const event: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      // Use emitAsync to properly handle the async wrapper in once()
      await bus.emitAsync(event);
      expect(listener).toHaveBeenCalledTimes(1);

      await bus.emitAsync(event);
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should return unsubscribe function for once listener', () => {
      const listener = vi.fn();
      const unsubscribe = bus.once(EventType.COMPOSITION_STARTED, listener);

      unsubscribe();

      const event: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      bus.emit(event);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Event unsubscription (off)', () => {
    it('should remove listener', () => {
      const listener = vi.fn();
      bus.on(EventType.COMPOSITION_STARTED, listener);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(1);

      bus.off(EventType.COMPOSITION_STARTED, listener);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(0);
    });

    it('should not affect other listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_STARTED, listener2);

      bus.off(EventType.COMPOSITION_STARTED, listener1);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(1);
      expect(bus.getListeners(EventType.COMPOSITION_STARTED)[0]).toBe(listener2);
    });
  });

  describe('Event emission (emit)', () => {
    it('should call all listeners when event is emitted', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_STARTED, listener2);

      const event: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      bus.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it('should not call listeners for different event types', () => {
      const listener = vi.fn();
      bus.on(EventType.COMPOSITION_STARTED, listener);

      const event: CompositionCompleteEvent = {
        type: EventType.COMPOSITION_COMPLETE,
        timestamp: Date.now(),
        duration: 1000,
        layers: ['primary'],
      };

      bus.emit(event);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should continue emitting if one listener throws', () => {
      const listener1 = vi.fn(() => {
        throw new Error('listener1 error');
      });
      const listener2 = vi.fn();

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_STARTED, listener2);

      const event: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      // Should not throw
      expect(() => bus.emit(event)).not.toThrow();

      // Both listeners should have been called
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should add event to history', () => {
      const event: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      bus.emit(event);

      const history = bus.getEventHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(event);
    });
  });

  describe('Async event emission (emitAsync)', () => {
    it('should call async listeners', async () => {
      const listener = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      bus.on(EventType.COMPOSITION_STARTED, listener);

      const event: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      await bus.emitAsync(event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should wait for all async listeners', async () => {
      const order: number[] = [];

      const listener1 = vi.fn(async () => {
        await new Promise((resolve) => {
          setTimeout(() => {
            order.push(1);
            resolve(undefined);
          }, 20);
        });
      });

      const listener2 = vi.fn(async () => {
        await new Promise((resolve) => {
          setTimeout(() => {
            order.push(2);
            resolve(undefined);
          }, 10);
        });
      });

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_STARTED, listener2);

      const event: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      await bus.emitAsync(event);

      // Should have waited for both
      expect(order).toContain(1);
      expect(order).toContain(2);
    });
  });

  describe('Listener retrieval', () => {
    it('should get listeners for event type', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_STARTED, listener2);

      const listeners = bus.getListeners(EventType.COMPOSITION_STARTED);
      expect(listeners).toHaveLength(2);
      expect(listeners).toContain(listener1);
      expect(listeners).toContain(listener2);
    });

    it('should return empty array if no listeners', () => {
      const listeners = bus.getListeners(EventType.COMPOSITION_STARTED);
      expect(listeners).toHaveLength(0);
    });

    it('should get listener count', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      bus.on(EventType.COMPOSITION_STARTED, listener1);
      bus.on(EventType.COMPOSITION_STARTED, listener2);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(2);
    });

    it('should get total listener count across all types', () => {
      bus.on(EventType.COMPOSITION_STARTED, vi.fn());
      bus.on(EventType.COMPOSITION_STARTED, vi.fn());
      bus.on(EventType.COMPOSITION_COMPLETE, vi.fn());
      bus.on(EventType.ERROR_OCCURRED, vi.fn());

      expect(bus.getTotalListenerCount()).toBe(4);
    });
  });

  describe('Event history', () => {
    it('should store emitted events', () => {
      const event1: CompositionStartedEvent = {
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      };

      const event2: CompositionCompleteEvent = {
        type: EventType.COMPOSITION_COMPLETE,
        timestamp: Date.now(),
        duration: 1000,
        layers: ['primary'],
      };

      bus.emit(event1);
      bus.emit(event2);

      const history = bus.getEventHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(event1);
      expect(history[1]).toEqual(event2);
    });

    it('should limit history size', () => {
      bus.setMaxHistorySize(5);

      for (let i = 0; i < 10; i++) {
        const event: CompositionStartedEvent = {
          type: EventType.COMPOSITION_STARTED,
          timestamp: Date.now(),
        };
        bus.emit(event);
      }

      expect(bus.getEventHistory()).toHaveLength(5);
    });

    it('should get history by event type', () => {
      bus.emit({
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      } as CompositionStartedEvent);

      bus.emit({
        type: EventType.COMPOSITION_COMPLETE,
        timestamp: Date.now(),
        duration: 1000,
        layers: ['primary'],
      } as CompositionCompleteEvent);

      bus.emit({
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      } as CompositionStartedEvent);

      const history = bus.getEventHistoryByType(EventType.COMPOSITION_STARTED);
      expect(history).toHaveLength(2);
      expect(history.every((e) => e.type === EventType.COMPOSITION_STARTED)).toBe(true);
    });

    it('should get limited history', () => {
      for (let i = 0; i < 10; i++) {
        bus.emit({
          type: EventType.COMPOSITION_STARTED,
          timestamp: Date.now(),
        } as CompositionStartedEvent);
      }

      const history = bus.getEventHistory(3);
      expect(history).toHaveLength(3);
    });

    it('should export history as JSON', () => {
      bus.emit({
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      } as CompositionStartedEvent);

      const json = bus.exportHistory();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].type).toBe(EventType.COMPOSITION_STARTED);
    });
  });

  describe('State management', () => {
    it('should clear all listeners', () => {
      bus.on(EventType.COMPOSITION_STARTED, vi.fn());
      bus.on(EventType.COMPOSITION_COMPLETE, vi.fn());

      expect(bus.getTotalListenerCount()).toBe(2);

      bus.clear();

      expect(bus.getTotalListenerCount()).toBe(0);
    });

    it('should clear listeners for specific type', () => {
      bus.on(EventType.COMPOSITION_STARTED, vi.fn());
      bus.on(EventType.COMPOSITION_COMPLETE, vi.fn());

      bus.clearListeners(EventType.COMPOSITION_STARTED);

      expect(bus.getListenerCount(EventType.COMPOSITION_STARTED)).toBe(0);
      expect(bus.getListenerCount(EventType.COMPOSITION_COMPLETE)).toBe(1);
    });

    it('should clear history', () => {
      bus.emit({
        type: EventType.COMPOSITION_STARTED,
        timestamp: Date.now(),
      } as CompositionStartedEvent);

      expect(bus.getEventHistory()).toHaveLength(1);

      bus.clearHistory();

      expect(bus.getEventHistory()).toHaveLength(0);
    });
  });

  describe('Helper emission functions', () => {
    it('emitCompositionStarted should emit typed event', () => {
      const listener = vi.fn();
      bus.on(EventType.COMPOSITION_STARTED, listener);

      emitCompositionStarted({ bpm: 120 });

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe(EventType.COMPOSITION_STARTED);
      expect(event.config?.bpm).toBe(120);
    });

    it('emitMeasureComplete should emit typed event', () => {
      const listener = vi.fn();
      bus.on(EventType.MEASURE_COMPLETE, listener);

      const notes = [{ pitch: 'C', octave: 4, duration: 1 }];
      emitMeasureComplete(1, notes, 'primary');

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe(EventType.MEASURE_COMPLETE);
      expect((event as MeasureCompleteEvent).measureNumber).toBe(1);
      expect((event as MeasureCompleteEvent).notes).toEqual(notes);
    });

    it('emitCompositionComplete should emit typed event', () => {
      const listener = vi.fn();
      bus.on(EventType.COMPOSITION_COMPLETE, listener);

      emitCompositionComplete(5000, ['primary', 'poly']);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe(EventType.COMPOSITION_COMPLETE);
      expect((event as CompositionCompleteEvent).duration).toBe(5000);
      expect((event as CompositionCompleteEvent).layers).toEqual(['primary', 'poly']);
    });

    it('emitError should emit error event', () => {
      const listener = vi.fn();
      bus.on(EventType.ERROR_OCCURRED, listener);

      const error = new Error('test error');
      emitError(error, { context: 'test' });

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe(EventType.ERROR_OCCURRED);
      expect((event as ErrorOccurredEvent).error).toBe(error);
      expect((event as ErrorOccurredEvent).context).toEqual({ context: 'test' });
    });

    it('emitLayerComplete should emit typed event', () => {
      const listener = vi.fn();
      bus.on(EventType.LAYER_COMPLETE, listener);

      emitLayerComplete('primary', 4, 64);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe(EventType.LAYER_COMPLETE);
    });

    it('emitConfigChanged should emit typed event', () => {
      const listener = vi.fn();
      bus.on(EventType.CONFIG_CHANGED, listener);

      emitConfigChanged(['bpm', 'ppq'], { bpm: 120 }, { bpm: 140 });

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe(EventType.CONFIG_CHANGED);
    });

    it('emitModuleInitialized should emit typed event', () => {
      const listener = vi.fn();
      bus.on(EventType.MODULE_INITIALIZED, listener);

      emitModuleInitialized('Stage');

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.type).toBe(EventType.MODULE_INITIALIZED);
    });
  });

  describe('Module decoupling', () => {
    it('should allow Stage and Writer to communicate via events', () => {
      // Stage emits events
      const stageEmit = vi.fn((event: EventPayload) => bus.emit(event));

      // Writer listens to events
      const writerListener = vi.fn();
      bus.on(EventType.COMPOSITION_COMPLETE, writerListener);

      // Stage creates composition
      const event: CompositionCompleteEvent = {
        type: EventType.COMPOSITION_COMPLETE,
        timestamp: Date.now(),
        duration: 1000,
        layers: ['primary'],
      };

      stageEmit(event);

      // Writer received notification
      expect(writerListener).toHaveBeenCalledWith(event);
    });

    it('should support multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      bus.on(EventType.COMPOSITION_COMPLETE, handler1);
      bus.on(EventType.COMPOSITION_COMPLETE, handler2);
      bus.on(EventType.COMPOSITION_COMPLETE, handler3);

      const event: CompositionCompleteEvent = {
        type: EventType.COMPOSITION_COMPLETE,
        timestamp: Date.now(),
        duration: 1000,
        layers: ['primary'],
      };

      bus.emit(event);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });
  });
});
