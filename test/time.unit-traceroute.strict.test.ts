import { describe, it, expect } from 'vitest';
import { initializePlayEngine, getCurrentCompositionContext } from '../src/play.js';
import * as fs from 'fs';

// Strict traceroute: every unit (measure/beat/div/subdiv/subsub) must contain
// at least one NOTE ON with tick strictly inside (start, end) (with 1-tick buffer
// when duration allows).

describe('Strict unit traceroute', () => {
  it('ensures each timing unit contains a NOTE ON strictly inside its tick range', async () => {
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const ctx = getCurrentCompositionContext();
    expect(ctx, 'composition context available').toBeTruthy();

    const tree = ctx.state.timingTree;
    expect(tree, 'timing tree exists').toBeTruthy();

    const errors: string[] = [];

    const layerNames = Object.keys(tree);

    for (const layer of layerNames) {
      const layerNode = tree[layer];
      // Walk tree to collect unit nodes
      const nodes: Array<{ path: string; node: any }> = [];
      const walk = (n: any, parts: string[]) => {
        if (!n) return;
        if (n.start !== undefined && n.end !== undefined) {
          nodes.push({ path: parts.join('/'), node: n });
        }
        for (const k of Object.keys(n.children || {})) {
          walk(n.children[k], parts.concat(k));
        }
      };
      walk(layerNode, [layer]);

      const buf = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer) : [];

      for (const entry of nodes) {
        const n = entry.node;
        const start = Number(n.start ?? n.measureStart ?? n.divStart ?? 0);
        const end = Number(n.end ?? n.measureStart + (n.tpMeasure ?? 0) ?? 0);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

        const dur = end - start;
        const minInside = dur > 2 ? start + 1 : start + 0.0001; // 1 tick buffer when possible
        const maxInside = dur > 2 ? end - 1 : end - 0.0001;

        // Look for at least one NOTE ON in buffer inside the strict range
        const found = (buf || []).some((r: any) => r && (r.type === 'on' || r.type === 'note_on_c' || r.type === 'note_on') && Number.isFinite(r.tick) && r.tick >= minInside && r.tick <= maxInside);
        if (!found) {
          errors.push(`${layer} ${entry.path} ticks=${start}-${end} dur=${dur}`);
        }
      }
    }

    if (errors.length > 0) {
      // Dump CSV and some debugging info
      try {
        console.error('STRICT TRACEROUTE FAIL: Missing NOTE ON inside units (showing up to 20):');
        for (const e of errors.slice(0, 20)) console.error(e);
        const csv = fs.readFileSync('output/output1.csv', 'utf8');
        const lines = csv.split('\n').slice(0, 200).join('\n');
        console.error('Sample CSV (first 200 lines):\n' + lines);
      } catch (_e) {}
    }

    expect(errors.length, `units missing NOTE ON inside their ranges (showing up to 20):\n${errors.slice(0,20).join('\n')}`).toBe(0);
  }, 180000);
});
