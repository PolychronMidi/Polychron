import { initializePlayEngine } from '../src/play.js';
import * as fs from 'fs';

describe('section offsets integration', () => {
  it('writes units.json with no repeated startTick across sections', async () => {
    // Run a short composition with 3 sections to simulate per-section offsets
    await initializePlayEngine(undefined, undefined, { seed: 424242, SECTIONS: { min: 3, max: 3 }, SILENT_OUTRO_SECONDS: 0 });

    const path = 'output/units.json';
    expect(fs.existsSync(path)).toBe(true);
    const j = JSON.parse(fs.readFileSync(path, 'utf8'));
    const map: Record<string, number> = {};
    for (const u of j.units || []) {
      const key = `${u.layer}::${u.unitType}::${u.startTick}`;
      map[key] = (map[key] || 0) + 1;
    }
    const duplicates = Object.entries(map).filter(([, c]) => c > 1);
    if (duplicates.length > 0) {
      // Provide a helpful diagnostic in failure
      const first = duplicates.slice(0, 5).map(([k, c]) => `${k} x${c}`).join('\n');
      throw new Error(`Found duplicated startTick entries across sections:\n${first}`);
    }
    expect(duplicates.length).toBe(0);
  }, 20000);
});
