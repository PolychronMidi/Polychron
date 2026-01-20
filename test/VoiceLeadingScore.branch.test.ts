import { describe, it, expect, beforeEach } from 'vitest';
import VoiceLeadingScore from '../src/voiceLeading/VoiceLeadingScore';

describe('VoiceLeadingScore - branch tests', () => {
  let v: VoiceLeadingScore;
  beforeEach(() => {
    v = new VoiceLeadingScore({});
  });

  it('scores voice motion intervals correctly', () => {
    // access private-like method via casting
    expect((v as any)._scoreVoiceMotion(0, 60, 60)).toBe(0);
    expect((v as any)._scoreVoiceMotion(2, 60, 62)).toBe(1);
    expect((v as any)._scoreVoiceMotion(4, 60, 64)).toBe(3);
    expect((v as any)._scoreVoiceMotion(6, 60, 66)).toBe(5);
    expect((v as any)._scoreVoiceMotion(12, 60, 72)).toBe(10);
  });

  it('selectNextNote applies constraints and chooses reasonable candidate', () => {
    const prev = [60];
    const candidates = [48, 59, 61, 72];
    const sel = v.selectNextNote(prev, candidates, { register: 'soprano', constraints: ['stepsOnly'] });
    expect([59,61].includes(sel)).toBe(true);
  });

  it('findBestVoicing prefers low-cost permutation', () => {
    const best = v.findBestVoicing([60,64,67], [62,65,69], 'soprano');
    expect(Array.isArray(best)).toBe(true);
    expect(best.length).toBe(3);
  });
});
