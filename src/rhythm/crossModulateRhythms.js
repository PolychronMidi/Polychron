const V = validator.create('crossModulateRhythms');

/**
 * Calculates cross-modulation value based on rhythm state across all levels
 * @returns {void}
 */
crossModulateRhythms = () => {
  lastCrossMod=crossModulation; crossModulation=0;

  // Conductor-driven scaling: profile controls how wide crossMod swings
  const cmScale = conductorConfig.getCrossModScaling();
  V.assertPlainObject(cmScale, 'cmScale');
  V.requireFinite(cmScale.rangeScale, 'cmScale.rangeScale');
  V.requireFinite(cmScale.penaltyScale, 'cmScale.penaltyScale');
  const rs = cmScale.rangeScale;
  // Self-regulation multiplicative bias from conductorConfig
  const regBias = conductorConfig.getRegulationCrossModBias();
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

  // Texture feedback (#2): texture contrast events inflate crossMod -
  // wider dynamismEngine flicker - shifted textureBlender probabilities -
  // self-modulating density wave that no single system controls
  const texIntensity = drumTextureCoupler.getIntensity();
  if (Number.isFinite(texIntensity) && texIntensity > 0) {
    crossModulation += texIntensity * rf(0.3, 0.8) * cmScale.textureBoostScale;
  }

  // R35 E5 -> R98 E1: Bell-curve cross-mod concentration at compositional midpoint.
  // Replaces monotonic ramp with bell curve peaking at midpoint, concentrating
  // rhythmic energy where tension arc should peak.
  const sectionProg = clamp(timeStream.compoundProgress('section'), 0, 1);
  // R99 E5 -> R1 E1: Boundary floor reduced 0.15->0.08. The 0.15 floor
  // diluted bell-curve contrast, regressing tension arc peak -17% (0.846->0.703).
  // 0.08 keeps light boundary energy without killing midpoint concentration.
  const midpointFocus = m.max(0.08, m.exp(-m.pow((sectionProg - 0.5) * 2.5, 2)));
  crossModulation += midpointFocus * rf(0.2, 0.6) * rs;

  // R68 E3: Regime-responsive cross-modulation scaling.
  // Coherent regimes get tighter rhythmic texture (less cross-mod variance).
  // Evolving regimes get wilder rhythmic interaction (more cross-mod).
  // This is the rhythm subsystem's first regime-aware behavior.
  const profSnap = systemDynamicsProfiler.getSnapshot();
  if (profSnap && profSnap.regime) {
    if (profSnap.regime === 'coherent') {
      crossModulation *= 0.85;
    } else if (profSnap.regime === 'evolving') {
      // R94 E5: Evolving cross-mod 1.20->1.30. Evolving starved at 7.5%.
      // Stronger rhythmic contrast during evolving passages makes them
      // more musically distinct, improving regime perceptibility.
      crossModulation *= 1.30;
    } else if (profSnap.regime === 'exploring') {
      // R89 E4: Exploring rhythmic cross-mod boost. Exploring is 36% of
      // beats but had no rhythmic regime response. Mild boost increases
      // polyrhythmic variety during exploratory passages.
      crossModulation *= 1.15;
    }
  }
}
