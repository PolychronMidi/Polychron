import { initTimingTree, getTimingValues } from '../src/TimingTree';
import { setUnitTiming } from '../src/time';

test('setUnitTiming propagates section/phrase/measure indices for division/subdivision', () => {
  const ctx: any = { state: {} };
  // prepare state for section/phrase/measure/beat/div indices
  ctx.state.sectionIndex = 2;
  ctx.state.phraseIndex = 1;
  ctx.state.measureIndex = 5;
  ctx.state.beatIndex = 3;
  ctx.state.divIndex = 1;
  ctx.state.subdivIndex = 0;
  // init timing tree
  const tree = initTimingTree(ctx);
  // ensure layer exists
  (ctx.state.timingTree as any)['primary'] = {};
  // call setUnitTiming for division
  setUnitTiming('division', ctx as any);

  // build expected path
  const path = 'primary/section/2/phrase/1/measure/5/beat/3/division/1';
  const node = getTimingValues(ctx.state.timingTree, path);
  expect(node).toBeDefined();
  // should have unitHash and sectionIndex fields
  expect(node && node.unitHash).toBeTruthy();
  expect(node && Number.isFinite(Number(node.sectionIndex))).toBe(true);
  expect(Number(node.sectionIndex)).toBe(2);
  // check phrase/measure as well
  expect(Number(node.phraseIndex)).toBe(1);
  expect(Number(node.measureIndex)).toBe(5);
});
