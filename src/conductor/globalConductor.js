// globalConductor.js - Orchestrates system-wide coherence and dynamicism
// Readings from HarmonicContext and PhraseArcManager drive:
// - Motif density (via motifConfig overrides)
// - stutter intensity/rate (via StutterManager directives)
// - Play probabilities (returned to main loop)

// State for smoothing transitions (naked global for runtime state)
currentDensity = 0.5;

globalConductor = (() => {
  const V = validator.create('globalConductor');

  // Flicker modifier EMA state - smooths the amplitude envelope
  // while preserving the per-beat noise pattern.
  let globalConductorPrevFlickerMod = 1;
  const FLICKER_SMOOTHING = 0.40; // 0.30->0.40. Faster tracking reduces EMA compression, wider beat-to-beat flicker variation

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
  const FLICKER_VARIANCE_FLOOR_STD = 0.015; // raised from 0.008 to trigger injection more often
  const FLICKER_VARIANCE_INJECT = 0.04;     // raised from 0.02 to break coupling monopoly

  // Running EMA of exploring regime share for tension arc sustain.
  let globalConductorExploringEma = 0.5;

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

    const safeCurrentDensity = clamp(V.optionalFinite(Number(currentDensity), 0.5), 0, 1);
    const harmonicTension = V.optionalFinite(Number(harmonicContext.getField('tension')), 0);

    const sectionPhase = harmonicContext.getField('sectionPhase');
    const excursion = harmonicContext.getField('excursion');
    const sectionProgress = clamp(timeStream.compoundProgress('section'), 0, 1);
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 0;
    const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
      ? axisEnergy.shares.trust
      : 0;
    const phaseEstablished = clamp((phaseShare - 0.06) / 0.05, 0, 1);
    const phaseRecoveryPressure = clamp((0.08 - phaseShare) / 0.08, 0, 1);
    const trustSharePressure = clamp((trustShare - 0.18) / 0.08, 0, 1);
    const dynamics = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const couplingPressures = /** @type {Record<string,number>} */ (safePreBoot.call(() => pipelineCouplingManager.getCouplingPressures(), {}) || {});
    const densityFlickerPressure = clamp(((couplingPressures['density-flicker'] || 0) - 0.74) / 0.18, 0, 1);
    const densityTrustPressure = clamp(((couplingPressures['density-trust'] || 0) - 0.72) / 0.18, 0, 1);
    const flickerTrustPressure = clamp(((couplingPressures['flicker-trust'] || 0) - 0.74) / 0.18, 0, 1);
    const hotspotContainmentPressure = clamp(
      densityFlickerPressure * 0.48 + densityTrustPressure * 0.34 + flickerTrustPressure * 0.28 + phaseRecoveryPressure * 0.24 + trustSharePressure * 0.22,
      0,
      1
    );
    const lateSectionSplit = clamp((sectionProgress - 0.55) / 0.45, 0, 1);
    const midSectionPocket = m.sin(clamp((sectionProgress - 0.18) / 0.64, 0, 1) * m.PI);
    const resolutionRelease = 1 - lateSectionSplit * (0.06 + phaseEstablished * 0.10);
    // Regime-aware resolution suppression. When exploring dominates,
    // the tension arc already decays due to diffuse exploring output. Applying
    // full endRelease on top creates the front-loaded collapse seen in R64.
    // Scale the endRelease suppression by (1 - exploringDominance) so it's
    // weaker when exploring is already doing the suppression work. This is a
    // structural feedback from the regime classifier, not a constant tweak.
    const currentRegime = dynamics && dynamics.regime ? dynamics.regime : '';
    globalConductorExploringEma = globalConductorExploringEma * 0.98 + (currentRegime === 'exploring' ? 1 : 0) * 0.02;
    const exploringDominance = clamp((globalConductorExploringEma - 0.50) / 0.25, 0, 0.6);
    const endRelease = sectionPhase === 'resolution'
      ? 1 - clamp((sectionProgress - 0.64) / 0.36, 0, 1) * (0.28 + phaseEstablished * 0.18) * (1 - exploringDominance)
      : 1;
    const densityLateRelief = 1 - lateSectionSplit * 0.08;
    const midSectionCooloff = sectionPhase === 'resolution' ? 1 : 1 - midSectionPocket * 0.06;
    const tensionLateLift = (
      sectionPhase === 'resolution'
        ? resolutionRelease
        : (1 + lateSectionSplit * 0.08)
    ) * endRelease * midSectionCooloff;

    // 2. derive composite intensity (0-1)
    const phaseMult = V.optionalFinite(Number(conductorConfig.getPhaseMultiplier(sectionPhase)), 1);
    const arcIntensity = V.optionalFinite(Number(phraseCtx.dynamism), 0.5) * phaseMult;
    const excursionTension = m.min(V.optionalFinite(Number(excursion), 0), 6) * 0.05;
    const tensionIntensity = harmonicTension + excursionTension;

    const harmonicRhythm = clamp(V.optionalFinite(Number(harmonicRhythmTracker.getHarmonicRhythm()), 0.5), 0, 1);
    const harmonicRhythmParams = conductorConfig.getHarmonicRhythmParams();
    const harmonicRhythmWeight = clamp(V.optionalFinite(Number(harmonicRhythmParams.blendWeight), 0), 0, 0.5);
    const intensityBlend = conductorConfig.getGlobalIntensityBlend();
    const baseCompositeIntensity = clamp(
      arcIntensity * V.optionalFinite(Number(intensityBlend.arc), 0.5) + tensionIntensity * V.optionalFinite(Number(intensityBlend.tension), 0.5),
      0,
      1
    );
    const DYNAMICS_SCALE = { pp: 0.6, p: 0.8, mf: 1.0, f: 1.15, ff: 1.3 };
    const dynamicsScale = DYNAMICS_SCALE[currentSectionDynamics] || 1.0;
    const compositeIntensity = clamp(
      baseCompositeIntensity * (1 - harmonicRhythmWeight) + harmonicRhythm * harmonicRhythmWeight,
      0,
      1
    );

    // 3. Run all registered recorders (side-effect: update intelligence module state)
    conductorIntelligence.runRecorders({
      absTime,
      compositeIntensity,
      currentDensity: safeCurrentDensity,
      harmonicRhythm,
      layer: (LM && LM.activeLayer) ? LM.activeLayer : 'L1'
    });

    // 4. Collect density bias from registry (attributed for signal decomposition)
    const densityAttr = conductorIntelligence.collectDensityBiasWithAttribution();
    const registryDensityBias = V.optionalFinite(Number(densityAttr.product), 1);

    // Coherence + emission density corrections (boot-validated globals - direct calls)
    // layerCoherenceScorer.getDensityBias() now registered in the density registry
    // (attributed, dampened). Only emission correction remains extra-pipeline.
    const emissionRatio = clamp(V.optionalFinite(Number(emissionFeedbackListener.getEmissionRatio()), 1), 0, 2);
    const densityCorrection = clamp(1 + clamp(1 - emissionRatio, -1, 1) * 0.2, 0.8, 1.25);

    // Drive motif density
    const densityRecoverySupport = phaseRecoveryPressure * 0.03 * (1 - clamp(hotspotContainmentPressure * 0.75, 0, 0.75));
    const densityHotspotTrim = 1 - hotspotContainmentPressure * 0.08;
    const phaseProtectionTrim = 1 - clamp(phaseRecoveryPressure * 0.10 + trustSharePressure * 0.11 + densityTrustPressure * 0.06 + flickerTrustPressure * 0.05, 0, 0.22);
    // Harmonic excursion-density coupling. When the harmonic
    // journey ventures to distant keys (high excursion), thin density to
    // create exposed, adventurous passages. Near home key, density stays
    // full. This couples harmonic motion to textural density, producing
    // structural musical variety between sections with different keys.
    // Range: [0.96, 1.0] -- gentle 4% thinning at max excursion (6).
    const excursionDensityScale = 1.0 - clamp(V.optionalFinite(Number(excursion), 0), 0, 6) / 6 * 0.04;
    // Harmonic excursion tension coupling. When the harmonic
    // journey ventures far from home (high excursion), boost tension to
    // create dramatic, distant-key passages. Near home key, tension
    // relaxes for resolution. Range: [1.0, 1.05] -- gentle 5% boost.
    const excursionTensionScale = 1.0 + clamp(V.optionalFinite(Number(excursion), 0), 0, 6) / 6 * 0.05;
    const targetDensity = clamp(
      V.optionalFinite(Number(conductorConfig.getTargetDensity(compositeIntensity)), safeCurrentDensity) * dynamicsScale * densityCorrection * registryDensityBias * densityLateRelief * densityHotspotTrim * phaseProtectionTrim * excursionDensityScale * (1 + densityRecoverySupport),
      0, 1
    );
    const baseSmooth = clamp(V.optionalFinite(Number(conductorConfig.getDensitySmoothing()), 0.2), 0, 1);
    // E9: Reduce density smoothing at phrase boundaries (boundary breathing).
    // E15: Continuous phrase-position sculpting of smoothing (within-phrase contour).
    // E17: Tighten smoothing at section openings for sharper density peak.
    // Combined: effective smoothing = base / (e9 * e15) * e17_tighten
    // E9: Reduce density smoothing at phrase boundaries (boundary breathing).
    // E15 was refuted -- continuous smoothing variation caused instability.
    const e9SmoothRelax = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e9DensitySmoothingRelax'), 1.0));
    const smooth = clamp(baseSmooth / e9SmoothRelax, 0.05, 1);
    currentDensity = clamp(safeCurrentDensity * (1 - smooth) + targetDensity * smooth, 0, 1);

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
    // Regime-dependent carrier frequency. The fixed carrier frequency
    // (0.0017) creates a persistent density-flicker correlation pattern
    // because both density and flicker follow the same harmonic+intensity
    // blend. By shifting the carrier frequency during exploring/evolving
    // regimes, the flicker oscillation phase diverges from the density
    // signal's rhythm, structurally reducing density-flicker coupling
    // during non-coherent passages.
    const densitySeed = Number(beatStartTime);
    // Replace frequency shift with phase offset to break
    // density-flicker correlation. Frequency shifts increased
    // carrier rate during exploring/evolving, which accidentally aligned
    // with density signal rhythm -> density-flicker monopoly (34/41).
    // Phase offset decorrelates without creating new frequency alignment.
    const carrierPhaseOffset = currentRegime === 'exploring' ? m.PI / 3
      : currentRegime === 'evolving' ? m.PI / 2
      : 0;
    // Tension-responsive flicker counter-phase. When
    // composite intensity is high (> 0.55), apply additional phase offset
    // to decorrelate tension and flicker. R86 used PI*0.4 which overshot
    // (pearsonR crashed to -0.4586, anti-correlation). Reduced to PI*0.15
    // to target near-zero decorrelation instead of counter-motion.
    const tensionFlickerCounterPhase = clamp((compositeIntensity - 0.55) / 0.25, 0, 1) * m.PI * 0.15;
    const flickerCarrier = 0.5 + 0.5 * m.sin(densitySeed * 0.0017 + harmonicRhythm * m.PI + carrierPhaseOffset + tensionFlickerCounterPhase);
    // FlickerBase compositeIntensity deweighting.
    // R87 used 0.28, creating density-flicker anti-correlation (-0.4225).
    // Fine-tuned to 0.30 to move toward neutral correlation while
    // preserving most of the exceedance reduction (71->4 in R87).
    const flickerBase = clamp(compositeIntensity * 0.30 + harmonicRhythm * 0.30 + flickerCarrier * 0.40, 0, 1.2);
    const flickerHotspotTrim = 1 - clamp(densityFlickerPressure * 0.16 + flickerTrustPressure * 0.20 + densityTrustPressure * 0.08 + trustSharePressure * 0.10 + phaseRecoveryPressure * 0.10, 0, 0.40);
    // E21: Flicker amplitude cap under exceedance. Suppresses peak flicker
    // amplitude when coupling is stressed, reducing density-flicker coupling
    // pressure without touching the smoothing pathway (which feeds variance floor).
    const e21AmpCap = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e21FlickerAmplitudeCap'), 1.0));
    const flickerAmplitude = (flickerBase + textureDensityBoost) * registryFlickerMod * flickerHotspotTrim * e21AmpCap;

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
    // E14: During E9 phrase-boundary breathing windows, further attenuate the
    // additive flicker to prevent flicker from tracking density swings and
    // creating tension-flicker coupling spikes (the hotspot pattern from R22-R23).
    const e9Active = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e9DensitySmoothingRelax'), 1.0));
    const e14FlickerDamp = e9Active > 1.05 ? clamp(1.0 - (e9Active - 1.0) * 0.4, 0.55, 1.0) : 1.0;
    const dfDecorrelScale = clamp((1.0 - m.max(0, globalConductorDfCorrEma) * 0.5) * phaseSafeTrim * e14FlickerDamp, 0.40, 1.0);

    const densityFlicker = (m.sin(densitySeed * 0.0041 + 1.7) * 0.08 * flickerAmplitude
                         + m.sin(densitySeed * 0.0089 - 2.3) * 0.05 * flickerAmplitude
                         + rf(-0.03, 0.03) * flickerAmplitude) * dfDecorrelScale
                         + flickerVarianceInject; // variance floor injection
    const densityBounds = conductorConfig.getDensityBounds();
    // E9: Widen density bounds at phrase boundaries for bigger swings.
    // E11: Override ceiling during sparse windows for forced breathing.
    const e9SwingBoost = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e9DensitySwingBoost'), 1.0));
    const e11CeilingOverride = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e11DensityCeilingOverride'), 1.0));
    const effectiveFloor = densityBounds.floor / e9SwingBoost;
    const effectiveCeiling = m.min(densityBounds.ceiling, densityBounds.ceiling * e11CeilingOverride);
    const flickeredDensity = clamp(currentDensity + densityFlicker, effectiveFloor, effectiveCeiling);

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
    // Tension arch enforcement. The tension arc lacks section-level
    // shaping -- it relies entirely on upstream signal products which can
    // flatten when exploring dominates or endRelease suppresses. This adds
    // a macro-progress-aware floor that ensures an ascending-then-descending
    // arch shape across the composition. The floor is gentle (max 0.10 boost)
    // and only activates when the raw tension would otherwise collapse.
    const macroProgress = clamp((sectionIndex + sectionProgress) / m.max(totalSections, 1), 0, 1);
    // Raised arch tail from (0.50 - 0.30*(p-0.5)) = 0.35 at p=1.0
    // to (0.50 - 0.20*(p-0.5)) = 0.40 at p=1.0. Also raised max boost from
    // 0.10 to 0.15. R67 showed S4 collapsing to 0.35 partly due to the
    // climaxProximityPredictor's receding pullback. The stronger arch floor
    // counteracts this by providing more headroom for late-section sustain.
    // Raised arch floor from 0.30 to 0.35 at macroProgress=0.
    // Shift peak from p=0.5 to p=0.6, creating a delayed climax
    // that reinforces S3 tension.
    // Moderated descending slope 0.35->0.25 so S2/S3 sustain
    // tension after the p=0.6 peak. R72 showed spike-then-decline shape
    // [0.52,0.69,0.39,0.33] -- steep descent killed S2/S3.
    // Moderate descent further 0.25->0.18. R77 showed S2/S3 dropping
    // Gentler descent slope 0.18->0.14. R80 tension arc was
    // [0.52, 0.67, 0.47, 0.44] -- S2/S3 drop too steeply, reducing late-
    // composition dramatic weight. At 0.14: same 0.64 peak at p=0.6, floor
    // 0.584 at p=1.0 (was 0.568). This sustains tension through S2/S3 while
    // still providing compositional resolution.
    // E10: Phrase-trough arch floor drop (disabled -- see journal R21).
    const e10ArchDrop = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier("e10ArchFloorDrop"), 0));
    // E12: Section-level tension floor relaxation during resolution phase.
    // EMA-ramped to avoid coupling discontinuities. Range 0-0.15.
    const e12FloorDrop = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier("e12TensionFloorDrop"), 0));
    const tensionArchTarget = (macroProgress < 0.6
      ? 0.40 + macroProgress * 0.40
      : 0.64 - (macroProgress - 0.6) * 0.14) - e10ArchDrop - e12FloorDrop;
    // Density-tension decorrelation. pearsonR surged to 0.6742
    // in R87 because both density and tension share compositeIntensity
    // as a common driver. Shift tension toward harmonicTension (key/modal
    // contributions) from 0.45->0.55, reducing resolved.composite weight
    // from 0.55->0.45. This makes tension more harmonically driven,
    // decorrelating it from density's intensity-driven behavior.
    const rawTensionBase = (Number(resolved.composite) * 0.45 + Number(harmonicTension) * 0.55) * registryTensionBias * tensionLateLift * excursionTensionScale;
    // Section-boundary tension breathing. Brief 5% dip in the first
    // 5% of each section (after S0) creates audible section articulation
    // at the tension level, complementing density relief from sectionIntentCurves.
    const sectionBoundaryTensionDip = sectionIndex > 0 && sectionProgress < 0.05
      ? 1.0 - (1.0 - sectionProgress / 0.05) * 0.05
      : 1.0;
    // Raised max boost 0.15->0.20. The arch floor shape is
    // correct but the boost ceiling limits actual lift especially
    // during the mid-composition peak where tensionArchTarget=0.59.
    const tensionArchBoost = rawTensionBase * sectionBoundaryTensionDip < tensionArchTarget
      ? clamp((tensionArchTarget - rawTensionBase * sectionBoundaryTensionDip) * 0.5, 0, 0.20)
      : 0;
    // Regime-responsive tension warmth. Evolving regime gets a gentle
    // tension floor lift (+0.04) to differentiate it sonically from exploring.
    // Coherent stays neutral. This adds musical character differentiation at
    // the tension signal level rather than just stutter/density.
    // Exploring gets negative tension warmth (-0.02) for wider
    // dramatic range. This creates 0.06 total contrast between evolving
    // (+0.04) and exploring (-0.02), making regime transitions audible
    // at the tension signal level. Tension axis share is 0.133 (below fair
    // share 0.167) -- wider signal range produces more coupling activity.
    const regimeTensionWarmth = currentRegime === 'evolving' ? 0.04
      : currentRegime === 'coherent' ? 0.02
      : currentRegime === 'exploring' ? -0.02
      : 0;
    // E16: Tension micro-release at rest/sparse events. When E11 sparse
    // windows are active (phrase-boundary breathing), briefly dip tension.
    // This creates psychoacoustic "breathing" -- not just silence but actual
    // tension release. Small dip (max 0.05) to avoid coupling discontinuities.
    const e11Sparse = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier("e11SparseWindow"), 0));
    const e11CeilOvr = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e11DensityCeilingOverride'), 1.0));
    // Only dip tension when ceiling is actually suppressed (not during exploring, where override=1.0)
    const e16TensionDip = e11Sparse > 0 && e11CeilOvr < 0.95
      ? clamp((1.0 - e11CeilOvr) * 0.08, 0, 0.03)
      : 0;
    const rawTension = clamp(rawTensionBase * sectionBoundaryTensionDip + tensionArchBoost + regimeTensionWarmth - e16TensionDip, 0, 1);
    // Reduced smoothing 0.38->0.30 for faster tension response.
    // R74 showed S1 peaking at 0.783 but smoothing delays arch shape
    // propagation, blurring section-boundary tension transitions.
    // Reduced smoothing 0.38->0.30 for faster tension response.
    const TENSION_SMOOTHING = 0.30;
    const prevTension = harmonicContext.getField('tension');
    const derivedTension = prevTension * (1 - TENSION_SMOOTHING) + rawTension * TENSION_SMOOTHING;
    harmonicContext.set({ tension: derivedTension });

    let playOut = resolved.playProb;
    let stutterOut = resolved.stutterProb;

    // Regime-responsive stutter shaping. During coherent regime,
    // reduce stutter for cleaner rhythmic structure. During exploring,
    // boost stutter for more chaotic textural variety. This creates audible
    // regime contrast without touching constants -- the regime classifier's
    // output drives the behavior structurally.
    // Added evolving regime -- boost stutter 1.15x for percussive
    // rhythmic interest during transitional passages, further differentiating
    // the three active regimes sonically.
    if (currentRegime === 'coherent') {
      stutterOut = clamp(stutterOut * 0.88, 0, 1);
    } else if (currentRegime === 'exploring') {
      stutterOut = clamp(stutterOut * 1.08, 0, 1);
    } else if (currentRegime === 'evolving') {
      stutterOut = clamp(stutterOut * 1.15, 0, 1);
    }

    // Regime-responsive play probability. Play probability was the
    // same across regimes, so note emission density was uniform. Exploring
    // gets a small boost (more notes in sparse-density passages = contrast);
    // evolving gets a small reduction (selective, intentional emission during
    // transitions). This feeds back into densityVariance through per-regime
    // note count differentiation.
    // Exploring boost 1.06->1.10. L1 notes -36% vs original baseline.
    // With exploring at 31% of beats, a stronger boost targets the highest-
    // density-deficit regime. Combined with density mean recovery (0.545),
    // this helps close the note output gap.
    if (currentRegime === 'exploring') {
      playOut = clamp(playOut * 1.10, 0, 1);
    } else if (currentRegime === 'evolving') {
      playOut = clamp(playOut * 0.92, 0, 1);
    }

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
