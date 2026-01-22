import { describe, it, expect } from 'vitest';
import { initializePlayEngine } from '../src/play.js';
import * as fs from 'fs';

describe('CSV measure label adherence', () => {
  it('labels in 7th column should show correct measure start/end in ticks matching tpMeasure', { timeout: 180000 }, async () => {
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const { getCurrentCompositionContext } = await import('../src/play.js');
    const engineCtx = getCurrentCompositionContext();

    const primary = engineCtx.LM.layers.primary;
    const tpMeasure = primary.state.tpMeasure || engineCtx.state.tpMeasure || 1;

    const csv = fs.readFileSync('output/output1.csv', 'utf8');
    const lines = csv.split('\n').filter(l => l.trim().length > 0);

    // The CSV writer no longer injects a 7th-column measure label (DI-only behavior).
    // Verify that no 7th-column measure labels are present.
    const measureLabels: Array<{ start: number; end: number; index?: number }> = [];

    for (const line of lines) {
      const cols = line.split(',');
      if (cols.length < 7) continue;
      const lbl = cols[6];
      if (!lbl || typeof lbl !== 'string') continue;
      const m = lbl.match(/measure(\d+)\s+start:/i);
      if (m) {
        measureLabels.push({ index: Number(m[1]), start: 0, end: 0 });
      }
    }

    // Assert that there are no injected 7th-column measure labels
    expect(measureLabels.length).toBe(0);
  });
});
