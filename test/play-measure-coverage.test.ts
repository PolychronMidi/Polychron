import { describe, it, expect } from 'vitest';
import { initializePlayEngine, getCurrentCompositionContext } from '../src/play.js';
import { createTestContext } from './helpers.module.js';
import { getPolychronContext } from '../src/PolychronInit.js';

// Ensure measures are actually produced across the composition run
describe('Play Engine Measure Coverage', () => {
  it('emits measure markers across multiple measure numbers when LOG=all', async () => {
    // Apply common test defaults to keep runs fast/deterministic (DI-only)
    const ctx = createTestContext();
    ctx.LOG = 'all';
    ctx.state.SECTIONS = { min: 1, max: 1 };
    // Force at least two measures per phrase for deterministic coverage
    ctx.state.measuresPerPhrase = 2;

    // Silence console during engine run to avoid large output slowing test
    const _realLog = console.log;
    const _realDebug = console.debug;
    const _realWarn = console.warn;
    console.log = () => {};
    console.debug = () => {};
    console.warn = () => {};

    // DEBUG: inspect poly.state before initializing
    // eslint-disable-next-line no-console
    console.log('DEBUG pre-init poly.state.measuresPerPhrase=', (getPolychronContext().state as any).measuresPerPhrase);

    try {
      await initializePlayEngine();
    } finally {
      console.log = _realLog;
      console.debug = _realDebug;
      console.warn = _realWarn;
    }

    const engineCtx = getCurrentCompositionContext();
    expect(engineCtx, 'composition context should be available').toBeDefined();
    // DEBUG: inspect measures values
    // eslint-disable-next-line no-console
    console.log('DEBUG engine measuresPerPhrase values: ', { measuresPerPhrase: engineCtx.state.measuresPerPhrase, measuresPerPhrase1: engineCtx.state.measuresPerPhrase1, measuresPerPhrase2: engineCtx.state.measuresPerPhrase2 });

    const layers = engineCtx?.LM?.layers ? engineCtx.LM.layers : {};
    const allRows: any[] = [];
    Object.values(layers).forEach((entry: any) => {
      const buf = entry.buffer && entry.buffer.rows ? entry.buffer.rows : entry.buffer;
      if (Array.isArray(buf)) {
        for (let i = 0; i < buf.length; i++) {
          allRows.push(buf[i]);
          if (allRows.length > 1_000_000) break;
        }
      }
    });

    const markers = allRows.filter((r: any) => r && r.type === 'marker_t' && r.vals && r.vals.length > 0);
    expect(markers.length).toBeGreaterThan(0);

    const measureMarkers = markers.filter((m: any) => String(m.vals[0]).includes('Measure'));
    // There should be at least one measure marker
    expect(measureMarkers.length).toBeGreaterThan(0);

    const measureNums = new Set<number>();
    measureMarkers.forEach((m: any) => {
      const match = /Measure\s+(\d+)\//.exec(String(m.vals[0]));
      if (match) {
        measureNums.add(Number(match[1]));
      }
    });

    // Debug: log measureNums for diagnostic
    // eslint-disable-next-line no-console
    console.log('DEBUG measureNums=', Array.from(measureNums).slice(0,20));

    // Expect at least one marker for measure > 1 (i.e., measure 2 or later)
    const hasMeasure2plus = Array.from(measureNums).some(n => n > 1);
    expect(hasMeasure2plus, `measureNums=${Array.from(measureNums).slice(0,10)}`).toBe(true);
  }, 120000);
});
