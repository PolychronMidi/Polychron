// test/async.test.ts - Tests for async/promise patterns in composition engine
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CancellationTokenSource } from '../src/CancellationToken.js';
import {
  CompositionProgress,
  CompositionPhase,
  CancellationTokenImpl,
  CompositionEventBusImpl,
  type ProgressCallback,
} from '../src/CompositionProgress.js';

describe('CancellationToken', () => {
  it('should create a token that is not cancelled initially', () => {
    const source = new CancellationTokenSource();
    const token = source.token;

    expect(token.isCancelled).toBe(false);
    expect(() => token.throwIfRequested()).not.toThrow();
  });

  it('should mark token as cancelled when cancel() is called', () => {
    const source = new CancellationTokenSource();
    const token = source.token;

    source.cancel();

    expect(token.isCancelled).toBe(true);
  });

  it('should throw when throwIfRequested() is called on cancelled token', () => {
    const source = new CancellationTokenSource();
    const token = source.token;

    source.cancel();

    expect(() => token.throwIfRequested()).toThrow('Operation was cancelled');
  });

  it('should reset cancellation state', () => {
    const source = new CancellationTokenSource();
    const token = source.token;

    source.cancel();
    expect(token.isCancelled).toBe(true);

    source.reset();
    expect(token.isCancelled).toBe(false);
    expect(() => token.throwIfRequested()).not.toThrow();
  });

  it('should allow multiple tokens from same source', () => {
    const source = new CancellationTokenSource();
    const token1 = source.token;
    const token2 = source.token;

    source.cancel();

    expect(token1.isCancelled).toBe(true);
    expect(token2.isCancelled).toBe(true);
  });
});

describe('Async Play Engine Integration', () => {
  beforeEach(async () => {
    // Ensure legacy globals are initialized for modules that read them at import-time
    const { setupGlobalState } = await import('./helpers');
    setupGlobalState();

    // Import dependencies after globals are set up
    await import('../dist/sheet.js');
    await import('../dist/venue.js');
    await import('../dist/backstage.js');
    await import('../dist/writer.js');
    await import('../dist/time.js');
    await import('../dist/composers.js');
    await import('../dist/rhythm.js');
    await import('../dist/stage.js');

    // Setup minimal global state (override defaults if needed)
    const g = globalThis as any;
    g.BPM = 120;
    g.PPQ = 480;
    g.SECTIONS = { min: 1, max: 2 };
    g.COMPOSERS = [{ type: 'scale', root: 'C', scaleName: 'major' }];
    g.c = [];
    g.csvRows = [];
    g.composers = [];
    g.LOG = 'none';
  });

  it('should call progress callback with initialization phase', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const progressCallback = vi.fn();

    await initializePlayEngine(progressCallback);

    const calls = progressCallback.mock.calls.map(c => c[0]);
    const initCall = calls.find((p: CompositionProgress) => p.phase === 'initializing');

    expect(initCall).toBeDefined();
    expect(initCall.progress).toBe(0);
  });

  it('should call progress callback with composing phase', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const progressCallback = vi.fn();

    await initializePlayEngine(progressCallback);

    const calls = progressCallback.mock.calls.map(c => c[0]);
    const composeCall = calls.find((p: CompositionProgress) => p.phase === 'composing');

    expect(composeCall).toBeDefined();
    expect(composeCall.progress).toBeGreaterThanOrEqual(5);
  });

  it('should call progress callback with rendering phase', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const progressCallback = vi.fn();

    await initializePlayEngine(progressCallback);

    const calls = progressCallback.mock.calls.map(c => c[0]);
    const renderCall = calls.find((p: CompositionProgress) => p.phase === 'rendering');

    expect(renderCall).toBeDefined();
    expect(renderCall.progress).toBe(90);
  });

  it('should call progress callback with complete phase', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const progressCallback = vi.fn();

    await initializePlayEngine(progressCallback);

    const calls = progressCallback.mock.calls.map(c => c[0]);
    const completeCall = calls.find((p: CompositionProgress) => p.phase === 'complete');

    expect(completeCall).toBeDefined();
    expect(completeCall.progress).toBe(100);
  });

  it('should include section info in progress updates', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const progressCallback = vi.fn();
    const g = globalThis as any;
    g.SECTIONS = { min: 3, max: 3 }; // Force 3 sections

    await initializePlayEngine(progressCallback);

    const calls = progressCallback.mock.calls.map(c => c[0]);
    const sectionCalls = calls.filter((p: CompositionProgress) =>
      p.phase === 'composing' && p.sectionIndex !== undefined
    );

    expect(sectionCalls.length).toBeGreaterThan(0);
    expect(sectionCalls[0].totalSections).toBe(3);
  });

  it('should throw and stop when cancellation is requested', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const source = new CancellationTokenSource();
    const progressCallback = vi.fn((progress: CompositionProgress) => {
      // Cancel after initialization
      if (progress.phase === 'composing') {
        source.cancel();
      }
    });

    await expect(
      initializePlayEngine(progressCallback, source.token)
    ).rejects.toThrow('Operation was cancelled');
  });

  it('should complete successfully without callbacks or cancellation token', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');

    await expect(initializePlayEngine()).resolves.not.toThrow();
  });

  it('should generate valid output when using async mode', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const g = globalThis as any;

    await initializePlayEngine();

    // g.c is a CSVBuffer object, check its rows property
    expect(g.c.rows).toBeDefined();
    expect(g.c.rows.length).toBeGreaterThan(0);
    // Check that most events have tick property (some might be null/special entries)
    const eventsWithTicks = g.c.rows.filter((event: any) => event && event.tick !== undefined);
    expect(eventsWithTicks.length).toBeGreaterThan(0);
  });

  it('should support awaiting the engine', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');

    const result = initializePlayEngine();

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it('should call progress callback multiple times', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const progressCallback = vi.fn();

    await initializePlayEngine(progressCallback);

    expect(progressCallback).toHaveBeenCalled();
    expect(progressCallback.mock.calls.length).toBeGreaterThanOrEqual(4); // init, compose, render, complete
  });

  it('should have progress increase monotonically', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const progressValues: number[] = [];
    const progressCallback = (progress: CompositionProgress) => {
      progressValues.push(progress.progress);
    };

    await initializePlayEngine(progressCallback);

    // Check that progress generally increases (allowing for same values)
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
  });

  it('should clean up resources after cancellation', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const source = new CancellationTokenSource();
    const g = globalThis as any;

    // Cancel immediately
    source.cancel();

    try {
      await initializePlayEngine(undefined, source.token);
    } catch (err) {
      // Expected cancellation error
    }

    // Global state should still be initialized (cancellation doesn't corrupt state)
    expect(g.DIContainer).toBeDefined();
  });

  it('should handle cancellation at different composition stages', async () => {
    const { initializePlayEngine } = await import('../dist/play.js');
    const source = new CancellationTokenSource();
    let cancelAtProgress = 50;
    const progressCallback = vi.fn((progress: CompositionProgress) => {
      if (progress.progress >= cancelAtProgress) {
        source.cancel();
      }
    });

    await expect(
      initializePlayEngine(progressCallback, source.token)
    ).rejects.toThrow('Operation was cancelled');

    const lastCall = progressCallback.mock.calls[progressCallback.mock.calls.length - 1][0];
    expect(lastCall.progress).toBeLessThan(100);
  });
});

