require('../src/composers/MelodicDevelopmentComposer');
require('../src/composers/motifSpreader');

describe('MelodicDevelopmentComposer.selectNoteWithLeading', () => {
  it('prefers last selected note when available', () => {
    const c = new MelodicDevelopmentComposer('major','C',0.8);
    c._lastSelected = 67;
    const candidates = [60, 67, 72];
    const chosen = c.selectNoteWithLeading(candidates);
    expect(chosen).toBe(67);
  });

  it('influences MotifSpreader when used as layer.measureComposer', () => {
    const layer = { beatMotifs: { 0: [{ note: 61 }, { note: 67 }, { note: 72 }] }, measureComposer: new MelodicDevelopmentComposer('major','C',0.8) };
    layer.measureComposer._lastSelected = 67;
    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    expect(picks[0].note).toBe(67);
  });
});
