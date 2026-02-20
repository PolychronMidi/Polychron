// playDrums.js - Drum pattern generation based on beat rhythm, beat index, and phrase structure
const V = Validator.create('playDrums');

playDrums = function playDrums() {
  V.assertObject(ConductorState, 'ConductorState');
  V.requireType(ConductorState.getSnapshot, 'function', 'ConductorState.getSnapshot');
  V.assertObject(DrumTextureCoupler, 'DrumTextureCoupler');
  V.requireType(DrumTextureCoupler.shouldAccent, 'function', 'DrumTextureCoupler.shouldAccent');
  const conductorState = ConductorState.getSnapshot();
  V.assertObject(conductorState, 'ConductorState.getSnapshot()');
  const intensityRaw = V.requireFinite(conductorState.compositeIntensity, 'conductorState.compositeIntensity');
  const intensity = clamp(intensityRaw, 0, 1);
  const accent = DrumTextureCoupler.shouldAccent();
  V.assertBoolean(accent, 'DrumTextureCoupler.shouldAccent()');
  const phrasePhase = V.assertNonEmptyString(conductorState.phrasePhase, 'conductorState.phrasePhase');
  const drumCtx = { compositeIntensity: intensity, phrasePhase, accent };
  const stutterChance = clamp(0.16 + intensity * 0.42 + (accent ? 0.12 : 0), 0.08, 0.9);
  const stutterRange = intensity > 0.65 ? [3, 12] : [2, 8];
  const stutterDecay = clamp(0.85 + intensity * 0.25, 0.75, 1.2);

  if (beatIndex % 2===0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['kick1','kick3'],[0,.5],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['kick2','kick5'],[0,.5],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    }
  } else if (beatRhythm[beatIndex] > 0  && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['snare1','kick4','kick7','snare4'],[0,.5,.75,.25],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
  } else if (beatIndex % 2===0) {
    drummer('random',[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['snare5'],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    }
  } else  {
    drummer(['snare6'],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
  }
};