// Merged from step9-async.test.ts
describe('Step 9: Async/Promise Patterns', () => {
  describe('CancellationToken', () => {
    let token: CancellationTokenImpl;

    beforeEach(() => {
      token = new CancellationTokenImpl();
    });

    it('should initialize as not cancelled', () => {
      expect(token.isCancelled).toBe(false);
    });

    it('should set cancelled flag on cancel()', () => {
      token.cancel();
      expect(token.isCancelled).toBe(true);
    });

    it('should throw on throwIfRequested when cancelled', () => {
      token.cancel();
      expect(() => token.throwIfRequested()).toThrow('Composition cancelled by user');
    });

    it('should not throw on throwIfRequested when not cancelled', () => {
      expect(() => token.throwIfRequested()).not.toThrow();
    });

    it('should remain not cancelled after throwIfRequested if not cancelled', () => {
      token.throwIfRequested();
      expect(token.isCancelled).toBe(false);
    });
  });

  describe('CompositionEventBus', () => {
    let bus: CompositionEventBusImpl;

    beforeEach(() => {
      bus = new CompositionEventBusImpl();
    });

    it('should emit and receive progress events', () => {
      return new Promise<void>((resolve) => {
        const progress: CompositionProgress = {
          phase: CompositionPhase.COMPOSING,
          progress: 50,
          message: 'Composing section 2/4',
          sectionIndex: 1,
          totalSections: 4,
        };

        bus.on('progress', (data) => {
          expect(data).toEqual(progress);
          resolve();
        });

        bus.emit('progress', progress);
      });
    });

    it('should emit and receive error events', () => {
      return new Promise<void>((resolve) => {
        const error = new Error('Test error');

        bus.on('error', (err) => {
          expect(err).toEqual(error);
          resolve();
        });

        bus.emit('error', error);
      });
    });

    it('should emit and receive complete events', () => {
      return new Promise<void>((resolve) => {
        bus.on('complete', () => {
          expect(true).toBe(true);
          resolve();
        });

        bus.emit('complete');
      });
    });

    it('should emit and receive cancelled events', () => {
      return new Promise<void>((resolve) => {
        bus.on('cancelled', () => {
          expect(true).toBe(true);
          resolve();
        });

        bus.emit('cancelled');
      });
    });

    it('should handle multiple listeners for same event', () => {
      let count = 0;

      bus.on('progress', () => {
        count++;
      });

      bus.on('progress', () => {
        count++;
      });

      bus.on('progress', () => {
        count++;
      });

      bus.emit('progress', { phase: 'test', progress: 0, message: 'test' });

      expect(count).toBe(3);
    });

    it('should remove listener with off()', () => {
      return new Promise<void>((resolve) => {
        let count = 0;

        const handler = () => {
          count++;
        };

        bus.on('progress', handler);
        bus.off('progress', handler);

        bus.emit('progress', { phase: 'test', progress: 0, message: 'test' });

        setTimeout(() => {
          expect(count).toBe(0);
          resolve();
        }, 10);
      });
    });

    it('should handle errors in handlers gracefully', () => {
      const errorHandler = () => {
        throw new Error('Handler error');
      };

      const successHandler = () => {
        expect(true).toBe(true);
      };

      bus.on('progress', errorHandler);
      bus.on('progress', successHandler);

      // Should not throw, despite error in first handler
      expect(() => {
        bus.emit('progress', { phase: 'test', progress: 0, message: 'test' });
      }).not.toThrow();
    });

    it('should clear all listeners', () => {
      return new Promise<void>((resolve) => {
        let count = 0;

        bus.on('progress', () => count++);
        bus.on('complete', () => count++);
        bus.on('error', () => count++);

        bus.clear();

        bus.emit('progress', { phase: 'test', progress: 0, message: 'test' });
        bus.emit('complete');
        bus.emit('error', new Error('test'));

        setTimeout(() => {
          expect(count).toBe(0);
          resolve();
        }, 50);
      });
    });
  });

  describe('CompositionProgress Type', () => {
    it('should support progress-only format', () => {
      const progress: CompositionProgress = {
        phase: CompositionPhase.INITIALIZING,
        progress: 0,
        message: 'Initializing composition engine',
      };
      expect(progress).toBeDefined();
    });

    it('should support detailed section format', () => {
      const progress: CompositionProgress = {
        phase: CompositionPhase.COMPOSING,
        progress: 45,
        message: 'Composing section 3/6',
        sectionIndex: 2,
        totalSections: 6,
        phraseIndex: 0,
        measuresPerPhrase: 4,
      };
      expect(progress.sectionIndex).toBe(2);
      expect(progress.totalSections).toBe(6);
    });

    it('should support error format', () => {
      const error = new Error('Composition failed');
      const progress: CompositionProgress = {
        phase: CompositionPhase.ERROR,
        progress: 0,
        message: 'Composition failed',
        error,
        errorCode: 'COMPOSITION_ERROR',
      };
      expect(progress.error).toEqual(error);
    });

    it('should support timing information', () => {
      const progress: CompositionProgress = {
        phase: CompositionPhase.RENDERING,
        progress: 90,
        message: 'Rendering MIDI output',
        elapsedMs: 5000,
        estimatedTotalMs: 6000,
      };
      expect(progress.elapsedMs).toBe(5000);
      expect(progress.estimatedTotalMs).toBe(6000);
    });
  });

  describe('Integration: Cancellation Token + Event Bus', () => {
    let token: CancellationTokenImpl;
    let bus: CompositionEventBusImpl;

    beforeEach(() => {
      token = new CancellationTokenImpl();
      bus = new CompositionEventBusImpl();
    });

    it('should support cancellation workflow', () => {
      return new Promise<void>((resolve) => {
        let progressCount = 0;
        let cancelledEmitted = false;

        bus.on('progress', () => {
          progressCount++;
        });

        bus.on('cancelled', () => {
          cancelledEmitted = true;
        });

        // Simulate composition loop
        for (let i = 0; i < 5; i++) {
          if (token.isCancelled) break;
          bus.emit('progress', {
            phase: CompositionPhase.COMPOSING,
            progress: (i / 5) * 100,
            message: `Section ${i}`,
          });
        }

        // Request cancellation
        token.cancel();
        bus.emit('cancelled');

        setTimeout(() => {
          expect(progressCount).toBe(5);
          expect(cancelledEmitted).toBe(true);
          expect(token.isCancelled).toBe(true);
          resolve();
        }, 10);
      });
    });

    it('should support early exit on cancellation', () => {
      let sectionsComposed = 0;

      for (let section = 0; section < 100; section++) {
        if (token.isCancelled) break;
        sectionsComposed++;

        if (section === 5) {
          token.cancel();
        }
      }

      expect(sectionsComposed).toBe(6); // 0-5, then exit
      expect(token.isCancelled).toBe(true);
    });
  });

  describe('CompositionPhase Enum', () => {
    it('should have all required phases', () => {
      expect(CompositionPhase.INITIALIZING).toBe('initializing');
      expect(CompositionPhase.COMPOSING).toBe('composing');
      expect(CompositionPhase.RENDERING).toBe('rendering');
      expect(CompositionPhase.COMPLETE).toBe('complete');
      expect(CompositionPhase.CANCELLED).toBe('cancelled');
      expect(CompositionPhase.ERROR).toBe('error');
    });
  });
});
