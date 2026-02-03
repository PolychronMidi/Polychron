// Tests for multi-voice selection helper
const { VoiceLeadingScore } = (() => {
  try { return require('../src/composers/VoiceLeadingScore'); } catch (e) { return { VoiceLeadingScore: typeof VoiceLeadingScore !== 'undefined' ? VoiceLeadingScore : null }; }
})();

describe('VoiceLeadingScore.selectForVoices', () => {
  it('prefers previous notes when available and avoids simple crossing', () => {
    const vl = new VoiceLeadingScore({});
    // soprano previous 67, alto previous 60
    const last = [[67], [60]];
    const candidates = [[60, 67, 72], [48, 60]];
    const chosen = vl.selectForVoices(last, candidates, { commonToneWeight: 1 });
    expect(chosen[0]).toBe(67);
    expect(chosen[1]).toBe(60);
    // ensure soprano >= alto to avoid crossing
    expect(chosen[0] >= chosen[1]).toBe(true);
  });

  it('selects close-by combinations when no common tones', () => {
    const vl = new VoiceLeadingScore({});
    const last = [[64], [50]];
    const candidates = [[55, 70, 80], [48, 52, 60]];
    const chosen = vl.selectForVoices(last, candidates, {});
    // soprano should be near 64 and alto near 50
    expect(Math.abs(chosen[0] - 64)).toBeLessThanOrEqual(Math.abs(70 - 64));
    expect(Math.abs(chosen[1] - 50)).toBeLessThanOrEqual(Math.abs(52 - 50));
  });
});
