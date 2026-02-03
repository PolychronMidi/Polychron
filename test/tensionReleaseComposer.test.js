require('../src/composers/TensionReleaseComposer');
require('../src/composers/motifSpreader');

describe('TensionReleaseComposer.selectNoteWithLeading', () => {
  it('delegates to voiceLeading when available', () => {
    const c = new TensionReleaseComposer('C','major',0.5);
    require('../src/composers/voiceLeading');
    c.voiceLeading = new VoiceLeadingScore({});
    c.voiceHistory = [67];
    const chosen = c.selectNoteWithLeading([60,67,72]);
    expect(chosen).toBe(67);
  });

  it('influences MotifSpreader when used as measureComposer', () => {
    const c = new TensionReleaseComposer('C','major',0.5);
    const layer = { beatMotifs: { 0: [{ note: 61 }, { note: 67 }, { note: 72 }] }, measureComposer: c };
    require('../src/composers/voiceLeading');
    layer.measureComposer.voiceLeading = new VoiceLeadingScore({});
    layer.measureComposer.voiceHistory = [67];
    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    expect(picks[0].note).toBe(67);
  });
});
