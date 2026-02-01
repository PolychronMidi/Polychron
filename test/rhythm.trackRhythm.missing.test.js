require('../src/rhythm/trackRhythm');

test('trackRhythm throws when rhythm and index missing', () => {
  // Ensure globals absent by temporarily setting them undefined
  const oldBeatRhythm = typeof beatRhythm !== 'undefined' ? beatRhythm : undefined;
  const oldBeatIndex = typeof beatIndex !== 'undefined' ? beatIndex : undefined;
  try { beatRhythm = undefined; beatIndex = undefined; } catch (e) { /* ignore */ }

  expect(() => trackRhythm('beat', {})).toThrow(/missing rhythm or index/);

  // restore
  try { if (typeof oldBeatRhythm !== 'undefined') beatRhythm = oldBeatRhythm; else beatRhythm = undefined; if (typeof oldBeatIndex !== 'undefined') beatIndex = oldBeatIndex; else beatIndex = undefined; } catch (e) { /* ignore */ }
});
