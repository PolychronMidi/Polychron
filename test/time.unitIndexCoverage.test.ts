import { initTimingTree, getTimingValues } from '../src/TimingTree';
import { setUnitTiming } from '../src/time';

test('setUnitTiming writes unitHash + sectionIndex for all granular unit types', () => {
  const ctx: any = { state: {} };
  ctx.state.sectionIndex = 1;
  ctx.state.phraseIndex = 0;
  ctx.state.measureIndex = 2;
  ctx.state.beatIndex = 1;
  ctx.state.divIndex = 0;
  ctx.state.subdivIndex = 0;
  ctx.state.subsubdivIndex = 0;
  initTimingTree(ctx);

  const types = ['phrase','measure','beat','division','subdivision','subsubdivision'];
  for (const t of types) {
    setUnitTiming(t, ctx);
  }

  // Inspect a few nodes
  const paths = [
    'primary/section/1/phrase/0',
    'primary/section/1/phrase/0/measure/2',
    'primary/section/1/phrase/0/measure/2/beat/1',
    'primary/section/1/phrase/0/measure/2/beat/1/division/0',
    'primary/section/1/phrase/0/measure/2/beat/1/division/0/subdivision/0',
    'primary/section/1/phrase/0/measure/2/beat/1/division/0/subdivision/0/subsubdivision/0'
  ];

  for (const p of paths) {
    const n = getTimingValues(ctx.state.timingTree, p);
    expect(n).toBeDefined();
    expect(n && n.unitHash).toBeTruthy();
    expect(n && Number.isFinite(Number(n.sectionIndex))).toBe(true);
  }
});
