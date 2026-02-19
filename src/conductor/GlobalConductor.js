// GlobalConductor.js - Orchestrates system-wide coherence and dynamicism
// Readings from HarmonincContext and PhraseArcManager drive:
// - Motif density (via motifConfig overrides)
// - Stutter intensity/rate (via StutterManager directives)
// - Play probabilities (returned to main loop)

GlobalConductor = (() => {
  // State for smoothing transitions
  let currentDensity = 0.5;

  /**
   * Update all dynamic systems based on current musical context.
   * Call once per beat (or measure) from main loop.
   * @returns {{ playProb: number, stutterProb: number }}
   */
  function update() {
    // 1. gather context
    const phraseCtx = (typeof ComposerFactory !== 'undefined' && ComposerFactory.sharedPhraseArcManager)
      ? ComposerFactory.sharedPhraseArcManager.getPhraseContext()
      : { dynamism: 0.7, position: 0.5, atStart: false, atEnd: false };

    // Safety check for HarmonicContext
    const harmonicTension = (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
      ? (HarmonicContext.getField('tension') || 0)
      : 0;

    // READ NEW CONTEXT: Structural Phase & Excursion
    // These drive macro-dynamics (long-term arcs) vs phraseCtx (mid-term)
    const sectionPhase = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('sectionPhase'))
      || 'development';
    const excursion = (typeof HarmonicContext !== 'undefined' && HarmonicContext.getField && HarmonicContext.getField('excursion'))
      || 0;

    // 2. derive composite intensity (0-1)
    // Intensity rises with phrase position, harmonic tension, and structural drama

    // Calculate Phase Multiplier (Macro-dynamics) — profile-driven
    const phaseMult = ConductorConfig.getPhaseMultiplier(sectionPhase);

    // Apply multiplier to the raw arc dynamism from PhraseArcManager
    const arcIntensity = phraseCtx.dynamism * phaseMult;

    // Calculate Excursion Tension (0-6 semitones -> 0-0.3)
    // Further from home = more unstable/intense
    const excursionTension = Math.min(excursion, 6) * 0.05;

    const tensionIntensity = harmonicTension + excursionTension;
    const harmonicRhythm = (typeof HarmonicRhythmTracker !== 'undefined' && HarmonicRhythmTracker && typeof HarmonicRhythmTracker.getHarmonicRhythm === 'function')
      ? clamp(Number(HarmonicRhythmTracker.getHarmonicRhythm()), 0, 1)
      : 0;
    const harmonicRhythmParams = (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getHarmonicRhythmParams === 'function')
      ? ConductorConfig.getHarmonicRhythmParams()
      : { blendWeight: 0.15, feedbackWeight: 0.2 };
    const harmonicRhythmWeight = clamp(Number(harmonicRhythmParams.blendWeight), 0, 0.5);
    const intensityBlend = (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getGlobalIntensityBlend === 'function')
      ? ConductorConfig.getGlobalIntensityBlend()
      : { arc: 0.6, tension: 0.4 };
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

    // Update cross-layer analysis modules (melodic contour, coherence, energy tracking)
    if (typeof MelodicContourTracker !== 'undefined' && MelodicContourTracker && typeof MelodicContourTracker.update === 'function') {
      MelodicContourTracker.update();
    }
    if (typeof LayerCoherenceScorer !== 'undefined' && LayerCoherenceScorer && typeof LayerCoherenceScorer.computeCoherence === 'function') {
      LayerCoherenceScorer.computeCoherence();
    }
    if (typeof SectionLengthAdvisor !== 'undefined' && SectionLengthAdvisor && typeof SectionLengthAdvisor.recordEnergy === 'function') {
      SectionLengthAdvisor.recordEnergy(compositeIntensity);
    }

    // Update Batch 4 intelligence modules
    // DynamicRangeAdvisor & IntervalTensionProfiler are pure-query (no update needed)
    // OnsetDensityProfiler provides ground-truth density correction
    const onsetDensityBias = (typeof OnsetDensityProfiler !== 'undefined' && OnsetDensityProfiler && typeof OnsetDensityProfiler.getDensityBias === 'function')
      ? clamp(OnsetDensityProfiler.getDensityBias(), 0.6, 1.4)
      : 1;
    const onsetCrossModBias = (typeof OnsetDensityProfiler !== 'undefined' && OnsetDensityProfiler && typeof OnsetDensityProfiler.getCrossModBias === 'function')
      ? clamp(OnsetDensityProfiler.getCrossModBias(), 0.8, 1.2)
      : 1;
    // RestDensityTracker biases onset probability
    const restOnsetBias = (typeof RestDensityTracker !== 'undefined' && RestDensityTracker && typeof RestDensityTracker.getOnsetBias === 'function')
      ? clamp(RestDensityTracker.getOnsetBias(), 0.7, 1.3)
      : 1;
    // PitchGravityCenter tracks tonal drift (informational — consumed by composers)
    // HarmonicVelocityMonitor checks harmonic pacing vs energy
    const harmonicChangeBias = (typeof HarmonicVelocityMonitor !== 'undefined' && HarmonicVelocityMonitor && typeof HarmonicVelocityMonitor.getChangeThresholdBias === 'function')
      ? clamp(HarmonicVelocityMonitor.getChangeThresholdBias(), 0.7, 1.4)
      : 1;
    // DynamicRangeAdvisor velocity spread bias
    const velocitySpreadBias = (typeof DynamicRangeAdvisor !== 'undefined' && DynamicRangeAdvisor && typeof DynamicRangeAdvisor.getSpreadBias === 'function')
      ? clamp(DynamicRangeAdvisor.getSpreadBias(), 0.8, 1.3)
      : 1;

    // --- Batch 5 intelligence module reads ---
    // SyncopationDensityTracker: rhythm weight biases
    const syncopationBias = (typeof SyncopationDensityTracker !== 'undefined' && SyncopationDensityTracker && typeof SyncopationDensityTracker.getRhythmBias === 'function')
      ? SyncopationDensityTracker.getRhythmBias()
      : { syncopationBias: 1, straightBias: 1 };
    // GrooveTemplateAdvisor: velocity humanization bias
    const grooveVelBias = (typeof GrooveTemplateAdvisor !== 'undefined' && GrooveTemplateAdvisor && typeof GrooveTemplateAdvisor.getVelocityHumanizeBias === 'function')
      ? clamp(GrooveTemplateAdvisor.getVelocityHumanizeBias(), 0.8, 1.3)
      : 1;
    // VoiceDensityBalancer: voice count bias for motifConfig
    const voiceCountBias = (typeof VoiceDensityBalancer !== 'undefined' && VoiceDensityBalancer && typeof VoiceDensityBalancer.getVoiceCountBias === 'function')
      ? clamp(VoiceDensityBalancer.getVoiceCountBias(), 0.7, 1.4)
      : 1;
    // AccentPatternTracker: accent velocity biases
    const accentBias = (typeof AccentPatternTracker !== 'undefined' && AccentPatternTracker && typeof AccentPatternTracker.getAccentBias === 'function')
      ? AccentPatternTracker.getAccentBias()
      : { downbeatBias: 1, offbeatBias: 1 };
    // ModalColorTracker: pitch color vs stability biases
    const modalColorBias = (typeof ModalColorTracker !== 'undefined' && ModalColorTracker && typeof ModalColorTracker.getColorBias === 'function')
      ? ModalColorTracker.getColorBias()
      : { colorBias: 1, stabilityBias: 1 };
    // RepetitionFatigueMonitor: penalty for repeated patterns
    const repetitionPenalty = (typeof RepetitionFatigueMonitor !== 'undefined' && RepetitionFatigueMonitor && typeof RepetitionFatigueMonitor.getRepetitionPenalty === 'function')
      ? clamp(RepetitionFatigueMonitor.getRepetitionPenalty(), 1, 1.5)
      : 1;
    // EnergyMomentumTracker: density nudge from momentum tracking
    const energyDensityNudge = (typeof EnergyMomentumTracker !== 'undefined' && EnergyMomentumTracker && typeof EnergyMomentumTracker.getDensityNudge === 'function')
      ? clamp(EnergyMomentumTracker.getDensityNudge(), 0.9, 1.3)
      : 1;

    // Record current energy for momentum tracking
    if (typeof EnergyMomentumTracker !== 'undefined' && EnergyMomentumTracker && typeof EnergyMomentumTracker.recordEnergy === 'function') {
      const absTime = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      EnergyMomentumTracker.recordEnergy(compositeIntensity, absTime);
    }

    // --- Batch 6 intelligence module reads ---
    // ArticulationProfiler: duration selection biases (consumed via ConductorState)
    const articulationBias = (typeof ArticulationProfiler !== 'undefined' && ArticulationProfiler && typeof ArticulationProfiler.getDurationBias === 'function')
      ? ArticulationProfiler.getDurationBias()
      : { legatoBias: 1, staccatoBias: 1 };
    // RegisterMigrationTracker: register drift correction
    const registerMigrationBias = (typeof RegisterMigrationTracker !== 'undefined' && RegisterMigrationTracker && typeof RegisterMigrationTracker.getRegisterBias === 'function')
      ? RegisterMigrationTracker.getRegisterBias()
      : { registerBias: 0, suggestion: 'maintain' };
    // RhythmicComplexityGradient: subdivision depth bias
    const subdivisionBias = (typeof RhythmicComplexityGradient !== 'undefined' && RhythmicComplexityGradient && typeof RhythmicComplexityGradient.getSubdivisionBias === 'function')
      ? clamp(RhythmicComplexityGradient.getSubdivisionBias(), 0.8, 1.3)
      : 1;
    // IntervalVarietyTracker: interval selection biases (consumed via ConductorState)
    const intervalBias = (typeof IntervalVarietyTracker !== 'undefined' && IntervalVarietyTracker && typeof IntervalVarietyTracker.getIntervalBias === 'function')
      ? IntervalVarietyTracker.getIntervalBias()
      : { stepBias: 1, leapBias: 1 };
    // ClimaxProximityPredictor: density ramp + tension modifier
    const climaxDensityBias = (typeof ClimaxProximityPredictor !== 'undefined' && ClimaxProximityPredictor && typeof ClimaxProximityPredictor.getDensityRampBias === 'function')
      ? clamp(ClimaxProximityPredictor.getDensityRampBias(), 0.85, 1.25)
      : 1;
    const climaxTensionMod = (typeof ClimaxProximityPredictor !== 'undefined' && ClimaxProximityPredictor && typeof ClimaxProximityPredictor.getTensionModifier === 'function')
      ? clamp(ClimaxProximityPredictor.getTensionModifier(), 0.8, 1.2)
      : 1;
    // OnsetRegularityMonitor: rhythm variety bias
    const onsetRegularityBias = (typeof OnsetRegularityMonitor !== 'undefined' && OnsetRegularityMonitor && typeof OnsetRegularityMonitor.getRhythmVarietyBias === 'function')
      ? clamp(OnsetRegularityMonitor.getRhythmVarietyBias(), 0.85, 1.25)
      : 1;
    // DurationalContourTracker: duration envelope + flicker modifier
    const durContourBias = (typeof DurationalContourTracker !== 'undefined' && DurationalContourTracker && typeof DurationalContourTracker.getDurationBias === 'function')
      ? DurationalContourTracker.getDurationBias()
      : { durationBias: 1, flickerMod: 1 };
    // HarmonicSurpriseIndex: tension bias from harmonic predictability
    const harmonicSurpriseBias = (typeof HarmonicSurpriseIndex !== 'undefined' && HarmonicSurpriseIndex && typeof HarmonicSurpriseIndex.getTensionBias === 'function')
      ? clamp(HarmonicSurpriseIndex.getTensionBias(), 0.9, 1.25)
      : 1;

    // Record rhythmic complexity for gradient tracking
    if (typeof RhythmicComplexityGradient !== 'undefined' && RhythmicComplexityGradient && typeof RhythmicComplexityGradient.recordComplexity === 'function') {
      const absTime2 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      // Use current density as a proxy for rhythmic complexity
      RhythmicComplexityGradient.recordComplexity(currentDensity, absTime2);
    }

    // --- Batch 7 intelligence module reads ---
    // CounterpointMotionTracker: inter-layer motion biases (consumed via ConductorState)
    const counterpointBias = (typeof CounterpointMotionTracker !== 'undefined' && CounterpointMotionTracker && typeof CounterpointMotionTracker.getMotionBias === 'function')
      ? CounterpointMotionTracker.getMotionBias()
      : { parallelBias: 1, contraryBias: 1 };
    // ConsonanceDissonanceTracker: tension modifier from interval quality
    const consonanceTensionBias = (typeof ConsonanceDissonanceTracker !== 'undefined' && ConsonanceDissonanceTracker && typeof ConsonanceDissonanceTracker.getTensionBias === 'function')
      ? clamp(ConsonanceDissonanceTracker.getTensionBias(), 0.85, 1.25)
      : 1;
    // VelocityContourTracker: flicker modifier from dynamics shape
    const velocityFlickerMod = (typeof VelocityContourTracker !== 'undefined' && VelocityContourTracker && typeof VelocityContourTracker.getFlickerModifier === 'function')
      ? clamp(VelocityContourTracker.getFlickerModifier(), 0.85, 1.2)
      : 1;
    // PhraseBreathingAdvisor: density bias for breathing room
    const breathingDensityBias = (typeof PhraseBreathingAdvisor !== 'undefined' && PhraseBreathingAdvisor && typeof PhraseBreathingAdvisor.getDensityBias === 'function')
      ? clamp(PhraseBreathingAdvisor.getDensityBias(), 0.8, 1.2)
      : 1;
    // OctaveSpreadMonitor: register spread bias (consumed via ConductorState)
    const octaveSpreadBias = (typeof OctaveSpreadMonitor !== 'undefined' && OctaveSpreadMonitor && typeof OctaveSpreadMonitor.getSpreadBias === 'function')
      ? OctaveSpreadMonitor.getSpreadBias()
      : 0;
    // MotivicDensityTracker: motivic overcrowding bias
    const motivicDensityBias = (typeof MotivicDensityTracker !== 'undefined' && MotivicDensityTracker && typeof MotivicDensityTracker.getDensityBias === 'function')
      ? clamp(MotivicDensityTracker.getDensityBias(), 0.8, 1.2)
      : 1;
    // PedalPointDetector: bass movement suggestion (consumed via ConductorState)
    const pedalSuggestion = (typeof PedalPointDetector !== 'undefined' && PedalPointDetector && typeof PedalPointDetector.getBassSuggestion === 'function')
      ? PedalPointDetector.getBassSuggestion()
      : { suggestion: 'consider-anchor', urgency: 0 };
    // PhraseLengthMomentumTracker: phrase adjustment (consumed via ConductorState)
    const phraseLengthAdj = (typeof PhraseLengthMomentumTracker !== 'undefined' && PhraseLengthMomentumTracker && typeof PhraseLengthMomentumTracker.suggestAdjustment === 'function')
      ? PhraseLengthMomentumTracker.suggestAdjustment()
      : { adjustment: 0, suggestion: 'maintain' };

    // --- Batch 8 intelligence module reads ---
    // TensionResolutionTracker: penalize dangling unresolved dissonance
    const tensionResolBias = (typeof TensionResolutionTracker !== 'undefined' && TensionResolutionTracker && typeof TensionResolutionTracker.getTensionModifier === 'function')
      ? clamp(TensionResolutionTracker.getTensionModifier(), 0.9, 1.25)
      : 1;
    // MetricDisplacementDetector: displacement signal (consumed via ConductorState)
    const displacementSignal = (typeof MetricDisplacementDetector !== 'undefined' && MetricDisplacementDetector && typeof MetricDisplacementDetector.getDisplacementSignal === 'function')
      ? MetricDisplacementDetector.getDisplacementSignal()
      : { displacement: 'aligned', hemiolaActive: false };
    // DensityWaveAnalyzer: flicker modifier from density oscillation patterns
    const densityWaveFlicker = (typeof DensityWaveAnalyzer !== 'undefined' && DensityWaveAnalyzer && typeof DensityWaveAnalyzer.getFlickerModifier === 'function')
      ? clamp(DensityWaveAnalyzer.getFlickerModifier(), 0.9, 1.2)
      : 1;
    // TimbreBalanceTracker: timbre signal (consumed via ConductorState)
    const timbreSignal = (typeof TimbreBalanceTracker !== 'undefined' && TimbreBalanceTracker && typeof TimbreBalanceTracker.getTimbreSignal === 'function')
      ? TimbreBalanceTracker.getTimbreSignal()
      : { balanced: true, suggestion: 'maintain' };
    // HarmonicRhythmDensityRatio: density correction from harmonic/melodic imbalance
    const hrDensityBias = (typeof HarmonicRhythmDensityRatio !== 'undefined' && HarmonicRhythmDensityRatio && typeof HarmonicRhythmDensityRatio.getDensityBias === 'function')
      ? clamp(HarmonicRhythmDensityRatio.getDensityBias(), 0.85, 1.2)
      : 1;
    // ThematicRecallDetector: thematic signal (consumed via ConductorState)
    const thematicSignal = (typeof ThematicRecallDetector !== 'undefined' && ThematicRecallDetector && typeof ThematicRecallDetector.getThematicSignal === 'function')
      ? ThematicRecallDetector.getThematicSignal()
      : { thematicStatus: 'fresh', recallSection: null };
    // DynamicContrastMemory: flicker modifier from contrast deficit
    const contrastFlickerMod = (typeof DynamicContrastMemory !== 'undefined' && DynamicContrastMemory && typeof DynamicContrastMemory.getFlickerModifier === 'function')
      ? clamp(DynamicContrastMemory.getFlickerModifier(), 0.95, 1.2)
      : 1;
    // LayerIndependenceScorer: density bias from layer coupling balance
    const layerIndepBias = (typeof LayerIndependenceScorer !== 'undefined' && LayerIndependenceScorer && typeof LayerIndependenceScorer.getDensityBias === 'function')
      ? clamp(LayerIndependenceScorer.getDensityBias(), 0.9, 1.15)
      : 1;

    // --- Batch 9 intelligence module reads ---
    // ChromaticSaturationMonitor: density bias from pitch-class coverage
    const chromaticDensityBias = (typeof ChromaticSaturationMonitor !== 'undefined' && ChromaticSaturationMonitor && typeof ChromaticSaturationMonitor.getDensityBias === 'function')
      ? clamp(ChromaticSaturationMonitor.getDensityBias(), 0.9, 1.1)
      : 1;
    // LeapStepBalancer: density bias + interval correction (consumed via ConductorState)
    const leapStepDensityBias = (typeof LeapStepBalancer !== 'undefined' && LeapStepBalancer && typeof LeapStepBalancer.getDensityBias === 'function')
      ? clamp(LeapStepBalancer.getDensityBias(), 0.9, 1.1)
      : 1;
    const leapStepCorrection = (typeof LeapStepBalancer !== 'undefined' && LeapStepBalancer && typeof LeapStepBalancer.getIntervalCorrection === 'function')
      ? LeapStepBalancer.getIntervalCorrection()
      : { leapBias: 1, stepBias: 1 };
    // TexturalGradientTracker: flicker modifier from texture rate-of-change
    const texturalGradientFlicker = (typeof TexturalGradientTracker !== 'undefined' && TexturalGradientTracker && typeof TexturalGradientTracker.getFlickerModifier === 'function')
      ? clamp(TexturalGradientTracker.getFlickerModifier(), 0.9, 1.25)
      : 1;
    // CadentialPreparationAdvisor: tension bias near cadence points
    const cadentialTensionBias = (typeof CadentialPreparationAdvisor !== 'undefined' && CadentialPreparationAdvisor && typeof CadentialPreparationAdvisor.getTensionBias === 'function')
      ? clamp(CadentialPreparationAdvisor.getTensionBias(), 1, 1.2)
      : 1;
    // AmbitusMigrationTracker: density + register signals
    const ambitusDensityBias = (typeof AmbitusMigrationTracker !== 'undefined' && AmbitusMigrationTracker && typeof AmbitusMigrationTracker.getDensityBias === 'function')
      ? clamp(AmbitusMigrationTracker.getDensityBias(), 0.9, 1.1)
      : 1;
    const ambitusSignal = (typeof AmbitusMigrationTracker !== 'undefined' && AmbitusMigrationTracker && typeof AmbitusMigrationTracker.getAmbitusSignal === 'function')
      ? AmbitusMigrationTracker.getAmbitusSignal()
      : { range: 24, trend: 'stable', registerSuggestion: 'maintain' };
    // TemporalProportionTracker: proportion quality signal (consumed via ConductorState)
    const proportionSignal = (typeof TemporalProportionTracker !== 'undefined' && TemporalProportionTracker && typeof TemporalProportionTracker.getProportionSignal === 'function')
      ? TemporalProportionTracker.getProportionSignal()
      : { suggestion: 'maintain', idealBeats: 8, quality: 0.5 };
    // RhythmicSymmetryDetector: symmetry signal (consumed via ConductorState)
    const symmetrySignal = (typeof RhythmicSymmetryDetector !== 'undefined' && RhythmicSymmetryDetector && typeof RhythmicSymmetryDetector.getSymmetrySignal === 'function')
      ? RhythmicSymmetryDetector.getSymmetrySignal()
      : { symmetryScore: 0, type: 'none', suggestion: 'maintain' };
    // SilenceDistributionTracker: silence distribution signal (consumed via ConductorState)
    const silenceSignal = (typeof SilenceDistributionTracker !== 'undefined' && SilenceDistributionTracker && typeof SilenceDistributionTracker.getSilenceSignal === 'function')
      ? SilenceDistributionTracker.getSilenceSignal()
      : { clusterScore: 0, staggerScore: 0, silenceRatio: 0.3, suggestion: 'maintain' };

    // --- Batch 10 intelligence module reads ---
    // VoiceLeadingEfficiencyTracker: density bias from voice-leading smoothness
    const voiceLeadDensityBias = (typeof VoiceLeadingEfficiencyTracker !== 'undefined' && VoiceLeadingEfficiencyTracker && typeof VoiceLeadingEfficiencyTracker.getDensityBias === 'function')
      ? clamp(VoiceLeadingEfficiencyTracker.getDensityBias(), 0.9, 1.1)
      : 1;
    // RhythmicGroupingAnalyzer: grouping signal (consumed via ConductorState)
    const groupingSignal = (typeof RhythmicGroupingAnalyzer !== 'undefined' && RhythmicGroupingAnalyzer && typeof RhythmicGroupingAnalyzer.getGroupingSignal === 'function')
      ? RhythmicGroupingAnalyzer.getGroupingSignal()
      : { groupingType: 'ambiguous', binaryScore: 0.5, ternaryScore: 0.5, inTransition: false };
    // DynamicArchitectPlanner: tension bias from macro dynamic plan
    const dynamicPlanTensionBias = (typeof DynamicArchitectPlanner !== 'undefined' && DynamicArchitectPlanner && typeof DynamicArchitectPlanner.getTensionBias === 'function')
      ? clamp(DynamicArchitectPlanner.getTensionBias(), 0.9, 1.15)
      : 1;
    // TessituraPressureMonitor: density bias from extreme register pressure
    const tessituraDensityBias = (typeof TessituraPressureMonitor !== 'undefined' && TessituraPressureMonitor && typeof TessituraPressureMonitor.getDensityBias === 'function')
      ? clamp(TessituraPressureMonitor.getDensityBias(), 0.85, 1.1)
      : 1;
    // PolyrhythmicAlignmentTracker: flicker modifier at convergence points
    const polyAlignFlicker = (typeof PolyrhythmicAlignmentTracker !== 'undefined' && PolyrhythmicAlignmentTracker && typeof PolyrhythmicAlignmentTracker.getFlickerModifier === 'function')
      ? clamp(PolyrhythmicAlignmentTracker.getFlickerModifier(), 0.9, 1.2)
      : 1;
    // MelodicDirectionalityTracker: density bias from directional monotony
    const melodicDirDensityBias = (typeof MelodicDirectionalityTracker !== 'undefined' && MelodicDirectionalityTracker && typeof MelodicDirectionalityTracker.getDensityBias === 'function')
      ? clamp(MelodicDirectionalityTracker.getDensityBias(), 0.9, 1.05)
      : 1;
    // HarmonicFieldDensityTracker: density bias from vertical harmonic thickness
    const harmFieldDensityBias = (typeof HarmonicFieldDensityTracker !== 'undefined' && HarmonicFieldDensityTracker && typeof HarmonicFieldDensityTracker.getDensityBias === 'function')
      ? clamp(HarmonicFieldDensityTracker.getDensityBias(), 0.9, 1.1)
      : 1;
    // OrchestrationWeightTracker: register weight signal (consumed via ConductorState)
    const orchestrationSignal = (typeof OrchestrationWeightTracker !== 'undefined' && OrchestrationWeightTracker && typeof OrchestrationWeightTracker.getWeightSignal === 'function')
      ? OrchestrationWeightTracker.getWeightSignal()
      : { bassWeight: 0.33, midWeight: 0.34, trebleWeight: 0.33, suggestion: 'balanced', dominantBand: 'none' };

    // --- Batch 11 intelligence module reads ---
    // RhythmicInertiaTracker: density bias from rhythmic pattern persistence
    const rhythmicInertiaBias = (typeof RhythmicInertiaTracker !== 'undefined' && RhythmicInertiaTracker && typeof RhythmicInertiaTracker.getDensityBias === 'function')
      ? clamp(RhythmicInertiaTracker.getDensityBias(), 0.9, 1.1)
      : 1;
    // PitchClassGravityMap: tonal gravity signal (consumed via ConductorState)
    const gravitySignal = (typeof PitchClassGravityMap !== 'undefined' && PitchClassGravityMap && typeof PitchClassGravityMap.getGravitySignal === 'function')
      ? PitchClassGravityMap.getGravitySignal()
      : { center: 0, stability: 0.5, driftFromCenter: 0, suggestion: 'maintain' };
    // DynamicEnvelopeShaper: flicker modifier from envelope punchiness
    const envelopeFlickerMod = (typeof DynamicEnvelopeShaper !== 'undefined' && DynamicEnvelopeShaper && typeof DynamicEnvelopeShaper.getFlickerModifier === 'function')
      ? clamp(DynamicEnvelopeShaper.getFlickerModifier(), 0.9, 1.15)
      : 1;
    // IntervalDirectionMemory: interval freshness signal (consumed via ConductorState)
    const intervalFreshness = (typeof IntervalDirectionMemory !== 'undefined' && IntervalDirectionMemory && typeof IntervalDirectionMemory.getFreshnessSignal === 'function')
      ? IntervalDirectionMemory.getFreshnessSignal()
      : { overusedIntervals: [], freshness: 1, suggestion: 'maintain' };
    // CrossLayerDensityBalancer: density bias from layer activity imbalance
    const crossLayerDensityBias = (typeof CrossLayerDensityBalancer !== 'undefined' && CrossLayerDensityBalancer && typeof CrossLayerDensityBalancer.getDensityBias === 'function')
      ? clamp(CrossLayerDensityBalancer.getDensityBias(), 0.9, 1.05)
      : 1;
    // HarmonicPedalFieldTracker: tension bias from pedal/drone stasis
    const pedalFieldTensionBias = (typeof HarmonicPedalFieldTracker !== 'undefined' && HarmonicPedalFieldTracker && typeof HarmonicPedalFieldTracker.getTensionBias === 'function')
      ? clamp(HarmonicPedalFieldTracker.getTensionBias(), 0.9, 1.15)
      : 1;
    // MicroTimingDriftDetector: timing drift signal (consumed via ConductorState)
    const timingDriftSignal = (typeof MicroTimingDriftDetector !== 'undefined' && MicroTimingDriftDetector && typeof MicroTimingDriftDetector.getDriftSignal === 'function')
      ? MicroTimingDriftDetector.getDriftSignal()
      : { avgDrift: 0, tightness: 0.5, suggestion: 'maintain' };
    // RegistralVelocityCorrelator: flicker modifier from register-velocity correlation
    const regVelFlickerMod = (typeof RegistralVelocityCorrelator !== 'undefined' && RegistralVelocityCorrelator && typeof RegistralVelocityCorrelator.getFlickerModifier === 'function')
      ? clamp(RegistralVelocityCorrelator.getFlickerModifier(), 0.9, 1.15)
      : 1;
    // PhraseContourArchetypeDetector: contour classification (consumed via ConductorState)
    const contourSignal = (typeof PhraseContourArchetypeDetector !== 'undefined' && PhraseContourArchetypeDetector && typeof PhraseContourArchetypeDetector.getContourSignal === 'function')
      ? PhraseContourArchetypeDetector.getContourSignal()
      : { archetype: 'undefined', confidence: 0, suggestion: 'maintain' };
    // HarmonicDensityOscillator: tension bias from harmonic rate oscillation
    const harmDensityOscTensionBias = (typeof HarmonicDensityOscillator !== 'undefined' && HarmonicDensityOscillator && typeof HarmonicDensityOscillator.getTensionBias === 'function')
      ? clamp(HarmonicDensityOscillator.getTensionBias(), 0.9, 1.1)
      : 1;
    // AttackDensityProfiler: density bias from attack/sustain ratio
    const attackDensityBias = (typeof AttackDensityProfiler !== 'undefined' && AttackDensityProfiler && typeof AttackDensityProfiler.getDensityBias === 'function')
      ? clamp(AttackDensityProfiler.getDensityBias(), 0.9, 1.1)
      : 1;
    // LayerEntryExitTracker: orchestration momentum (consumed via ConductorState)
    const layerMomentumSignal = (typeof LayerEntryExitTracker !== 'undefined' && LayerEntryExitTracker && typeof LayerEntryExitTracker.getMomentumSignal === 'function')
      ? LayerEntryExitTracker.getMomentumSignal()
      : { momentum: 'stable', layerDelta: 0, currentLayers: 0 };
    // IntervalExpansionContractor: density bias from interval vocabulary trend
    const intervalExpDensityBias = (typeof IntervalExpansionContractor !== 'undefined' && IntervalExpansionContractor && typeof IntervalExpansionContractor.getDensityBias === 'function')
      ? clamp(IntervalExpansionContractor.getDensityBias(), 0.9, 1.1)
      : 1;
    // DynamicPeakMemory: tension bias from peak spacing
    const dynamicPeakTensionBias = (typeof DynamicPeakMemory !== 'undefined' && DynamicPeakMemory && typeof DynamicPeakMemory.getTensionBias === 'function')
      ? clamp(DynamicPeakMemory.getTensionBias(), 0.9, 1.1)
      : 1;
    // RhythmicDensityContrastTracker: flicker modifier from dense/sparse contrast
    const rhythmDensityContrastFlicker = (typeof RhythmicDensityContrastTracker !== 'undefined' && RhythmicDensityContrastTracker && typeof RhythmicDensityContrastTracker.getFlickerModifier === 'function')
      ? clamp(RhythmicDensityContrastTracker.getFlickerModifier(), 0.9, 1.15)
      : 1;
    // TonalAnchorDistanceTracker: tension bias from tonal distance
    const tonalAnchorTensionBias = (typeof TonalAnchorDistanceTracker !== 'undefined' && TonalAnchorDistanceTracker && typeof TonalAnchorDistanceTracker.getTensionBias === 'function')
      ? clamp(TonalAnchorDistanceTracker.getTensionBias(), 0.9, 1.12)
      : 1;

    // Record density for wave analysis
    if (typeof DensityWaveAnalyzer !== 'undefined' && DensityWaveAnalyzer && typeof DensityWaveAnalyzer.recordDensity === 'function') {
      const absTime3 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      DensityWaveAnalyzer.recordDensity(currentDensity, absTime3);
    }
    // Record dynamic extremes for contrast memory
    if (typeof DynamicContrastMemory !== 'undefined' && DynamicContrastMemory && typeof DynamicContrastMemory.recordExtremes === 'function') {
      const absTime4 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      DynamicContrastMemory.recordExtremes(absTime4);
    }
    // Record textural gradient snapshot
    if (typeof TexturalGradientTracker !== 'undefined' && TexturalGradientTracker && typeof TexturalGradientTracker.recordDensity === 'function') {
      const absTime5 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      TexturalGradientTracker.recordDensity(currentDensity, absTime5);
    }
    // Record ambitus snapshot
    if (typeof AmbitusMigrationTracker !== 'undefined' && AmbitusMigrationTracker && typeof AmbitusMigrationTracker.recordSnapshot === 'function') {
      const absTime6 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      AmbitusMigrationTracker.recordSnapshot(absTime6);
    }
    // Record intensity for macro dynamic architecture
    if (typeof DynamicArchitectPlanner !== 'undefined' && DynamicArchitectPlanner && typeof DynamicArchitectPlanner.recordIntensity === 'function') {
      const absTime7 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      DynamicArchitectPlanner.recordIntensity(compositeIntensity, absTime7);
    }
    // Record bass for pedal field tracking
    if (typeof HarmonicPedalFieldTracker !== 'undefined' && HarmonicPedalFieldTracker && typeof HarmonicPedalFieldTracker.recordBass === 'function') {
      const absTime8 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      HarmonicPedalFieldTracker.recordBass(absTime8);
    }
    // Record harmonic change rate for oscillation analysis
    if (typeof HarmonicDensityOscillator !== 'undefined' && HarmonicDensityOscillator && typeof HarmonicDensityOscillator.recordChangeRate === 'function') {
      const absTime9 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      const hrChangeRate = (typeof harmonicRhythm === 'number' && Number.isFinite(harmonicRhythm)) ? clamp(harmonicRhythm, 0, 1) : 0.5;
      HarmonicDensityOscillator.recordChangeRate(hrChangeRate, absTime9);
    }
    // Record layer entry/exit snapshot
    if (typeof LayerEntryExitTracker !== 'undefined' && LayerEntryExitTracker && typeof LayerEntryExitTracker.recordSnapshot === 'function') {
      const absTime10 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      LayerEntryExitTracker.recordSnapshot(absTime10);
    }
    // Record interval expansion/contraction snapshot
    if (typeof IntervalExpansionContractor !== 'undefined' && IntervalExpansionContractor && typeof IntervalExpansionContractor.recordSnapshot === 'function') {
      const absTime11 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      IntervalExpansionContractor.recordSnapshot(absTime11);
    }
    // Record intensity for dynamic peak memory
    if (typeof DynamicPeakMemory !== 'undefined' && DynamicPeakMemory && typeof DynamicPeakMemory.recordIntensity === 'function') {
      const absTime12 = (typeof beatStartTime !== 'undefined' && Number.isFinite(Number(beatStartTime))) ? Number(beatStartTime) : 0;
      DynamicPeakMemory.recordIntensity(compositeIntensity, absTime12);
    }
    // Record rhythmic density for contrast tracking
    if (typeof RhythmicDensityContrastTracker !== 'undefined' && RhythmicDensityContrastTracker && typeof RhythmicDensityContrastTracker.recordDensity === 'function') {
      RhythmicDensityContrastTracker.recordDensity(currentDensity);
    }

    // Apply coherence-based density bias: low coherence → thinner density
    const coherenceDensityBias = (typeof LayerCoherenceScorer !== 'undefined' && LayerCoherenceScorer && typeof LayerCoherenceScorer.getDensityBias === 'function')
      ? LayerCoherenceScorer.getDensityBias()
      : 1;

    const emissionRatio = (typeof EmissionFeedbackListener !== 'undefined' && EmissionFeedbackListener && typeof EmissionFeedbackListener.getEmissionRatio === 'function')
      ? clamp(Number(EmissionFeedbackListener.getEmissionRatio()), 0, 2)
      : 1;
    const densityCorrection = clamp(1 + clamp(1 - emissionRatio, -1, 1) * 0.2, 0.8, 1.25);

    // 3. Drive Motif Density (Coherence: High tension -> denser motifs)
    // Smoothly interpolate towards target density, then apply micro-hyper
    // flicker so density itself oscillates within a beat (Step 4)
    const targetDensity = clamp(ConductorConfig.getTargetDensity(compositeIntensity) * densityCorrection * coherenceDensityBias * onsetDensityBias * restOnsetBias * voiceCountBias * energyDensityNudge * climaxDensityBias * subdivisionBias * onsetRegularityBias * breathingDensityBias * motivicDensityBias * hrDensityBias * layerIndepBias * chromaticDensityBias * leapStepDensityBias * ambitusDensityBias * voiceLeadDensityBias * tessituraDensityBias * melodicDirDensityBias * harmFieldDensityBias * rhythmicInertiaBias * crossLayerDensityBias * attackDensityBias * intervalExpDensityBias, 0, 1);
    const smooth = ConductorConfig.getDensitySmoothing();
    currentDensity = currentDensity * (1 - smooth) + targetDensity * smooth;

    // Micro-hyper density flicker: density oscillates per-beat so some
    // subsubdivs get many note options (dense run territory) while others
    // get very few (sparse, exposed).  Amplitude scales with compositeIntensity
    // so calm sections stay stable and intense sections shimmer.
    // Texture intensity (#7): high texture activity → wider flicker amplitude
    // so motifConfig density oscillates more dramatically during texture-rich passages.
    const textureDensityBoost = (typeof DrumTextureCoupler !== 'undefined' && DrumTextureCoupler && typeof DrumTextureCoupler.getIntensity === 'function')
      ? clamp(Number(DrumTextureCoupler.getIntensity()), 0, 1) * 0.5
      : 0;
    const flickerAmplitude = (compositeIntensity + textureDensityBoost) * velocitySpreadBias * grooveVelBias * durContourBias.flickerMod * velocityFlickerMod * densityWaveFlicker * contrastFlickerMod * texturalGradientFlicker * polyAlignFlicker * envelopeFlickerMod * regVelFlickerMod * rhythmDensityContrastFlicker;
    const densitySeed = (Number.isFinite(Number(beatStart)) ? Number(beatStart) : 0);
    const densityFlicker = m.sin(densitySeed * 0.0041 + 1.7) * 0.08 * flickerAmplitude
                         + m.sin(densitySeed * 0.0089 - 2.3) * 0.05 * flickerAmplitude
                         + rf(-0.03, 0.03) * flickerAmplitude;
    const densityBounds = ConductorConfig.getDensityBounds();
    const flickeredDensity = clamp(currentDensity + densityFlicker, densityBounds.floor, densityBounds.ceiling);

    if (typeof motifConfig !== 'undefined' && typeof motifConfig.setUnitProfileOverride === 'function') {
      // Apply flickered density to deeper units for texture buildup
      motifConfig.setUnitProfileOverride('div', { intervalDensity: flickeredDensity });
      motifConfig.setUnitProfileOverride('subdiv', { intervalDensity: flickeredDensity * 0.9 });
      motifConfig.setUnitProfileOverride('subsubdiv', { intervalDensity: flickeredDensity * 0.8 });
    }

    // 4. Drive Stutter Behavior (Dynamicism: High intensity -> faster, more chaotic stutters)
    if (typeof Stutter !== 'undefined') {
      // Profile-driven stutter params
      const stutterParams = ConductorConfig.getStutterParams(compositeIntensity);

      // Update default directive for spontaneous stutters
      if (typeof Stutter.setDefaultDirective === 'function') {
        Stutter.setDefaultDirective({
          rate: stutterParams.rate,
          rateCurve: stutterParams.rateCurve,
          phase: {
            left: 0,
            right: 0.5 + 0.2 * compositeIntensity, // wider stereo width with intensity
            center: 0
          },
          coherence: {
            enabled: true, // Always enable coherence for musicality
            mode: stutterParams.coherenceMode
          }
        });
      }
    }

    // 5. Delegate probability calculation to DynamismEngine (single authority)
    // GlobalConductor provides macro context (motif density, stutter directives above);
    // DynamismEngine is the sole probability calculator to avoid double-modulation.
    if (typeof DynamismEngine === 'undefined' || !DynamismEngine || typeof DynamismEngine.resolve !== 'function') {
      throw new Error('GlobalConductor.update: DynamismEngine.resolve is not available');
    }
    const resolved = DynamismEngine.resolve('beat');

    const derivedTension = clamp((Number(resolved.composite) * 0.7 + Number(harmonicTension) * 0.3) * harmonicChangeBias * repetitionPenalty * climaxTensionMod * harmonicSurpriseBias * consonanceTensionBias * tensionResolBias * cadentialTensionBias * dynamicPlanTensionBias * pedalFieldTensionBias * harmDensityOscTensionBias * dynamicPeakTensionBias * tonalAnchorTensionBias, 0, 1);
    if (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.set === 'function') {
      HarmonicContext.set({ tension: derivedTension });
    }

    let playOut = resolved.playProb;
    let stutterOut = resolved.stutterProb;

    // Apply climax boost on top of DynamismEngine's output (profile-driven)
    if (sectionPhase === 'climax') {
      const boost = ConductorConfig.getClimaxBoost();
      playOut = clamp(resolved.playProb * boost.playScale, 0, 1);
      stutterOut = clamp(resolved.stutterProb * boost.stutterScale, 0, 1);
    }

    if (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.updateFromConductor === 'function') {
      ConductorState.updateFromConductor({
        phraseCtx,
        sectionPhase,
        tension: derivedTension,
        excursion,
        harmonicRhythm,
        emissionRatio,
        compositeIntensity: resolved.composite,
        onsetCrossModBias,
        syncopationBias: syncopationBias.syncopationBias,
        accentDownbeatBias: accentBias.downbeatBias,
        accentOffbeatBias: accentBias.offbeatBias,
        modalColorBias: modalColorBias.colorBias,
        modalStabilityBias: modalColorBias.stabilityBias,
        articulationLegatoBias: articulationBias.legatoBias,
        articulationStaccatoBias: articulationBias.staccatoBias,
        registerMigrationBias: registerMigrationBias.registerBias,
        registerSuggestion: registerMigrationBias.suggestion,
        intervalStepBias: intervalBias.stepBias,
        intervalLeapBias: intervalBias.leapBias,
        durationalContourBias: durContourBias.durationBias,
        counterpointParallelBias: counterpointBias.parallelBias,
        counterpointContraryBias: counterpointBias.contraryBias,
        octaveSpreadBias,
        pedalSuggestion: pedalSuggestion.suggestion,
        pedalUrgency: pedalSuggestion.urgency,
        phraseLengthAdjustment: phraseLengthAdj.adjustment,
        phraseLengthSuggestion: phraseLengthAdj.suggestion,
        metricDisplacement: displacementSignal.displacement,
        hemiolaActive: displacementSignal.hemiolaActive,
        timbreBalanced: timbreSignal.balanced,
        timbreSuggestion: timbreSignal.suggestion,
        thematicStatus: thematicSignal.thematicStatus,
        thematicRecallSection: thematicSignal.recallSection,
        leapStepLeapBias: leapStepCorrection.leapBias,
        leapStepStepBias: leapStepCorrection.stepBias,
        proportionSuggestion: proportionSignal.suggestion,
        proportionIdealBeats: proportionSignal.idealBeats,
        proportionQuality: proportionSignal.quality,
        symmetryType: symmetrySignal.type,
        symmetrySuggestion: symmetrySignal.suggestion,
        ambitusRange: ambitusSignal.range,
        ambitusTrend: ambitusSignal.trend,
        ambitusRegisterSuggestion: ambitusSignal.registerSuggestion,
        silenceSuggestion: silenceSignal.suggestion,
        silenceRatio: silenceSignal.silenceRatio,
        cadentialPreparationActive: (typeof CadentialPreparationAdvisor !== 'undefined' && CadentialPreparationAdvisor && typeof CadentialPreparationAdvisor.getCadentialSignal === 'function') ? CadentialPreparationAdvisor.getCadentialSignal().preparationActive : false,
        voiceLeadingEfficiency: (typeof VoiceLeadingEfficiencyTracker !== 'undefined' && VoiceLeadingEfficiencyTracker && typeof VoiceLeadingEfficiencyTracker.getEfficiencySignal === 'function') ? VoiceLeadingEfficiencyTracker.getEfficiencySignal().efficiency : 0.5,
        rhythmicGroupingType: groupingSignal.groupingType,
        rhythmicGroupingInTransition: groupingSignal.inTransition,
        dynamicPlanMacroPosition: (typeof DynamicArchitectPlanner !== 'undefined' && DynamicArchitectPlanner && typeof DynamicArchitectPlanner.getDynamicPlanSignal === 'function') ? DynamicArchitectPlanner.getDynamicPlanSignal().macroPosition : 0,
        tessituraRegion: (typeof TessituraPressureMonitor !== 'undefined' && TessituraPressureMonitor && typeof TessituraPressureMonitor.getPressureSignal === 'function') ? TessituraPressureMonitor.getPressureSignal().region : 'comfortable',
        polyrhythmConvergence: (typeof PolyrhythmicAlignmentTracker !== 'undefined' && PolyrhythmicAlignmentTracker && typeof PolyrhythmicAlignmentTracker.getAlignmentSignal === 'function') ? PolyrhythmicAlignmentTracker.getAlignmentSignal().convergencePoint : false,
        melodicDirection: (typeof MelodicDirectionalityTracker !== 'undefined' && MelodicDirectionalityTracker && typeof MelodicDirectionalityTracker.getDirectionalitySignal === 'function') ? MelodicDirectionalityTracker.getDirectionalitySignal().direction : 'undulating',
        harmonicFieldAvgSimultaneous: (typeof HarmonicFieldDensityTracker !== 'undefined' && HarmonicFieldDensityTracker && typeof HarmonicFieldDensityTracker.getFieldDensitySignal === 'function') ? HarmonicFieldDensityTracker.getFieldDensitySignal().avgSimultaneous : 1,
        orchestrationSuggestion: orchestrationSignal.suggestion,
        orchestrationDominantBand: orchestrationSignal.dominantBand,
        tonalGravityCenter: gravitySignal.center,
        tonalGravityStability: gravitySignal.stability,
        tonalGravitySuggestion: gravitySignal.suggestion,
        intervalFreshness: intervalFreshness.freshness,
        intervalFreshnessSuggestion: intervalFreshness.suggestion,
        timingTightness: timingDriftSignal.tightness,
        timingDriftSuggestion: timingDriftSignal.suggestion,
        rhythmicInertiaSuggestion: (typeof RhythmicInertiaTracker !== 'undefined' && RhythmicInertiaTracker && typeof RhythmicInertiaTracker.getInertiaSignal === 'function') ? RhythmicInertiaTracker.getInertiaSignal().suggestion : 'maintain',
        envelopeShape: (typeof DynamicEnvelopeShaper !== 'undefined' && DynamicEnvelopeShaper && typeof DynamicEnvelopeShaper.getEnvelopeSignal === 'function') ? DynamicEnvelopeShaper.getEnvelopeSignal().shape : 'neutral',
        crossLayerImbalance: (typeof CrossLayerDensityBalancer !== 'undefined' && CrossLayerDensityBalancer && typeof CrossLayerDensityBalancer.getBalanceSignal === 'function') ? CrossLayerDensityBalancer.getBalanceSignal().imbalance : 0,
        pedalFieldStable: (typeof HarmonicPedalFieldTracker !== 'undefined' && HarmonicPedalFieldTracker && typeof HarmonicPedalFieldTracker.getPedalFieldSignal === 'function') ? HarmonicPedalFieldTracker.getPedalFieldSignal().fieldStable : false,
        contourArchetype: contourSignal.archetype,
        contourSuggestion: contourSignal.suggestion,
        harmonicOscillating: harmDensityOscTensionBias !== 1,
        attackSuggestion: (typeof AttackDensityProfiler !== 'undefined' && AttackDensityProfiler && typeof AttackDensityProfiler.getAttackSignal === 'function') ? AttackDensityProfiler.getAttackSignal().suggestion : 'balanced',
        layerMomentum: layerMomentumSignal.momentum,
        layerCount: layerMomentumSignal.currentLayers,
        intervalExpansionTrend: (typeof IntervalExpansionContractor !== 'undefined' && IntervalExpansionContractor && typeof IntervalExpansionContractor.getExpansionSignal === 'function') ? IntervalExpansionContractor.getExpansionSignal().trend : 'stable',
        dynamicPeakRecency: (typeof DynamicPeakMemory !== 'undefined' && DynamicPeakMemory && typeof DynamicPeakMemory.getPeakSignal === 'function') ? DynamicPeakMemory.getPeakSignal().peakRecency : 'none',
        rhythmicContrastSuggestion: (typeof RhythmicDensityContrastTracker !== 'undefined' && RhythmicDensityContrastTracker && typeof RhythmicDensityContrastTracker.getContrastSignal === 'function') ? RhythmicDensityContrastTracker.getContrastSignal().suggestion : 'maintain',
        tonalAdventureLevel: (typeof TonalAnchorDistanceTracker !== 'undefined' && TonalAnchorDistanceTracker && typeof TonalAnchorDistanceTracker.getDistanceSignal === 'function') ? TonalAnchorDistanceTracker.getDistanceSignal().adventureLevel : 'home',
        playProb: playOut,
        stutterProb: stutterOut
      });
    }

    return {
      playProb: playOut,
      stutterProb: stutterOut
    };
  }

  return { update };
})();
