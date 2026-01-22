import { describe, it, expect } from 'vitest';
import { initializePlayEngine, getCurrentCompositionContext } from '../src/play.js';

// Strict per-measure coverage: ensure each measure has at least one NOTE ON event
// This uses the TimingTree's measure start/end ticks and checks the primary layer buffer

describe('Unit NOTE ON coverage (per-measure)', () => {
  it('each measure in primary should contain at least one NOTE ON event', { timeout: 180000 }, async () => {
    await initializePlayEngine(undefined, undefined, { seed: 12345 });

    const ctx = getCurrentCompositionContext();
    const tree = ctx.state.timingTree;
    const primary = tree && tree.children && tree.children['primary'];
    expect(primary, 'primary layer timing tree exists').toBeTruthy();

    const buf = ctx.LM && ctx.LM.layers && ctx.LM.layers['primary'] && ctx.LM.layers['primary'].buffer ? (ctx.LM.layers['primary'].buffer.rows || ctx.LM.layers['primary'].buffer) : [] as any[];

    const onEvents = (Array.isArray(buf) ? buf : []).filter((r: any) => r && (r.type === 'on' || r.type === 'note_on' || (Array.isArray(r.vals) && typeof r.vals[0] === 'number')));

    const missing: Array<{ section: number; phrase: number; measure: number; start: number; end: number; count: number }> = [];

    if (!primary || !primary.children || !primary.children['section']) {
      // nothing to check
      return;
    }

    const secs = Object.keys(primary.children['section']).map(k => Number(k)).sort((a, b) => a - b);
    for (const s of secs) {
      const secNode = primary.children['section'][String(s)];
      if (!secNode || !secNode.children || !secNode.children['phrase']) continue;
      const phKeys = Object.keys(secNode.children['phrase']).map(k => Number(k)).sort((a, b) => a - b);
      for (const p of phKeys) {
        const phr = secNode.children['phrase'][String(p)];
        if (!phr || !phr.children || !phr.children['measure']) continue;
        const measures = Object.keys(phr.children['measure']).map(k => Number(k)).sort((a, b) => a - b);
        for (const m of measures) {
          const mn = phr.children['measure'][String(m)];
          if (!mn) continue;
          const start = Number(mn.start ?? mn.measureStart ?? 0);
          const end = Number(mn.end ?? (mn.measureStart || 0) + (mn.tpMeasure || ctx.state.tpMeasure || 0));
          const inRange = onEvents.filter((e: any) => Number.isFinite(e.tick) && e.tick >= Math.round(start) && e.tick < Math.round(end));
          if ((inRange || []).length === 0) {
            missing.push({ section: s, phrase: p, measure: m, start: Math.round(start), end: Math.round(end), count: 0 });
          }
        }
      }
    }

    if (missing.length > 0) {
      console.error('DEBUG: measures with zero NOTE ON events:', missing.slice(0, 20));
      // Also show a small sample of the buffer to help diagnose stacking at tick 0
      console.error('DEBUG: sample buffer first 50 rows:', (buf || []).slice(0, 50));
    }

    expect(missing.length, 'every measure should contain at least one NOTE ON event').toBe(0);
  });
});
