import { initTimingTree, buildPath, setTimingValues, getTimingValues } from '../src/TimingTree.js';
import { getMidiTiming, setUnitTiming } from '../src/time.js';
import { createTestContext } from './helpers.module.js';

describe('setUnitTiming overlap enforcement', () => {
  it('auto-fixes start when it would overlap previous sibling (default)', () => {
    const ctx = createTestContext();
    ctx.state.composer = { getMeter: () => [4, 4], getDivisions: () => 1, getSubdivisions: () => 1 } as any;
    ctx.state.numerator = 4; ctx.state.denominator = 4;
    getMidiTiming(ctx);

    const tree = initTimingTree(ctx);
    const layer = ctx.LM?.activeLayer || 'primary';

    // Create a previous measure that ends at tick 2000 (no tpMeasure present so setUnitTiming will fallback and compute an earlier start)
    const prevPath = buildPath(layer, 0, 0, 0);
    setTimingValues(tree, prevPath, { start: 0, end: 2000, unitHash: 'prev' });

    // Now request measure index 1 with small tpMeasure so naive calculation would place it before prev.end
    ctx.state.measureIndex = 1;
    ctx.state.phraseStart = 0;
    ctx.state.tpMeasure = 100; // naive start would be 100

    setUnitTiming('measure', ctx);

    const node = getTimingValues(tree, buildPath(layer, 0, 0, 1));
    expect(Number(node.start)).toBeGreaterThanOrEqual(2000);
  });

  it('throws when strict mode is enabled and overlap would occur', () => {
    const ctx = createTestContext();
    ctx.state.composer = { getMeter: () => [4, 4], getDivisions: () => 1, getSubdivisions: () => 1 } as any;
    ctx.state.numerator = 4; ctx.state.denominator = 4;
    getMidiTiming(ctx);

    const tree = initTimingTree(ctx);
    const layer = ctx.LM?.activeLayer || 'primary';
    const prevPath = buildPath(layer, 0, 0, 0);
    setTimingValues(tree, prevPath, { start: 0, end: 2000, unitHash: 'prev' });

    ctx.state.measureIndex = 1;
    ctx.state.phraseStart = 0;
    ctx.state.tpMeasure = 100;
    ctx.state._strictEnforceNoOverlap = true;
    console.warn('[TEST] strict flag set on ctx.state =', ctx.state._strictEnforceNoOverlap);
    console.warn('[TEST] activeLayer=', ctx.LM?.activeLayer);
    console.warn('[TEST] prevPath used for setup =', buildPath(ctx.LM?.activeLayer || 'primary', 0, 0, 0));

    let threw = false;
    try {
      setUnitTiming('measure', ctx);
    } catch (e) {
      console.warn('[TEST] strict mode setUnitTiming threw:', e && (e as Error).message);
      threw = true;
    }

    // Diagnostic: show node values when strict mode did not throw
    if (!threw) {
      const prev = getTimingValues(initTimingTree(ctx), buildPath(ctx.LM?.activeLayer || 'primary', 0, 0, 0));
      const got = getTimingValues(initTimingTree(ctx), buildPath(ctx.LM?.activeLayer || 'primary', 0, 0, 1));
      console.warn('[TEST DIAG] prev.end=', prev && prev.end, 'result.start=', got && got.start);
    }

    expect(threw).toBe(true);
  });
});
