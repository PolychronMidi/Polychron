import { describe, it, expect } from 'vitest';
import { initializePlayEngine } from '../src/play.js';
import * as fs from 'fs';

describe('Output tick=0 proportion', () => {
  it('ensures not more than 30% of NOTE ON events are at tick 0', { timeout: 120000 }, async () => {
    // deterministic run
    await initializePlayEngine(undefined, undefined, { seed: 12345 });

    const csv = fs.readFileSync('output/output1.csv', 'utf8');
    const lines = csv.split('\n').filter(l => l.trim().length > 0);
    const dataLines = lines.filter(l => !l.startsWith('0,0,header') && !l.includes('start_track') && !l.includes('end_track'));

    const onEvents = dataLines.filter(line => line.includes(',on,') || line.includes(',note_on,') || line.includes(',note_on_c,'));
    const onTick0 = onEvents.filter(line => {
      const parts = line.split(',');
      const t = Number(parts[1]);
      return Number.isFinite(t) && t === 0;
    });

    const total = onEvents.length;
    const zeros = onTick0.length;

    // Allow up to 30% of note on events at tick 0; higher indicates stacking bug
    const prop = total === 0 ? 0 : (zeros / total);
    expect(prop, `tick0 proportion should be < 30% (got ${Math.round(prop * 100)}%)`).toBeLessThan(0.30);
  });
});
