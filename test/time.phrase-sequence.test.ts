import { initTimingTree, buildPath, getTimingValues } from '../src/TimingTree.js';
import { createTestContext } from './helpers';
import { getMidiTiming, setUnitTiming } from '../src/time.js';

describe('TimingTree - phrase sequential starts', () => {
  test('phraseStart increments sequentially when phraseIndex increments', () => {
    const ctx = createTestContext();
    ctx.state.numerator = 4;
    ctx.state.denominator = 4;
    ctx.state.sectionIndex = 0;
    ctx.state.phraseIndex = 0;
    ctx.state.measureIndex = 0;
    ctx.state.composer = createTestContext().state.composer;

    getMidiTiming(ctx);

    // First phrase
    setUnitTiming('phrase', ctx);
    const firstStart = ctx.state.phraseStart;

    // Advance phrase index
    ctx.state.phraseIndex = 1;
    setUnitTiming('phrase', ctx);
    const secondStart = ctx.state.phraseStart;

    expect(secondStart).toBeGreaterThan(firstStart);

    const tree = initTimingTree(ctx);
    const path0 = buildPath('primary', 0, 0);
    const node0 = getTimingValues(tree, path0);
    expect(node0).toBeDefined();
    expect(node0!.tpPhrase).toBe(ctx.state.tpPhrase);

    const path1 = buildPath('primary', 0, 1);
    const node1 = getTimingValues(tree, path1);
    expect(node1).toBeDefined();
    expect(node1!.phraseStart).toBe(ctx.state.phraseStart);

    // Check sequential relation
    expect(node1!.phraseStart).toBe(node0!.phraseStart! + node0!.tpPhrase!);
  });
});
