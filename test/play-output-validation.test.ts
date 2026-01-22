import { describe, it, expect, beforeEach } from 'vitest';
import { initializePlayEngine } from '../src/play.js';
import { createTestContext } from './helpers.module.js';
import { registerWriterServices } from '../src/writer.js';

beforeEach(() => {
  const ctx = createTestContext();
  registerWriterServices(ctx.services);
});

describe('Play Engine Note Generation', () => {
  it('should generate note events when running composition', async () => {
      // Run a minimal composition
    await initializePlayEngine();

    // Collect events from engine's layers (DI-based)
    const { getCurrentCompositionContext } = await import('../src/play.js');
    const engineCtx = getCurrentCompositionContext();
    expect(engineCtx).toBeDefined();
    const layers = engineCtx?.LM?.layers ? engineCtx.LM.layers : {};
    const allEvents: any[] = [];
    Object.values(layers).forEach((entry: any) => {
      const buf = entry.buffer && entry.buffer.rows ? entry.buffer.rows : entry.buffer;
      if (Array.isArray(buf)) {
        allEvents.push(...buf);
      }
    });

    const noteOnCount = allEvents.filter((e: any) => e.type === 'on').length;

    // Debug output
    console.log(`Total events: ${allEvents.length}`);
    console.log(`Note ON events: ${noteOnCount}`);
    console.log(`First 10 events:`, allEvents.slice(0, 10).map((e: any) => ({ type: e.type, tick: e.tick })));

    expect(noteOnCount, 'should generate at least some note_on events').toBeGreaterThan(0);
  }, 300000);
});
