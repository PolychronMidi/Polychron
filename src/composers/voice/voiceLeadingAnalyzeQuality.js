// voiceLeadingAnalyzeQuality.js - analysis helper for VoiceLeadingScore

voiceLeadingAnalyzeQuality = function voiceLeadingAnalyzeQuality(vls, noteSequence) {
  if (!vls || typeof vls !== 'object') throw new Error('voiceLeadingAnalyzeQuality: VoiceLeadingScore instance is required');
  if (!Array.isArray(noteSequence)) throw new Error('VoiceLeadingScore.analyzeQuality: expected an array of notes');
  if (noteSequence.length < 2) {
    return { smoothness: 0, avgRange: 0, leapRecoveries: 0 };
  }
  for (let i = 0; i < noteSequence.length; i++) {
    if (!Number.isFinite(Number(noteSequence[i]))) throw new Error(`VoiceLeadingScore.analyzeQuality: noteSequence[${i}] is not a finite number`);
  }

  let totalCost = 0;
  let leapCount = 0;
  let recoveryCount = 0;

  for (let i = 1; i < noteSequence.length; i++) {
    const interval = m.abs(noteSequence[i] - noteSequence[i - 1]);
    const motionCost = vls._scoreVoiceMotion(interval, noteSequence[i - 1], noteSequence[i]);
    totalCost += motionCost;

    if (interval > 2) leapCount++;
    if (i >= 2 && interval <= 2 && m.abs(noteSequence[i - 1] - noteSequence[i - 2]) > 2) {
      recoveryCount++;
    }
  }

  return {
    smoothness: totalCost / (noteSequence.length - 1),
    avgRange: noteSequence.reduce((a, b) => a + b, 0) / noteSequence.length,
    leapRecoveries: leapCount > 0 ? recoveryCount / leapCount : 1.0,
  };
};
