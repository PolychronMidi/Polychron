// Unit tests for AdvancedVoiceLeadingComposer integration with MotifSpreader
require('../src/composers/AdvancedVoiceLeadingComposer');
require('../src/composers/motifSpreader');

describe('AdvancedVoiceLeadingComposer.selectNoteWithLeading', () => {
  it('prefers previous note when available', () => {
    const c = new AdvancedVoiceLeadingComposer('major','C',0.9);
    c.previousNotes = [{ note: 67 }];
    const candidates = [60, 67, 72];
    const chosen = c.selectNoteWithLeading(candidates);
    expect(chosen).toBe(67);
  });

  it('influences MotifSpreader picks when set as layer.measureComposer', () => {
    const layer = { beatMotifs: { 0: [{ note: 60 }, { note: 67 }, { note: 72 }] }, measureComposer: new AdvancedVoiceLeadingComposer('major','C',0.9) };
    layer.measureComposer.previousNotes = [{ note: 67 }];
    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    expect(picks[0].note).toBe(67);
  });
});
