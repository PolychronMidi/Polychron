// playDrums.js - Drum pattern generation based on beat rhythm, beat index, and phrase structure
const VPlayDrums2 = Validator.create('playDrums2');

playDrums2 = function playDrums2() {
  VPlayDrums2.assertObject(ConductorState, 'ConductorState');
  VPlayDrums2.requireType(ConductorState.getSnapshot, 'function', 'ConductorState.getSnapshot');
  VPlayDrums2.assertObject(DrumTextureCoupler, 'DrumTextureCoupler');
  VPlayDrums2.requireType(DrumTextureCoupler.shouldAccent, 'function', 'DrumTextureCoupler.shouldAccent');

  const conductorState = ConductorState.getSnapshot();
  VPlayDrums2.assertObject(conductorState, 'ConductorState.getSnapshot()');
  const intensityRaw = VPlayDrums2.requireFinite(conductorState.compositeIntensity, 'conductorState.compositeIntensity');
  const intensity = clamp(intensityRaw, 0, 1);
  const accent = DrumTextureCoupler.shouldAccent();
  VPlayDrums2.assertBoolean(accent, 'DrumTextureCoupler.shouldAccent()');
  const phrasePhase = VPlayDrums2.assertNonEmptyString(conductorState.phrasePhase, 'conductorState.phrasePhase');
  const drumCtx = { compositeIntensity: intensity, phrasePhase, accent };
  const stutterChance = clamp(0.16 + intensity * 0.42 + (accent ? 0.12 : 0), 0.08, 0.9);
  const stutterRange = intensity > 0.65 ? [3, 12] : [2, 8];
  const stutterDecay = clamp(0.85 + intensity * 0.25, 0.75, 1.2);

  if (beatIndex % 2===0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['kick2','kick5','kick7'],[0,.5,.25],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['kick1','kick3','kick7'],[0,.5,.25],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['snare2','kick6','snare3'],[0,.5,.75],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
  } else if (beatIndex % 2===0) {
    drummer(['snare7'],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['snare7'],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    }
  } else  {
    drummer('random',[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
  }
};
