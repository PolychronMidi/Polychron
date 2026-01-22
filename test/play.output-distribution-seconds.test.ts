import { describe, it, expect } from 'vitest';
import { initializePlayEngine } from '../src/play.js';
import * as fs from 'fs';

describe('Play output tick->seconds distribution checks', () => {
  it('events are distributed beyond the first 2 seconds and align with measure seconds', async () => {
    // Use deterministic seed for reproducible runs
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const { getCurrentCompositionContext } = await import('../src/play.js');
    const engineCtx = getCurrentCompositionContext();

    const primary = engineCtx.LM.layers.primary;
    const poly = engineCtx.LM.layers.poly;

    const pBuf = primary.buffer && primary.buffer.rows ? primary.buffer.rows : primary.buffer;
    const qBuf = poly.buffer && poly.buffer.rows ? poly.buffer.rows : poly.buffer;

    const tpSec = primary.state.tpSec ?? engineCtx.state.tpSec ?? 1; // ticks per second

    // Basic check: ensure events exist beyond 2 seconds
    const pSeconds = (pBuf as any[]).map((e: any) => Number.isFinite(e.tick) ? (e.tick / tpSec) : null).filter((v: any) => v !== null) as number[];
    const qSeconds = (qBuf as any[]).map((e: any) => Number.isFinite(e.tick) ? (e.tick / tpSec) : null).filter((v: any) => v !== null) as number[];

    // Ensure there is at least one event beyond 2 seconds in each buffer
    expect(pSeconds.some(s => s > 2), 'primary has events beyond 2s').toBe(true);
    expect(qSeconds.some(s => s > 2), 'poly has events beyond 2s').toBe(true);

    // Check CSV labels' measure ranges and ensure at least one event falls into each measure's second range
    const csv = fs.readFileSync('output/output1.csv', 'utf8');
    const lines = csv.split('\n').filter(l => l.trim().length > 0);
    const measureLabels: Array<{ index?: number; startTick: number; endTick: number }> = [];

    for (const line of lines) {
      const cols = line.split(',');
      if (cols.length < 7) continue;
      const lbl = cols[6];
      if (!lbl || typeof lbl !== 'string') continue;
      // Look for 'measure' token and numeric start/end
      const m = lbl.match(/measure(\d+)\s+start:\s*([0-9.]+)\s+end:\s*([0-9.]+)/i);
      if (m) {
        const idx = Number(m[1]);
        const start = Number(m[2]);
        const end = Number(m[3]);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          measureLabels.push({ index: idx, startTick: start, endTick: end });
        }
      }
    }

    // Deduplicate measure labels by index with minimal ranges
    const grouped = new Map<number, { start: number; end: number }>();
    for (const ml of measureLabels) {
      if (!ml.index) continue;
      const idx = ml.index;
      const cur = grouped.get(idx);
      if (!cur) grouped.set(idx, { start: ml.startTick, end: ml.endTick });
      else grouped.set(idx, { start: Math.min(cur.start, ml.startTick), end: Math.max(cur.end, ml.endTick) });
    }

    const groups = Array.from(grouped.entries()).map(([idx, v]) => ({ index: idx, start: v.start, end: v.end }));

    const dataLines = lines.filter(l => !l.startsWith('0,0,header') && !l.includes('start_track') && !l.includes('end_track'));
    const ticks = dataLines.map(line => {
      const parts = line.split(',');
      const t = Number(parts[1]);
      return Number.isFinite(t) ? t : null;
    }).filter((v) => v !== null) as number[];

    for (const g of groups) {
      const startSec = g.start / tpSec;
      const endSec = g.end / tpSec;
      const count = ticks.filter(t => t >= g.start && t < g.end).length;
      expect(count, `expected events inside measure index=${g.index} seconds=${startSec.toFixed(2)}-${endSec.toFixed(2)}`).toBeGreaterThan(0);
    }
  }, 180000);
});
