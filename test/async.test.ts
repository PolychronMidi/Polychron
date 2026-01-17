// test/async.test.ts - Tests for async/promise patterns in composition engine
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CancellationTokenSource } from '../src/CancellationToken.js';
import { CompositionProgress } from '../src/CompositionProgress.js';

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
    // Import dependencies - must happen after globals are set up
    await import('../dist/sheet.js');
    await import('../dist/venue.js');
    await import('../dist/backstage.js');
    await import('../dist/writer.js');
    await import('../dist/time.js');
    await import('../dist/composers.js');
    await import('../dist/rhythm.js');
    await import('../dist/stage.js');
    
    // Setup minimal global state
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
    g.c = [];
    
    await initializePlayEngine();
    
    expect(g.c.length).toBeGreaterThan(0);
    // Check that most events have tick property (some might be null/special entries)
    const eventsWithTicks = g.c.filter((event: any) => event && event.tick !== undefined);
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
