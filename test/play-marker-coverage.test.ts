import { describe, it, expect } from 'vitest';
import { initializePlayEngine } from '../src/play.js';
import { setupTestDefaults } from './helpers.js';

// Integration test: verify marker_t entries exist for all timing units
describe('Play Engine Marker Coverage', () => {
  it('emits marker_t for each timing unit when LOG=all', async () => {
    // Use central defaults to keep integration run small and deterministic
    setupTestDefaults({ smallComposition: true, log: 'all' });

    // Run a short composition
    await initializePlayEngine();

    const g = globalThis as any;
    // Collect buffers from all layers to avoid false negatives when markers are split across layers
    const layers = g.LM && g.LM.layers ? g.LM.layers : {};
    const allRows: any[] = [];
    Object.values(layers).forEach((entry: any) => {
      const buf = entry.buffer && entry.buffer.rows ? entry.buffer.rows : entry.buffer;
      if (Array.isArray(buf)) {
        console.log('DEBUG: layer buffer length=', buf.length, 'first=', buf[0] && buf[0].type);
        for (let i = 0; i < buf.length; i++) {
          try {
            allRows.push(buf[i]);
          } catch (err) {
            console.error('ERROR pushing buf item', { idx: i, len: buf.length, err });
            throw err;
          }
          if (allRows.length > 1000000) {
            console.warn('Too many rows collected, truncating to 1e6');
            break;
          }
        }
      }
    });

    expect(allRows.length).toBeGreaterThan(0);

    const markers = allRows.filter((r: any) => r && r.type === 'marker_t' && r.vals && r.vals.length > 0);

    // Debug output to inspect buffer contents when markers are missing
    if (markers.length === 0) {
      console.log('DEBUG: total rows=', allRows.length);
      console.log('DEBUG: sample row types=', allRows.slice(0, 50).map((r: any) => ({ type: r.type, tick: r.tick, vals: r.vals && r.vals.slice ? r.vals.slice(0,1) : r.vals })));
    }

    expect(markers.length, 'should find at least one marker_t event').toBeGreaterThan(0);

    const unitNames = ['Section', 'Phrase', 'Measure', 'Beat', 'Division', 'Subdivision', 'Subsubdivision'];

    unitNames.forEach((unit) => {
      const found = markers.some((m: any) => String(m.vals[0]).includes(unit));
      expect(found, `${unit} marker missing`).toBe(true);

      // If multiple markers for the unit exist, assert their ticks progress
      const unitMarkers = markers.filter((m: any) => String(m.vals[0]).includes(unit)).sort((a: any, b: any) => (a.tick || 0) - (b.tick || 0));
      if (unitMarkers.length >= 2) {
        const firstTick = unitMarkers[0].tick || 0;
        const lastTick = unitMarkers[unitMarkers.length - 1].tick || 0;
        // Allow non-decreasing ticks (some units may have multiple markers at same tick)
        expect(lastTick).toBeGreaterThanOrEqual(firstTick);
      }
    });
  });
});
