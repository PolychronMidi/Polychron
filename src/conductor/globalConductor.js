// globalConductor.js - Orchestrates system-wide coherence and dynamicism
// Readings from HarmonicContext and PhraseArcManager drive:
// - Motif density (via motifConfig overrides)
// - stutter intensity/rate (via StutterManager directives)
// - Play probabilities (returned to main loop)

// State for smoothing transitions (naked global for runtime state)
currentDensity = 0.5;

globalConductor = (() => {

  // Flicker modifier EMA state - smooths the amplitude envelope
  // while preserving the per-beat noise pattern.
  let globalConductorPrevFlickerMod = 1;
  const FLICKER_SMOOTHING = 0.30; // raised from 0.15 - doubles tracking responsiveness to widen effective output range

  // Density-flicker additive decorrelation: tracks rolling correlation
  // between density direction and flicker amplitude direction. When both
  // move together (high positive correlation), the additive densityFlicker
  // term is scaled down to break the structural coupling path.
  let globalConductorDfCorrEma = 0; // EMA of sign-agreement (range [-1, 1])
  const DF_CORR_ALPHA = 0.12;

  // Flicker variance floor: when registryFlickerMod has near-zero variance,
  // inject small independent noise to prevent statistical lock from inflating
  // coupling measurements. Uses Welford's online algorithm for rolling std.
  let globalConductorFVarN = 0;
  let globalConductorFVarMean = 1.0;
  let globalConductorFVarM2 = 0;
  const FLICKER_VARIANCE_FLOOR_STD = 0.015; // R35 E4: raised from 0.008 to trigger injection more often
  const FLICKER_VARIANCE_INJECT = 0.04;     // R35 E4: raised from 0.02 to break coupling monopoly

  /**
   * Update all dynamic systems based on current musical context.
   * Call once per beat (or measure) from main loop.
   * @returns {{ playProb: number, stutterProb: number }}
   */
  function update() {
    // Compute absolute time once for all recorder calls
    const absTime = Number(beatStartTime);

    // 1. gather context (all globals boot-validated - no typeof guards needed)
    const phraseCtx = FactoryManager.sharedPhraseArcManager.getPhraseContext();

    const harmonicTension = harmonicContext.getField('tension');

    const sectionPhase = harmonicContext.getField('sectionPhase');
    const excursion = harmonicContext.getField('excursion');
    const sectionProgress = clamp(timeStream.compoundProgress('section'), 0, 1);
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 0;
    const phaseEstablished = clamp((phaseShare - 0.045) / 0.04, 0, 1);
    const phaseRecoveryPressure = clamp((0.05 - phaseShare) / 0.05, 0, 1);
    const dynamics = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const couplingMatrix = dynamics && dynamics.couplingMatrix ? dynamics.couplingMatrix : null;
    const densityFlickerPressure = couplingMatrix && typeof couplingMatrix['density-flicker'] === 'number'
      ? clamp((m.abs(couplingMatrix['density-flicker']) - 0.74) / 0.18, 0, 1)
      : 0;
    const densityTrustPressure = couplingMatrix && typeof couplingMatrix['density-trust'] === 'number'
      ? clamp((m.abs(couplingMatrix['density-trust']) - 0.72) / 0.18, 0, 1)
      : 0;
    const flickerTrustPressure = couplingMatrix && typeof couplingMatrix['flicker-trust'] === 'number'
      ? clamp((m.abs(couplingMatrix['flicker-trust']) - 0.74) / 0.18, 0, 1)
      : 0;
    const hotspotContainmentPressure = clamp(
      densityFlickerPressure * 0.52 + densityTrustPressure * 0.32 + flickerTrustPressure * 0.26 + phaseRecoveryPressure * 0.18,
      0,
      1
    );
    const lateSectionSplit = clamp((sectionProgress - 0.55) / 0.45, 0, 1);
    const midSectionPocket = m.sin(clamp((sectionProgress - 0.18) / 0.64, 0, 1) * m.PI);
    const resolutionRelease = 1 - lateSectionSplit * (0.06 + phaseEstablished * 0.10);
    const endRelease = sectionPhase === 'resolution'
      ? 1 - clamp((sectionProgress - 0.64) / 0.36, 0, 1) * (0.28 + phaseEstablished * 0.18)
      : 1;
    const densityLateRelief = 1 - lateSectionSplit * 0.08;
    const midSectionCooloff = sectionPhase === 'resolution' ? 1 : 1 - midSectionPocket * 0.06;
    const tensionLateLift = (
      sectionPhase === 'resolution'
        ? resolutionRelease
        : (1 + lateSectionSplit * 0.08)
    ) * endRelease * midSectionCooloff;

    // 2. derive composite intensity (0-1)
    const phaseMult = conductorConfig.getPhaseMultiplier(sectionPhase);
    const arcIntensity = phraseCtx.dynamism * phaseMult;
    const excursionTension = m.min(excursion, 6) * 0.05;
    const tensionIntensity = harmonicTension + excursionTension;

    const harmonicRhythm = clamp(Number(harmonicRhythmTracker.getHarmonicRhythm()), 0, 1);
    const harmonicRhythmParams = conductorConfig.getHarmonicRhythmParams();
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.blendWeight), 0, 0.5);
    const intensityBlend = conductorConfig.getGlobalIntensityBlend();
    const baseCompositeIntensity = clamp(
      arcIntensity * intensityBlend.arc + tensionIntensity * intensityBlend.tension,
      0,
      1
    );
    const compositeIntensity = clamp(
      baseCompositeIntensity * (1 - harmonicRhythmWeight) + harmonicRhythm * harmonicRhythmWeight,
      0,
      1
    );

    // 3. Run all registered recorders (side-effect: update intelligence module state)
    conductorIntelligence.runRecorders({
      absTime,
      compositeIntensity,
      currentDensity,
      harmonicRhythm
    });

    // 4. Collect density bias from registry (attributed for signal decomposition)
    const densityAttr = conductorIntelligence.collectDensityBiasWithAttribution();
    const registryDensityBias = densityAttr.product;

    // Coherence + emission density corrections (boot-validated globals - direct calls)
    // layerCoherenceScorer.getDensityBias() now registered in the density registry
    // (attributed, dampened). Only emission correction remains extra-pipeline.
    const emissionRatio = clamp(Number(emissionFeedbackListener.getEmissionRatio()), 0, 2);
    const densityCorrection = clamp(1 + clamp(1 - emissionRatio, -1, 1) * 0.2, 0.8, 1.25);

    // Drive motif density
    const densityRecoverySupport = phaseRecoveryPressure * 0.04 * (1 - clamp(hotspotContainmentPressure * 0.75, 0, 0.75));
    const densityHotspotTrim = 1 - hotspotContainmentPressure * 0.08;
    const targetDensity = clamp(
      conductorConfig.getTargetDensity(compositeIntensity) * densityCorrection * registryDensityBias * densityLateRelief * densityHotspotTrim * (1 + densityRecoverySupport),
      0, 1
    );
    const smooth = conductorConfig.getDensitySmoothing();
    currentDensity = currentDensity * (1 - smooth) + targetDensity * smooth;

    // 5. Micro-hyper density flicker (attributed)
    const textureDensityBoost = clamp(Number(drumTextureCoupler.getIntensity()), 0, 1) * 0.5;
    const flickerAttr = conductorIntelligence.collectFlickerModifierWithAttribution();
    // EMA on flicker modifier: smooths the amplitude envelope to reduce
    // beat-to-beat reversals that inflate trajectory curvature, while
    // preserving the per-beat noise pattern (sine + random terms below).
    const rawFlickerMod = flickerAttr.product;
    const prevFlickerSnapshot = globalConductorPrevFlickerMod; // snapshot BEFORE update for direction calc
    const registryFlickerMod = globalConductorPrevFlickerMod * (1 - FLICKER_SMOOTHING) + rawFlickerMod * FLICKER_SMOOTHING;
    globalConductorPrevFlickerMod = registryFlickerMod;

    // Flicker variance floor: inject independent noise when rolling std is too low
    globalConductorFVarN++;
    const fDelta = registryFlickerMod - globalConductorFVarMean;
    globalConductorFVarMean += fDelta / globalConductorFVarN;
    globalConductorFVarM2 += fDelta * (registryFlickerMod - globalConductorFVarMean);
    const rollingFlickerStd = globalConductorFVarN > 4 ? m.sqrt(globalConductorFVarM2 / globalConductorFVarN) : 1;
    const flickerVarianceInject = rollingFlickerStd < FLICKER_VARIANCE_FLOOR_STD
      ? rf(-FLICKER_VARIANCE_INJECT, FLICKER_VARIANCE_INJECT)
      : 0;
    // Decoupling: flicker base blends compositeIntensity with harmonicRhythm
    // and a slow independent carrier. This reduces lockstep coupling between
    // density/tension and flicker while preserving macro energy following.
    const densitySeed = Number(beatStart);
    const flickerCarrier = 0.5 + 0.5 * m.sin(densitySeed * 0.0017 + harmonicRhythm * m.PI);
    const flickerBase = clamp(compositeIntensity * 0.35 + harmonicRhythm * 0.25 + flickerCarrier * 0.40, 0, 1.2);
    const flickerHotspotTrim = 1 - clamp(densityFlickerPressure * 0.16 + flickerTrustPressure * 0.12 + densityTrustPressure * 0.08, 0, 0.26);
    const flickerAmplitude = (flickerBase + textureDensityBoost) * registryFlickerMod * flickerHotspotTrim;

    // Density-flicker additive decorrelation: scale down the additive term
    // when density and flicker directions are persistently correlated.
    const densityDir = targetDensity - currentDensity;
    const flickerDir = registryFlickerMod - prevFlickerSnapshot; // use pre-update snapshot (fixes R4 bug: was always 0)
    const signAgreement = (densityDir > 0 && flickerDir > 0) || (densityDir < 0 && flickerDir < 0) ? 1 : -1;
    globalConductorDfCorrEma = globalConductorDfCorrEma * (1 - DF_CORR_ALPHA) + signAgreement * DF_CORR_ALPHA;
    const flickerShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.flicker === 'number'
      ? axisEnergy.shares.flicker
      : 0;
    const flickerAxisPressure = clamp((flickerShare - 0.16) / 0.10, 0, 1);
    const phaseSafeTrim = 1 - phaseEstablished * flickerAxisPressure * 0.18 - hotspotContainmentPressure * 0.12;
    // When correlation is positive (co-moving), attenuate the additive flicker;
    // when negative or zero, pass through fully. Range: [0.5, 1.0].
    const dfDecorrelScale = clamp((1.0 - m.max(0, globalConductorDfCorrEma) * 0.5) * phaseSafeTrim, 0.45, 1.0);

    const densityFlicker = (m.sin(densitySeed * 0.0041 + 1.7) * 0.08 * flickerAmplitude
                         + m.sin(densitySeed * 0.0089 - 2.3) * 0.05 * flickerAmplitude
                         + rf(-0.03, 0.03) * flickerAmplitude) * dfDecorrelScale
                         + flickerVarianceInject; // variance floor injection
    const densityBounds = conductorConfig.getDensityBounds();
    const flickeredDensity = clamp(currentDensity + densityFlicker, densityBounds.floor, densityBounds.ceiling);

    motifConfig.setUnitProfileOverride('div', { intervalDensity: flickeredDensity });
    motifConfig.setUnitProfileOverride('subdiv', { intervalDensity: flickeredDensity * 0.9 });
    motifConfig.setUnitProfileOverride('subsubdiv', { intervalDensity: flickeredDensity * 0.8 });

    // 6. Drive stutter behavior
    const stutterParams = conductorConfig.getStutterParams(compositeIntensity);
    StutterManager.setDefaultDirective({
      rate: stutterParams.rate,
      rateCurve: stutterParams.rateCurve,
      phase: {
        left: 0,
        right: 0.5 + 0.2 * compositeIntensity,
        center: 0
      },
      coherence: {
        enabled: true,
        mode: stutterParams.coherenceMode
      }
    });

    // 7. dynamismEngine probability calculation
    const resolved = dynamismEngine.resolve('beat');

    // 8. Collect tension bias from registry (attributed)
    // Temporal smoothing: density has EMA via getDensitySmoothing(),
    // but tension had none - contributing to the oscillating regime.
    // Small smoothing factor (0.25) reduces beat-to-beat reversals.
    const tensionAttr = conductorIntelligence.collectTensionBiasWithAttribution();
    const registryTensionBias = tensionAttr.product;
    const rawTension = clamp(
      (Number(resolved.composite) * 0.55 + Number(harmonicTension) * 0.45) * registryTensionBias * tensionLateLift,
      0, 1
    );
    const TENSION_SMOOTHING = 0.38;
    const prevTension = harmonicContext.getField('tension');
    const derivedTension = prevTension * (1 - TENSION_SMOOTHING) + rawTension * TENSION_SMOOTHING;
    harmonicContext.set({ tension: derivedTension });

    let playOut = resolved.playProb;
    let stutterOut = resolved.stutterProb;

    if (sectionPhase === 'climax') {
      const boost = conductorConfig.getClimaxBoost();
      playOut = clamp(resolved.playProb * boost.playScale, 0, 1);
      stutterOut = clamp(resolved.stutterProb * boost.stutterScale, 0, 1);
    }

    // 9. Collect state fields from registry + core pipeline fields + attribution
    const registryFields = conductorIntelligence.collectStateFields();
    conductorState.updateFromConductor(Object.assign(registryFields, {
      phraseCtx,
      sectionPhase,
      tension: derivedTension,
      excursion,
      harmonicRhythm,
      flicker: registryFlickerMod,
      flickerAmplitude,
      emissionRatio,
      compositeIntensity: resolved.composite,
      playProb: playOut,
      stutterProb: stutterOut,
      densityAttribution: densityAttr.contributions,
      tensionAttribution: tensionAttr.contributions,
      flickerAttribution: flickerAttr.contributions,
      // Extra-pipeline density multipliers - only emission correction remains
      // outside the registry. layerCoherenceScorer is now in-registry (attributed).
      extraDensityCorrection: densityCorrection,
      extraCoherenceDensityBias: 1.0
    }));

    return {
      playProb: playOut,
      stutterProb: stutterOut
    };
  }

  return { update };
})();
