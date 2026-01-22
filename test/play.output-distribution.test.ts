import { describe, it, expect } from 'vitest';
import { initializePlayEngine } from '../src/play.js';

// This test executes a short composition and asserts that generated MIDI
// events are distributed across measures (not all stacked in the first
// measure), and that final CSV output contains events beyond the initial
// ticks (sanity for grandFinale ordering and tick integrity).

describe('Play output tick distribution', () => {
  it('should produce events beyond the first measure in buffers and CSV files', async () => {
    await initializePlayEngine();

    const { getCurrentCompositionContext } = await import('../src/play.js');
    const engineCtx = getCurrentCompositionContext();
    expect(engineCtx).toBeDefined();

    const primary = engineCtx.LM.layers.primary;
    const poly = engineCtx.LM.layers.poly;

    const pBuf = primary.buffer && primary.buffer.rows ? primary.buffer.rows : primary.buffer;
    const qBuf = poly.buffer && poly.buffer.rows ? poly.buffer.rows : poly.buffer;

    // Basic sanity
    expect(Array.isArray(pBuf)).toBe(true);
    expect(Array.isArray(qBuf)).toBe(true);
    expect(pBuf.length).toBeGreaterThan(0);

    // Determine a threshold: use the layer state's tpMeasure as representative measure length
    const tpMeasureP = primary.state.tpMeasure || engineCtx.state.tpMeasure || 1;

    // Ensure there are events occurring beyond the first measure
    const pBeyond = pBuf.filter((e: any) => Number.isFinite(e.tick) && e.tick > tpMeasureP);
    const qBeyond = qBuf.filter((e: any) => Number.isFinite(e.tick) && e.tick > tpMeasureP);

    // If no events beyond tpMeasure, that indicates stacking in earlier ticks
    expect(pBeyond.length, `primary has events beyond tpMeasure=${tpMeasureP}`).toBeGreaterThan(0);
    expect(qBeyond.length, `poly has events beyond tpMeasure=${tpMeasureP}`).toBeGreaterThan(0);

    // Sample up to a reasonable number of events to avoid extreme-length buffers skewing the check
    const fractionalThreshold = 1e-3; // allow small FP noise
    const sampleLimit = 20000;
    const sampleP = pBuf.slice(0, sampleLimit);
    const sampleQ = qBuf.slice(0, sampleLimit);
    const fractionalCountP = sampleP.filter((e: any) => Math.abs((e.tick || 0) - Math.round(e.tick || 0)) > fractionalThreshold).length;
    const fractionalCountQ = sampleQ.filter((e: any) => Math.abs((e.tick || 0) - Math.round(e.tick || 0)) > fractionalThreshold).length;


    // Allow up to 5% sampled fractional ticks as tolerated noise
    expect(fractionalCountP, 'primary fractional tick count is low (sampled)').toBeLessThan(Math.max(1, Math.floor(sampleP.length * 0.05)));
    expect(fractionalCountQ, 'poly fractional tick count is low (sampled)').toBeLessThan(Math.max(1, Math.floor(sampleQ.length * 0.05)));
    // Inspect the generated CSV output files to ensure they're not all stacked at start
    const fs = await import('fs');
    const outPrimary = 'output/output1.csv';
    const outPoly = 'output/output2.csv';

    expect(fs.existsSync(outPrimary)).toBe(true);
    expect(fs.existsSync(outPoly)).toBe(true);

    const primaryCsv = fs.readFileSync(outPrimary, 'utf8');
    const polyCsv = fs.readFileSync(outPoly, 'utf8');

    // Find the maximum tick value present in CSV for a basic sanity check
    const parseTicks = (txt: string) => txt.split('\n').map(line => {
      const parts = line.split(',');
      const t = Number(parts[1]);
      return Number.isFinite(t) ? t : null;
    }).filter(v => v !== null) as number[];

    const primaryTicks = parseTicks(primaryCsv);
    const polyTicks = parseTicks(polyCsv);

    const maxPrimaryTick = primaryTicks.length ? primaryTicks.reduce((a, b) => Math.max(a, b), -Infinity) : -Infinity;
    const maxPolyTick = polyTicks.length ? polyTicks.reduce((a, b) => Math.max(a, b), -Infinity) : -Infinity;

    expect(maxPrimaryTick, 'max tick in primary CSV').toBeGreaterThan(tpMeasureP);
    expect(maxPolyTick, 'max tick in poly CSV').toBeGreaterThan(tpMeasureP);
  }, 300000);
});
