// voiceLeadingAnalyzeQuality.js - analysis helper for VoiceLeadingScore

voiceLeadingAnalyzeQuality = function voiceLeadingAnalyzeQuality(vls, noteSequence) {
  const V = validator.create('voiceLeadingAnalyzeQuality');
  V.assertObject(vls, 'vls');
  V.assertArray(noteSequence, 'noteSequence');
  if (noteSequence.length < 2) {
    return { smoothness: 0, avgRange: 0, leapRecoveries: 0 };
  }
  for (let i = 0; i < noteSequence.length; i++) {
    V.requireFinite(Number(noteSequence[i]), `noteSequence[${i}]`);
  }

  let totalCost = 0;
  let leapCount = 0;
  let recoveryCount = 0;

  for (let i = 1; i < noteSequence.length; i++) {
    const interval = m.abs(noteSequence[i] - noteSequence[i - 1]);
    const motionCost = vls.voiceLeadingAnalyzeQualityScoreVoiceMotion(interval, noteSequence[i - 1], noteSequence[i]);
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
