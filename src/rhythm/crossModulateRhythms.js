const V = validator.create('crossModulateRhythms');
let contagionContribution = 0; // tracks rhythmic contagion port amplitude for feedbackRegistry

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
  const texIntensity = drumTextureCoupler.getIntensity();
  if (Number.isFinite(texIntensity) && texIntensity > 0) {
    crossModulation += texIntensity * rf(0.3, 0.8) * cmScale.textureBoostScale;
  }

  // R35 E5 -> R98 E1: Bell-curve cross-mod concentration at compositional midpoint.
  const sectionProg = clamp(timeStream.compoundProgress('section'), 0, 1);
  // R99 E5 -> R1 E1: Boundary floor reduced 0.15->0.08. The 0.15 floor
  const midpointFocus = m.max(0.08, m.exp(-m.pow((sectionProg - 0.5) * 2.5, 2)));
  crossModulation += midpointFocus * rf(0.2, 0.6) * rs;

  // Regime-responsive cross-modulation scaling.
  const profSnap = systemDynamicsProfiler.getSnapshot();
  if (profSnap && profSnap.regime) {
    if (profSnap.regime === 'coherent') {
      crossModulation *= 0.85;
    } else if (profSnap.regime === 'evolving') {
      // Evolving cross-mod 1.20->1.30. Evolving starved at 7.5%.
      crossModulation *= 1.30;
    } else if (profSnap.regime === 'exploring') {
      // Exploring rhythmic cross-mod boost. Exploring is 36% of
      crossModulation *= 1.15;
    }
    // regime exit forecast -- velocity trend predicts transitions 4 beats early.
    const exitVelocity = typeof profSnap.velocity === 'number' ? profSnap.velocity : 0;
    if (profSnap.regime === 'coherent' && exitVelocity > 0.02) {
      crossModulation *= 1.0 + clamp(exitVelocity * 4, 0, 0.25);
    } else if (profSnap.regime === 'exploring' && exitVelocity < -0.015) {
      crossModulation *= 1.0 - clamp(m.abs(exitVelocity) * 3, 0, 0.20);
    }
  }

  // Phase coupling awareness. When phase coupling coverage is sparse,
  if (profSnap && typeof profSnap.phaseCouplingCoverage === 'number') {
    const phaseCov = profSnap.phaseCouplingCoverage;
    if (phaseCov < 0.6) {
      // Graduated boost: 0% at coverage 0.6, up to 10% at coverage 0.0
      crossModulation *= 1.0 + clamp((0.6 - phaseCov) / 0.6, 0, 1) * 0.10;
    }
  }

  // Composition-progress rhythmic arc. Opening gets tighter
  const compositionProg = clamp(timeStream.compoundProgress('section'), 0, 1);
  const rhythmicArc = 0.92 + 0.18 * m.exp(-m.pow((compositionProg - 0.55) * 2.2, 2));
  crossModulation *= rhythmicArc;

  // R31 lab: harmonic-rhythm awareness. Fast chord changes = tighter crossMod,
  {
    const harmEntry = L0.getLast(L0_CHANNELS.harmonic, { layer: 'both' });
    if (harmEntry && Number.isFinite(harmEntry.timestamp)) {
      const timeSinceHarmonic = beatStartTime - harmEntry.timestamp;
      // Fast chords (< 1s since last) = tighten, slow (> 3s) = loosen
      const rawScale = clamp(timeSinceHarmonic / 2.0, 0.7, 1.4);
      // 20% chance to invert the relationship for organic unpredictability
      const inverted = rf(0, 1) < 0.20;
      const directed = inverted ? (2.1 - rawScale) : rawScale;
      const jittered = fuzzyClamp(directed, 0.7, 1.4, 0.12, 'both');
      crossModulation *= jittered;
    }
  }

  // Rhythmic contagion port (firewall port #9).
  {
    let portContribution = 0;
    const recentDownbeat = L0.getLast(L0_CHANNELS.emergentDownbeat, { layer: 'both' });
    if (recentDownbeat && Number.isFinite(recentDownbeat.timeInSeconds)) {
      const secSinceDownbeat = beatStartTime - recentDownbeat.timeInSeconds;
      const dbStrength = V.optionalFinite(recentDownbeat.strength, 0);
      if (secSinceDownbeat >= 0 && secSinceDownbeat < spBeat * 2 && dbStrength > 0.1) {
        // Phase within downbeat micro-breathing cycle (0=at downbeat, 1=2 beats later)
        const phase = clamp(secSinceDownbeat / (spBeat * 2), 0, 1);
        // Bell curve: spike at 0.15 (just after downbeat), dip at 0.7 (breathing room)
        const breathCurve = m.exp(-m.pow((phase - 0.15) * 4, 2)) - 0.3 * m.exp(-m.pow((phase - 0.7) * 5, 2));
        // Regime-scaled: exploring gets stronger dancing, coherent lighter
        const regimeScale = profSnap && profSnap.regime === 'exploring' ? 1.3
          : (profSnap && profSnap.regime === 'coherent' ? 0.6 : 1.0);
        const contrib = breathCurve * dbStrength * rf(0.3, 0.7) * regimeScale;
        crossModulation += contrib;
        portContribution += m.abs(contrib);
      }
    }
    const recentContagion = L0.getLast(L0_CHANNELS.stutterContagion, { layer: 'both' });
    if (recentContagion && Number.isFinite(recentContagion.timeInSeconds)) {
      const secSinceContagion = beatStartTime - recentContagion.timeInSeconds;
      const contagionIntensity = V.optionalFinite(recentContagion.intensity, 0);
      if (secSinceContagion >= 0 && secSinceContagion < spBeat * 3 && contagionIntensity > 0.1) {
        // Stutter contagion boosts rhythmic variance -- rhythms "dance" when
        // stutter patterns propagate between layers. Decays over 3 beats.
        const contagionDecay = 1 - clamp(secSinceContagion / (spBeat * 3), 0, 1);
        const regimeScale = profSnap && profSnap.regime === 'exploring' ? 1.4
          : (profSnap && profSnap.regime === 'coherent' ? 0.5 : 1.0);
        const contrib = contagionIntensity * contagionDecay * rf(0.2, 0.5) * regimeScale;
        crossModulation += contrib;
        portContribution += m.abs(contrib);
      }
    }
    contagionContribution = portContribution;
  }

  // Emergent rhythm grid modulation. When emergentRhythmEngine detects
  {
    const emergent = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    if (emergent && Number.isFinite(emergent.density) && emergent.density > 0.05) {
      const eDensity = V.optionalFinite(emergent.density, 0);
      const eComplexity = V.optionalFinite(emergent.complexity, 0.5);
      const eRegimeScale = profSnap && profSnap.regime === 'exploring' ? 1.3
        : (profSnap && profSnap.regime === 'coherent' ? 0.6 : 1.0);
      // complexity > 0.5: loosen crossMod (positive), < 0.5: tighten (negative)
      const emergentMod = (eComplexity - 0.5) * eDensity * eRegimeScale * rf(0.3, 0.6);
      crossModulation += emergentMod;
    }
  }

  // emergentMelody contour-rhythm coupling. Rising contour -> more cross-mod
  {
    const melody = L0.getLast(L0_CHANNELS.emergentMelody, { layer: 'both' });
    if (melody) {
      const mFreshness = V.optionalFinite(melody.intervalFreshness, 1);
      let melodicMod = 0;
      if (melody.contourShape === 'rising')    melodicMod += rf(0.05, 0.15);
      else if (melody.contourShape === 'falling') melodicMod -= rf(0.03, 0.10);
      if (melody.counterpoint === 'contrary')  melodicMod -= rf(0.04, 0.10);
      if (mFreshness < 0.45)                   melodicMod += rf(0.03, 0.08);
      crossModulation += melodicMod;
    }
  }

  // E19: HyperMeta crossModulation suppression. Multiplier on crossModulation
  const e19Regime = (() => {
    const sn = systemDynamicsProfiler.getSnapshot();
    return sn ? sn.regime : '';
  })();
  const e19Mult = /** @type {number} */ (hyperMetaManager.getRateMultiplier('e19CrossModScale'));
  if (e19Mult < 1.0 && e19Regime !== 'exploring') {
    const e19SuppressFraction = clamp((crossModulation - 4.0) / 4.0, 0, 1);
    const e19EffectiveMult = 1.0 - (1.0 - e19Mult) * e19SuppressFraction;
    crossModulation = clamp(crossModulation * e19EffectiveMult, 0, 8);
  }
}
// Feedback loop registration: rhythmic contagion port creates a cycle
// emergentDownbeat/stutterContagion -> crossMod -> rhythm -> new patterns
feedbackRegistry.registerLoop(
  'rhythmicContagionPort',
  'emergent_downbeat_stutter_contagion',
  'cross_modulation',
  () => clamp(contagionContribution / 0.5, 0, 1),
  () => contagionContribution > 0 ? 1 : 0
);
