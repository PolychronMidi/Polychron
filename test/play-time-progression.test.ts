import { describe, it, expect } from 'vitest';
import { initializePlayEngine, getCurrentCompositionContext } from '../src/play.js';
import { getPolychronContext } from '../src/PolychronInit';

// Integration test: verify generated events span beyond the first measure
describe('Play Engine Timing Progression', () => {
  it('produces events across multiple measures (not all stacked in measure 0)', async () => {
    // Configure a small composition via DI test namespace to keep test fast
    const poly = getPolychronContext();
    poly.test = poly.test || {} as any;
    poly.test.SECTIONS = { min: 1, max: 1 };

    // Run a short composition and get the composition context
    const ctx = await initializePlayEngine();
    expect(ctx, 'composition context should be available').toBeDefined();

    const primaryLayer = ctx?.LM?.layers && ctx.LM.layers['primary'];
    expect(primaryLayer, 'primary layer should be registered').toBeDefined();

    const buf = primaryLayer.buffer && primaryLayer.buffer.rows ? primaryLayer.buffer.rows : primaryLayer.buffer;
    expect(Array.isArray(buf)).toBe(true);
    const ticks = (Array.isArray(buf) ? buf : buf.rows).map((r: any) => r.tick || 0).filter((t: number) => Number.isFinite(t));

    // There should be events; guard against trivial failure
    expect(ticks.length).toBeGreaterThan(0);

    // Compute max tick without spreading (avoids call stack issues when buffer is very large)
    const maxTick = ticks.reduce((m: number, t: number) => Math.max(m, t), Number.NEGATIVE_INFINITY);
    const tpMeasure = primaryLayer.state && primaryLayer.state.tpMeasure ? primaryLayer.state.tpMeasure : 0;

    // Expect at least one event to occur after the first measure boundary
    expect(maxTick, `max tick ${maxTick} should be greater than tpMeasure ${tpMeasure}`).toBeGreaterThan(tpMeasure);
  });
});
