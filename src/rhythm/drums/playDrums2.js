// playDrums.js - Drum pattern generation based on beat rhythm, beat index, and phrase structure
const V = validator.create('playDrums2');

playDrums2 = function playDrums2() {
  V.assertObject(conductorState, 'conductorState');
  V.requireType(conductorState.getSnapshot, 'function', 'conductorState.getSnapshot');
  V.assertObject(drumTextureCoupler, 'drumTextureCoupler');
  V.requireType(drumTextureCoupler.shouldAccent, 'function', 'drumTextureCoupler.shouldAccent');

  const csSnap = conductorState.getSnapshot();
  V.assertObject(csSnap, 'conductorState.getSnapshot()');
  const intensityRaw = V.requireFinite(csSnap.compositeIntensity, 'conductorState.compositeIntensity');
  const intensity = clamp(intensityRaw, 0, 1);
  const accent = drumTextureCoupler.shouldAccent();
  V.assertBoolean(accent, 'drumTextureCoupler.shouldAccent()');
  const phrasePhase = V.assertNonEmptyString(csSnap.phrasePhase, 'conductorState.phrasePhase');
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
