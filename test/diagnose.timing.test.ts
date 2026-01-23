import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers.module.ts';
import { setUnitTiming } from '../src/time.js';
import { initTimingTree } from '../src/TimingTree.js';

describe('diagnose timing tree', () => {
  it('should show unit nodes after setUnitTiming', () => {
    const ctx = createTestContext();
    ctx.state.sectionIndex = 0; ctx.state.phraseIndex = 0;
    setUnitTiming('phrase', ctx);
    const tree = initTimingTree(ctx);
    // Print to help debugging in CI/logs and fail with context if missing
    if (!tree || !tree['primary']) throw new Error('timingTree.primary missing: ' + JSON.stringify(tree || {}, null, 2));
    const primary = tree['primary'];
    // Traverse to find any unitHash
    const found = (function walk(n: any) {
      if (!n || typeof n !== 'object') return null;
      if (n.unitHash) return n;
      if (n.children) {
        for (const k of Object.keys(n.children)) {
          const res = walk(n.children[k]);
          if (res) return res;
        }
      }
      for (const k of Object.keys(n)) {
        if (/^\d+$/.test(k)) {
          const res = walk(n[k]);
          if (res) return res;
        }
      }
      return null;
    })(primary);
    if (!found) throw new Error('No unitHash found in timingTree primary. ctx.state snapshot: ' + JSON.stringify({ tpPhrase: ctx.state.tpPhrase, tpMeasure: ctx.state.tpMeasure, phraseStart: ctx.state.phraseStart, sectionStart: ctx.state.sectionStart, sectionIndex: ctx.state.sectionIndex, phraseIndex: ctx.state.phraseIndex }, null, 2) + '\n timingTree: ' + JSON.stringify(tree, null, 2));
    expect(found).toBeDefined();
  });
});
