const _cmrV = Validator.create('crossModulateRhythms');

/**
 * Calculates cross-modulation value based on rhythm state across all levels
 * @returns {void}
 */
crossModulateRhythms = () => {
  lastCrossMod=crossModulation; crossModulation=0;

  // Conductor-driven scaling: profile controls how wide crossMod swings
  const cmScale = (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getCrossModScaling === 'function')
    ? ConductorConfig.getCrossModScaling()
    : { rangeScale: 1, penaltyScale: 1, textureBoostScale: 1 };
  _cmrV.assertPlainObject(cmScale, 'cmScale');
  _cmrV.requireFinite(cmScale.rangeScale, 'cmScale.rangeScale');
  _cmrV.requireFinite(cmScale.penaltyScale, 'cmScale.penaltyScale');
  const rs = cmScale.rangeScale;
  // Self-regulation multiplicative bias from ConductorConfig
  const regBias = (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getRegulationCrossModBias === 'function')
    ? ConductorConfig.getRegulationCrossModBias()
    : 1;
  const s = rs * regBias; // combined scale factor

  crossModulation+=
  (beatRhythm[beatIndex] > 0 ? rf(1.5*s,3*s) : m.max(rf(.625*s,1.25*s),(1 / numerator) * beatsOff + (1 / numerator) * beatsOn)) +
  (divRhythm[divIndex] > 0 ? rf(s,2*s) : m.max(rf(.5*s,s),(1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn )) +
  (subdivRhythm[subdivIndex] > 0 ? rf(.5*s,s) : m.max(rf(.25*s,.5*s),(1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn)) +
  (subsubdivRhythm[subsubdivIndex] > 0 ? rf(.25*s,.5*s) : m.max(rf(.125*s,.25*s),(1 / subsubsPerSub) * subsubdivsOff + (1 / subsubsPerSub) * subsubdivsOn)) +
  (subsubdivsOn > ri(1,5)*cmScale.penaltyScale ? rf(-.3,-.5) : rf(.1)) + (subsubdivsOff < ri(3)*cmScale.penaltyScale ? rf(-.3,-.5) : rf(.1)) +
  (subdivsOn < ri(7,15)*cmScale.penaltyScale ? rf(.1,.3) : rf(-.1)) + (subdivsOff > ri()*cmScale.penaltyScale ? rf(.1,.3) : rf(-.1)) +
  (divsOn < ri(9,15)*cmScale.penaltyScale ? rf(.1,.3) : rf(-.1)) + (divsOff > ri(3,7)*cmScale.penaltyScale ? rf(.1,.3) : rf(-.1)) +
  (subdivsOn > ri(7,15)*cmScale.penaltyScale ? rf(-.3,-.5) : rf(.1)) + (subdivsOff < ri()*cmScale.penaltyScale ? rf(-.3,-.5) : rf(.1)) +
  (divsOn > ri(9,15)*cmScale.penaltyScale ? rf(-.2,-.4) : rf(.1)) + (divsOff < ri(3,7)*cmScale.penaltyScale ? rf(-.2,-.4) : rf(.1)) +
  (beatsOn > ri(3)*cmScale.penaltyScale ? rf(-.2,-.3) : rf(.1)) + (beatsOff < ri(3)*cmScale.penaltyScale ? rf(-.1,-.3) : rf(.1)) +
  (subdivsPerMinute > ri(400,600)*cmScale.penaltyScale ? rf(-.4,-.6) : rf(.1)) + (subdivsOn * rf(-.05,-.15)) +
  (beatRhythm[beatIndex]<1?rf(.4,.5)*s:0) + (divRhythm[divIndex]<1?rf(.3,.4)*s:0) + (subdivRhythm[subdivIndex]<1?rf(.2,.3)*s:0);

  // Texture feedback (#2): texture contrast events inflate crossMod →
  // wider DynamismEngine flicker → shifted TextureBlender probabilities →
  // self-modulating density wave that no single system controls
  if (typeof DrumTextureCoupler !== 'undefined' && DrumTextureCoupler && typeof DrumTextureCoupler.getIntensity === 'function') {
    const texIntensity = DrumTextureCoupler.getIntensity();
    if (Number.isFinite(texIntensity) && texIntensity > 0) {
      crossModulation += texIntensity * rf(0.3, 0.8) * cmScale.textureBoostScale;
    }
  }
}
