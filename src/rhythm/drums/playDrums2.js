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

  // L2 offsets slot indices by 1 vs L1 so the two layers pick different drums per phrase.
  const k = [drumKitRotator.pickKick(1), drumKitRotator.pickKick(2), drumKitRotator.pickKick(3)];
  const s = [drumKitRotator.pickSnare(1), drumKitRotator.pickSnare(2), drumKitRotator.pickSnare(3)];
  const cym = drumKitRotator.pickCymbal(1);
  const cga = drumKitRotator.pickConga(1);

  if (beatIndex % 2===0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer([k[0],k[1],k[2]],[0,.5,.25],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer([drumKitRotator.pickKick(4),drumKitRotator.pickKick(5),k[2]],[0,.5,.25],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    }
    if (beatIndex===0 && rf() < .35*bpmRatio3) {
      drummer([cym],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer([s[0],k[0],s[1]],[0,.5,.75],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
  } else if (beatIndex % 2===0) {
    drummer([cga],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer([s[2]],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
    }
  } else  {
    drummer([drumKitRotator.pickSnare(6)],[0],rf(.08,.16),stutterChance,stutterRange,stutterDecay,drumCtx);
  }
};
