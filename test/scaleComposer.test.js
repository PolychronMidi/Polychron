require('../src/composers/ScaleComposer');
require('../src/composers/motifSpreader');

describe('ScaleComposer.selectNoteWithLeading', () => {
  it('prefers a common tone when VoiceLeadingScore configured', () => {
    const c = new ScaleComposer('major', 'C');
    require('../src/composers/VoiceLeadingScore');
    c.VoiceLeadingScore = new VoiceLeadingScore({});
    // simulate recent history
    c.voiceHistory = [67];
    const candidates = [60, 67, 72];
    const chosen = c.selectNoteWithLeading(candidates);
    expect(chosen).toBe(67);
  });

  it('influences MotifSpreader picks when used as measureComposer', () => {
    const layer = { beatMotifs: { 0: [{ note: 61 }, { note: 67 }, { note: 72 }] }, measureComposer: new ScaleComposer('major', 'C') };
    require('../src/composers/VoiceLeadingScore');
    layer.measureComposer.VoiceLeadingScore = new VoiceLeadingScore({});
    layer.measureComposer.voiceHistory = [67];
    const picks = MotifSpreader.getBeatMotifPicks(layer, 0, 1);
    expect(picks[0].note).toBe(67);
  });
});
