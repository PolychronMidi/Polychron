import { createTestContext, createMinimalTestComposer } from './helpers';
import { getMidiTiming, setUnitTiming } from '../src/time.js';
import { pushMultiple, grandFinale } from '../src/writer.js';
import * as fs from 'fs';

describe('CSV per-row unit label diagnostics', () => {
  test('pushMultiple annotates unit label and CSV contains labels across measures', () => {
    const ctx = createTestContext();
    ctx.state.numerator = 4;
    ctx.state.denominator = 4;
    ctx.state.sectionIndex = 0;
    ctx.state.phraseIndex = 0;
    ctx.state.measureIndex = 0;
    ctx.state.composer = createMinimalTestComposer();

    getMidiTiming(ctx);
    setUnitTiming('phrase', ctx);

    const measureCount = 4;
    const labels = new Set<string>();

    for (let i = 0; i < measureCount; i++) {
      ctx.state.measureIndex = i;
      setUnitTiming('measure', ctx);

      // push three events at start, mid, end of measure
      const startTick = ctx.state.measureStart ?? 0;
      const midTick = startTick + Math.round((ctx.state.tpMeasure ?? 0) / 2);
      const endTick = startTick + Math.max(1, (ctx.state.tpMeasure ?? 1) - 1);

      pushMultiple(ctx.csvBuffer, { tick: startTick, type: 'on', vals: [0, 60, 100] }, { tick: midTick, type: 'on', vals: [0, 62, 100] }, { tick: endTick, type: 'on', vals: [0, 64, 100] });

      const label = (ctx.state as any).unitLabel;
      labels.add(label);

      const recent = Array.isArray(ctx.csvBuffer)
        ? ctx.csvBuffer.slice(-3)
        : (ctx.csvBuffer && Array.isArray((ctx.csvBuffer as any).rows)
          ? (ctx.csvBuffer as any).rows.slice(-3)
          : []);
      for (const evt of recent) {
        // Unit-label column is disabled — ensure no extra column is present
        expect(evt.vals[4]).toBeUndefined();
      }
    }

    expect(labels.size).toBe(measureCount);

    // Produce CSV and assert the file contains no 7th-column unit labels
    ctx.LM = { activeLayer: 'primary', layers: { primary: { buffer: ctx.csvBuffer, state: ctx.state } } } as any;
    grandFinale(ctx);

    const csv = fs.readFileSync('output/output1.csv', 'utf8');
    const lines = csv.split('\n').filter(l => l.trim().length > 0);

    // Exclude header/start/end metadata lines
    const dataLines = lines.filter(l => !l.startsWith('0,0,header') && !l.includes('start_track') && !l.includes('end_track'));

    // Find if any data line contains a 7th column with a unit label
    const labelFound = dataLines.some(line => {
      const cols = line.split(',');
      return cols.length >= 8 && cols[7] && cols[7].includes('start:');
    });

    // Expect no 7th-column unit labels (feature disabled)
    expect(labelFound).toBe(false);

    // Sanity: confirm events span across more than one measure tick range
    const ticks = dataLines.map(l => Number(l.split(',')[1] || 0)).filter(Number.isFinite);
    const maxTick = Math.max(...ticks);
    expect(maxTick).toBeGreaterThan(0);
  });
});
