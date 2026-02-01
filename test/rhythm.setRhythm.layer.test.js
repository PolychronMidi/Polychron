require('../src/rhythm/setRhythm');

test('setRhythm writes rhythm array into provided ctx', () => {
  const layerCtx = {};
  const res = setRhythm('subdiv', layerCtx);
  expect(Array.isArray(res)).toBe(true);
  expect(Array.isArray(layerCtx.subdivRhythm)).toBe(true);
});
