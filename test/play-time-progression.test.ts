import { describe, it, expect } from 'vitest';
import { initializePlayEngine, getCurrentCompositionContext } from '../src/play.js';

// Integration test: verify generated events span beyond the first measure
describe('Play Engine Timing Progression', () => {
  it('produces events across multiple measures (not all stacked in measure 0)', async () => {
    // Run a short composition
    await initializePlayEngine();

    const g = globalThis as any;
    // Access primary layer buffer
    const primaryLayer = g.LM && g.LM.layers && g.LM.layers['primary'];
    expect(primaryLayer, 'primary layer should be registered').toBeDefined();

    const buf = primaryLayer.buffer && primaryLayer.buffer.rows ? primaryLayer.buffer.rows : primaryLayer.buffer;
    expect(Array.isArray(buf)).toBe(true);
    const ticks = (Array.isArray(buf) ? buf : buf.rows).map((r: any) => r.tick || 0).filter((t: number) => Number.isFinite(t));

    // There should be events; guard against trivial failure
    expect(ticks.length).toBeGreaterThan(0);

    // Compute max tick without spreading (avoids call stack issues when buffer is very large)
    const maxTick = ticks.reduce((m: number, t: number) => Math.max(m, t), Number.NEGATIVE_INFINITY);
    const tpMeasure = primaryLayer.state && primaryLayer.state.tpMeasure ? primaryLayer.state.tpMeasure : (g.tpMeasure || 0);

    // Expect at least one event to occur after the first measure boundary
    expect(maxTick, `max tick ${maxTick} should be greater than tpMeasure ${tpMeasure}`).toBeGreaterThan(tpMeasure);
  });
});
