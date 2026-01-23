import { initTimingTree, getTimingValues } from '../src/TimingTree';
import { setUnitTiming } from '../src/time';

test('subdivision auto-fixes overlapping startTick to previous end', () => {
  const ctx: any = { state: {} };
  // Setup initial state for first subdivision
  ctx.state.sectionIndex = 0;
  ctx.state.phraseIndex = 0;
  ctx.state.measureIndex = 0;
  ctx.state.beatIndex = 0;
  ctx.state.divIndex = 0;
  ctx.state.subdivIndex = 0;
  ctx.state.subdivStart = 0;
  ctx.state.tpSubdiv = 100; // subdivision duration
  initTimingTree(ctx);

  // First subdivision: should record start 0 end 100
  setUnitTiming('subdivision', ctx as any);
  let path0 = 'primary/section/0/phrase/0/measure/0/beat/0/division/0/subdivision/0';
  let n0 = getTimingValues(ctx.state.timingTree, path0) as any;
  expect(n0).toBeDefined();
  expect(Number(n0.start)).toBe(0);
  expect(Number(n0.end)).toBe(100);
  console.error('DEBUG n0', n0);

  // Now second subdivision with overlapping start (50 < prev end 100)
  ctx.state.subdivIndex = 1;
  ctx.state.subdivStart = 50;
  ctx.state.tpSubdiv = 100;
  const prevPath = 'primary/section/0/phrase/0/measure/0/beat/0/division/0/subdivision/0';
  console.error('DEBUG prevNode before second call', getTimingValues(ctx.state.timingTree, prevPath));
  setUnitTiming('subdivision', ctx as any);

  let path1 = 'primary/section/0/phrase/0/measure/0/beat/0/division/0/subdivision/1';
  let n1 = getTimingValues(ctx.state.timingTree, path1) as any;
  console.error('DEBUG n1', n1);
  expect(n1).toBeDefined();
  // should be auto-fixed to start at prev end (100)
  expect(Number(n1.start)).toBe(100);
  expect(Number(n1.end)).toBe(200);
  // Deterministic-start mode: no post-write autofix marker should be present
  expect(n1.adjustedOverlapFix).toBeFalsy();
});

test('subdivision strict-mode throws on overlap', () => {
  const ctx: any = { state: {} };
  ctx.state.sectionIndex = 0;
  ctx.state.phraseIndex = 0;
  ctx.state.measureIndex = 0;
  ctx.state.beatIndex = 0;
  ctx.state.divIndex = 0;
  ctx.state.subdivIndex = 0;
  ctx.state.subdivStart = 0;
  ctx.state.tpSubdiv = 100;
  initTimingTree(ctx);

  setUnitTiming('subdivision', ctx as any);

  // strict mode enabled should throw on overlapping next
  ctx.state.subdivIndex = 1;
  ctx.state.subdivStart = 50;
  ctx.state.tpSubdiv = 100;
  // In strict mode, if manual starts are allowed we should throw on overlapping manual starts
  ctx.state._strictEnforceNoOverlap = true;
  ctx.state._allowManualStarts = true;

  expect(() => setUnitTiming('subdivision', ctx as any)).toThrow(/Overlapping unit/);
});
