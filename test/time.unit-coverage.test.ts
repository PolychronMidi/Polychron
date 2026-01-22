import { describe, it, expect } from 'vitest';
import { initializePlayEngine } from '../src/play.js';

function walkTree(node: any, path: string[] = [], results: Array<{ path: string; node: any }>) {
  if (!node) return;
  const keys = Object.keys(node.children || {});
  if (keys.length === 0) {
    results.push({ path: path.join('/'), node });
  } else {
    for (const k of keys) {
      walkTree(node.children[k], path.concat(k), results);
      // also include intermediate nodes
      const partialPath = path.concat(k).join('/');
      results.push({ path: partialPath, node: node.children[k] });
    }
  }
}

describe('TimingTree unit coverage (measures → subsubdivisions)', () => {
  it('ensures timing units contain events down to subsubdivision level', async () => {
    // Use deterministic seed for reproducible runs
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const { getCurrentCompositionContext } = await import('../src/play.js');
    const ctx = getCurrentCompositionContext();

    const tree = ctx.state.timingTree;
    expect(tree, 'timingTree exists').toBeTruthy();

    const layerNames = Object.keys(tree);
    expect(layerNames.length, 'at least one layer in timing tree').toBeGreaterThan(0);

    const tolerances: Record<string, number> = {
      measure: 1.0, // require 100% coverage for measures
      beat: 0.95, // 95% for beats
      division: 0.95,
      subdivision: 0.95,
      subsubdivision: 0.9 // allow some empty tiniest subdivisions
    };

    const emptySamples: Array<{ layer: string; level: string; path: string; start?: number; end?: number }> = [];

    for (const layer of layerNames) {
      const layerNode = tree[layer];
      const rows = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer
        ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer)
        : [];

      const points: Array<{ path: string; node: any }> = [];
      walkTree(layerNode, [layer], points);

      const levelBuckets: Record<string, { total: number; covered: number }> = {};

      for (const p of points) {
        const path = p.path; // e.g., "primary/section/0/phrase/0/measure/1/beat/0"
        const node = p.node;

        // detect deepest named unit level in path
        const parts = path.split('/');
        const unitKinds = ['measure', 'beat', 'division', 'subdivision', 'subsubdivision'];
        const presentKinds = parts.filter((x) => unitKinds.includes(x));
        if (presentKinds.length === 0) continue;
        const level = presentKinds[presentKinds.length - 1];

        if (!levelBuckets[level]) levelBuckets[level] = { total: 0, covered: 0 };

        // only consider nodes with defined start/end
        const start = node.start;
        const end = node.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          // skip invalid timing nodes
          continue;
        }

        levelBuckets[level].total++;

        // count events inside this timing range for this layer
        const cnt = (rows || []).filter((r: any) => Number.isFinite(r && r.tick) && r.tick >= start && r.tick < end).length;

        if (cnt > 0) {
          levelBuckets[level].covered++;
        } else {
          emptySamples.push({ layer, level, path, start, end });
        }
      }

      // evaluate coverage ratios
      for (const [level, stat] of Object.entries(levelBuckets)) {
        const ratio = stat.total === 0 ? 1 : stat.covered / stat.total;
        const min = tolerances[level] ?? 0.9;
        expect(ratio >= min, `${layer}:${level} coverage ${stat.covered}/${stat.total} >= ${Math.round(min * 100)}%`).toBe(true);
      }
    }

    // If there are any empty samples, include a helpful message and diagnostic dump
    if (emptySamples.length > 0) {
      // show up to 50 samples for debugging
      const sampleMsg = emptySamples.slice(0, 50).map(s => `${s.layer}:${s.level} ${s.path} ticks=${s.start}-${s.end}`).join('\n');

      // Dump contextual diagnostics for the first few empty samples
      console.error('=== UNIT COVERAGE DEBUG DUMP ===');
      console.error(`Found ${emptySamples.length} empty timing units (showing up to 20):`);
      for (const s of emptySamples.slice(0, 20)) {
        const layerBuf = ctx.LM.layers[s.layer] && ctx.LM.layers[s.layer].buffer ? (ctx.LM.layers[s.layer].buffer.rows || ctx.LM.layers[s.layer].buffer) : [];
        const tick0Count = (layerBuf || []).filter((r: any) => Number.isFinite(r && r.tick) && r.tick === 0).length;
        const totalCount = (layerBuf || []).filter((r: any) => Number.isFinite(r && r.tick)).length;
        console.error(`Sample: ${s.layer} ${s.level} ${s.path} start=${s.start} end=${s.end} | eventsInLayer=${totalCount} tick0=${tick0Count}`);

        // Print first 10 rows for context
        console.error('First 10 rows of buffer (tick,type,vals[0]):');
        for (const r of (layerBuf || []).slice(0, 10)) {
          console.error(JSON.stringify({ tick: r.tick, type: r.type, val0: Array.isArray(r.vals) ? r.vals[0] : undefined }));
        }

        // Print some state values for the layer (timing keys)
        const stateKeys = ['tpMeasure', 'tpBeat', 'tpDiv', 'tpSubdiv', 'tpSubsubdiv', 'measureStart', 'beatStart', 'divStart', 'subdivStart'];
        const layerState = ctx.state;
        console.error('layer timing snapshot:');
        for (const k of stateKeys) {
          console.error(`  ${k} = ${Number.isFinite(layerState[k]) ? layerState[k] : String(layerState[k])}`);
        }
      }

      console.error('=== END UNIT COVERAGE DEBUG DUMP ===');

      // fail loudly so CI/tester sees we need to fix this
      expect(emptySamples.length, `Found empty timing units (showing up to 50):\n${sampleMsg}`).toBe(0);
    }
  }, 180000);
});
