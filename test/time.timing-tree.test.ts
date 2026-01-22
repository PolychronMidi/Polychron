import { initTimingTree, buildPath, getTimingValues } from '../src/TimingTree.js';
import { createTestContext, createMinimalTestComposer } from './helpers';
import { getMidiTiming, setUnitTiming } from '../src/time.js';

describe('TimingTree integration and setUnitTiming traceroute', () => {
  test('phrase timing is written to timing tree (tp/sp/measuresPerPhrase)', () => {
    const ctx = createTestContext();
    ctx.state.numerator = 4;
    ctx.state.denominator = 4;
    ctx.state.sectionIndex = 0;
    ctx.state.phraseIndex = 0;
    ctx.state.measureIndex = 0;
    ctx.state.composer = createMinimalTestComposer();

    getMidiTiming(ctx);

    // Calculate phrase timing
    setUnitTiming('phrase', ctx);

    const tree = initTimingTree(ctx);
    const path = buildPath('primary', 0, 0);
    const node = getTimingValues(tree, path);

    expect(node).toBeDefined();
    expect(node!.tpPhrase).toBe(ctx.state.tpPhrase);
    expect(node!.spPhrase).toBe(ctx.state.spPhrase);
    expect(node!.measuresPerPhrase).toBe(ctx.state.measuresPerPhrase);
  });

  test('measure start increments when measureIndex increments and timing tree + markers reflect change', () => {
    const ctx = createTestContext();
    ctx.state.numerator = 4;
    ctx.state.denominator = 4;
    ctx.state.sectionIndex = 0;
    ctx.state.phraseIndex = 0;
    ctx.state.measureIndex = 0;
    ctx.state.composer = createMinimalTestComposer();

    getMidiTiming(ctx);
    setUnitTiming('phrase', ctx);
    setUnitTiming('measure', ctx);

    const firstMeasureStart = ctx.state.measureStart;
    const firstMeasureStartTime = ctx.state.measureStartTime;

    // Enable logging for markers to be emitted
    ctx.LOG = 'all';

    // Advance measure index and recompute
    ctx.state.measureIndex = 1;
    setUnitTiming('measure', ctx);

    expect(ctx.state.measureIndex).toBe(1);
    expect(ctx.state.measureStart).toBeGreaterThan(firstMeasureStart);
    expect(ctx.state.measureStartTime).toBeGreaterThan(firstMeasureStartTime);

    const tree = initTimingTree(ctx);
    const path0 = buildPath('primary', 0, 0, 0);
    const node0 = getTimingValues(tree, path0);
    expect(node0).toBeDefined();
    expect(node0!.measureStart).toBe(firstMeasureStart);

    const path1 = buildPath('primary', 0, 0, 1);
    const node1 = getTimingValues(tree, path1);
    expect(node1).toBeDefined();
    expect(node1!.measureStart).toBe(ctx.state.measureStart);

    // Check that a marker was emitted into csv buffer
    const markers = ctx.csvBuffer.rows.filter((r: any) => r && r.type === 'marker_t');
    expect(markers.length).toBeGreaterThanOrEqual(1);
  });

  test('nested units (measure->beat->division->subdivision) create nodes and start times advance', () => {
    const ctx = createTestContext();
    ctx.state.numerator = 4;
    ctx.state.denominator = 4;
    ctx.state.sectionIndex = 0;
    ctx.state.phraseIndex = 0;
    ctx.state.measureIndex = 0;
    ctx.state.beatIndex = 0;
    ctx.state.divIndex = 0;
    ctx.state.subdivIndex = 0;
    ctx.state.composer = createMinimalTestComposer();

    getMidiTiming(ctx);
    setUnitTiming('phrase', ctx);
    setUnitTiming('measure', ctx);
    setUnitTiming('beat', ctx);
    setUnitTiming('division', ctx);
    setUnitTiming('subdivision', ctx);

    const tree = initTimingTree(ctx);
    const measurePath = buildPath('primary', 0, 0, 0);
    const beatPath = buildPath('primary', 0, 0, 0, 0);
    const divPath = buildPath('primary', 0, 0, 0, 0, 0);
    const subdivPath = buildPath('primary', 0, 0, 0, 0, 0, 0);

    expect(getTimingValues(tree, measurePath)).toBeDefined();
    expect(getTimingValues(tree, beatPath)).toBeDefined();
    expect(getTimingValues(tree, divPath)).toBeDefined();
    expect(getTimingValues(tree, subdivPath)).toBeDefined();

    const m = getTimingValues(tree, measurePath)!;
    const b = getTimingValues(tree, beatPath)!;
    const d = getTimingValues(tree, divPath)!;
    const s = getTimingValues(tree, subdivPath)!;

    expect(b.beatStart).toBeGreaterThanOrEqual(m.measureStart);
    expect(d.divStart).toBeGreaterThanOrEqual(b.beatStart);
    expect(s.subdivStart).toBeGreaterThanOrEqual(d.divStart);
  });
});
