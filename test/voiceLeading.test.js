// Unit tests for core voice leading selection logic
const { VoiceLeadingScore } = (() => {
  try { return require('../src/composers/VoiceLeadingScore'); } catch (e) { return { VoiceLeadingScore: typeof VoiceLeadingScore !== 'undefined' ? VoiceLeadingScore : null }; }
})();

describe('VoiceLeadingScore.selectNextNote candidates', () => {
  it('prefers same pitch-class when commonToneWeight is set', () => {
    const vl = new VoiceLeadingScore({ smoothMotion: 1 });
    const lastNotes = [67];
    const candidates = [60, 67, 72];
    const chosen = vl.selectNextNote(lastNotes, candidates, { commonToneWeight: 1 });
    expect(chosen).toBe(67);
  });

  it('picks a close-by note when no common tone', () => {
    const vl = new VoiceLeadingScore({ smoothMotion: 1 });
    const lastNotes = [64];
    const candidates = [55, 70, 80];
    const chosen = vl.selectNextNote(lastNotes, candidates, {});
    // 70 is closest to 64
    expect(chosen).toBe(70);
  });
});
