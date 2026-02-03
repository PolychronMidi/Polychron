require('../src/composers/PentatonicComposer');
require('../src/composers/motifSpreader');

describe('PentatonicComposer.selectNoteWithLeading', () => {
  it('prefers last selected note via voiceLeading', () => {
    require('../src/composers/PentatonicComposer');
    const c = new PentatonicComposer('C','major');
    require('../src/composers/voiceLeading');
    c.voiceLeading = new VoiceLeadingScore({});
    c.voiceHistory = [67];
    const chosen = c.selectNoteWithLeading([60,67,72]);
    expect(chosen).toBe(67);
  });

  it('impacts MotifSpreader picks', () => {
    require('../src/composers/PentatonicComposer');
    const pc = new PentatonicComposer('C','major');
    const layer = { beatMotifs: { 0: [{ note: 61 }, { note: 67 }, { note: 72 }] }, measureComposer: pc };
    require('../src/composers/voiceLeading');
    layer.measureComposer.voiceLeading = new VoiceLeadingScore({});
    layer.measureComposer.voiceHistory = [67];
    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    expect(picks[0].note).toBe(67);
  });
});
