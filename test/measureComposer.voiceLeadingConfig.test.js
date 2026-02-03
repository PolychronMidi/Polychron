require('../src/composers/MeasureComposer');

describe('MeasureComposer voice leading config API', () => {
  it('enableVoiceLeading accepts a config object and sets scorer defaults', () => {
    const mc = new MeasureComposer();
    mc.enableVoiceLeading({ commonToneWeight: 0.8, contraryMotionPreference: 0.6 });
    expect(mc.VoiceLeadingScore).toBeDefined();
    expect(mc.VoiceLeadingScore.commonToneWeight).toBe(0.8);
    expect(mc.VoiceLeadingScore.contraryMotionPreference).toBe(0.6);
  });

  it('setVoiceLeadingConfig updates existing scorer at runtime', () => {
    const mc = new MeasureComposer();
    mc.enableVoiceLeading({ commonToneWeight: 0.2 });
    mc.setVoiceLeadingConfig({ commonToneWeight: 1 });
    expect(mc.VoiceLeadingScore.commonToneWeight).toBe(1);
  });

  it('setVoiceLeadingConfig changes selection behavior (common tone chosen)', () => {
    const mc = new MeasureComposer();
    mc.setVoiceLeadingConfig({ commonToneWeight: 1 });
    mc.voiceHistory = [67];
    const chosen = mc.selectNoteWithLeading([60, 67, 72]);
    expect(chosen).toBe(67);
  });
});
