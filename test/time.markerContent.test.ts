import { initTimingTree, getTimingValues } from '../src/TimingTree';
import { setUnitTiming } from '../src/time';

test('setUnitTiming emits compact unit marker with section/phrase/measure fields when buffer is present', () => {
  const ctx: any = { state: {} };
  ctx.state.sectionIndex = 3;
  ctx.state.phraseIndex = 1;
  ctx.state.measureIndex = 2;
  ctx.csvBuffer = [];
  initTimingTree(ctx);

  setUnitTiming('measure', ctx as any);

  // find the last marker_t with unitHash
  const markers = ctx.csvBuffer.filter((r: any) => r && r.type === 'marker_t' && Array.isArray(r.vals));
  expect(markers.length).toBeGreaterThan(0);
  const compact = markers.find((m: any) => m.vals.some((v: any) => String(v).startsWith('unitHash:')));
  expect(compact).toBeTruthy();
  const vals = compact.vals.map((v: any) => String(v));
  expect(vals.some(v => v.startsWith('section:'))).toBe(true);
  expect(vals.some(v => v.startsWith('phrase:'))).toBe(true);
  expect(vals.some(v => v.startsWith('measure:'))).toBe(true);
});
