require('../src/composers/HarmonicRhythmComposer');
require('../src/composers/motifSpreader');

describe('HarmonicRhythmComposer.selectNoteWithLeading', () => {
  it('delegates selection to VoiceLeadingScore if available', () => {
    const c = new HarmonicRhythmComposer(['I','IV','V','I'], 'C');
    require('../src/composers/VoiceLeadingScore');
    c.VoiceLeadingScore = new VoiceLeadingScore({});
    c.voiceHistory = [67];
    const chosen = c.selectNoteWithLeading([60,67,72]);
    expect(chosen).toBe(67);
  });
});
