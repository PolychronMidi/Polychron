import { describe, it, expect, beforeEach } from 'vitest';
import { initializePlayEngine } from '../src/play.js';
import { setupGlobalState, createTestContext } from './helpers.module.js';
import { registerWriterServices } from '../src/writer.js';

beforeEach(() => {
  setupGlobalState();
  const ctx = createTestContext();
  registerWriterServices(ctx.services);
});

describe('Play Engine Note Generation', () => {
  it('should generate note events when running composition', async () => {
    const g = globalThis as any;

    // Clear the buffer
    if (g.c && g.c.rows) {
      g.c.rows = [];
    } else if (Array.isArray(g.c)) {
      g.c.length = 0;
    }

    // Run a minimal composition
    await initializePlayEngine();

    // Check if any note_on events were generated
    let noteOnCount = 0;
    let allEvents = [];

    if (g.c && g.c.rows) {
      allEvents = g.c.rows;
      noteOnCount = g.c.rows.filter((e: any) => e.type === 'on').length;
    } else if (Array.isArray(g.c)) {
      allEvents = g.c;
      noteOnCount = g.c.filter((e: any) => e.type === 'on').length;
    }

    // Debug output
    console.log(`Total events: ${allEvents.length}`);
    console.log(`Note ON events: ${noteOnCount}`);
    console.log(`First 10 events:`, allEvents.slice(0, 10).map((e: any) => ({ type: e.type, tick: e.tick })));

    expect(noteOnCount, 'should generate at least some note_on events').toBeGreaterThan(0);
  });
});
