import { describe, it, expect } from 'vitest';
import { initializePlayEngine } from '../src/play.js';
import { setupTestDefaults } from './helpers.js';

// Ensure measures are actually produced across the composition run
describe('Play Engine Measure Coverage', () => {
  it('emits measure markers across multiple measure numbers when LOG=all', async () => {
    // Apply common test defaults to keep runs fast/deterministic
    setupTestDefaults({ smallComposition: true, log: 'all' });

    await initializePlayEngine();

    const g = globalThis as any;
    const layers = g.LM && g.LM.layers ? g.LM.layers : {};
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

    // Expect at least one marker for measure > 1 (i.e., measure 2 or later)
    const hasMeasure2plus = Array.from(measureNums).some(n => n > 1);
    expect(hasMeasure2plus, `measureNums=${Array.from(measureNums).slice(0,10)}`).toBe(true);
  });
});
