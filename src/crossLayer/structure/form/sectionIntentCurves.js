moduleLifecycle.declare({
  name: 'sectionIntentCurves',
  subsystem: 'crossLayer',
  deps: ['L0', 'harmonicContext', 'harmonicJourney', 'hyperMetaManagerState', 'phaseFloorController', 'sectionMemory', 'timeStream', 'validator'],
  provides: ['sectionIntentCurves'],
  crossLayerScopes: ['all'],
  init: (deps) => {
  const L0 = deps.L0;
  const harmonicContext = deps.harmonicContext;
  const harmonicJourney = deps.harmonicJourney;
  const hyperMetaManagerState = deps.hyperMetaManagerState;
  const phaseFloorController = deps.phaseFloorController;
  const sectionMemory = deps.sectionMemory;
  const timeStream = deps.timeStream;
  const V = deps.validator.create('sectionIntentCurves');

  // Intent curve shaping constants
  const PHRASE_PHASE_SCALE = 0.3;
  const WAVE_PHASE_SPEED = 0.07;
  const DENSITY_BASE = 0.36;
  const DENSITY_ARC_SCALE = 0.62;
  const DENSITY_LATE_TAPER = 0.12;
  const DISSONANCE_BASE = 0.2;
  const DISSONANCE_WAVE_BASE = 0.35;
  const DISSONANCE_WAVE_SCALE = 0.52;
  const DISSONANCE_LATE_SURGE = 0.15;
  const INTERACTION_BASE = 0.28;
  const INTERACTION_WAVE_BASE = 0.25;
  const INTERACTION_WAVE_SCALE = 0.55;
  const INTERACTION_ARC_BASE = 0.5;
  const INTERACTION_ARC_SCALE = 0.5;
  const INTERACTION_LATE_SURGE = 0.16;
  const LONG_FORM_DENSITY_RELIEF = 0.10;
  const LONG_FORM_DISSONANCE_RELIEF = 0.08;
  const LONG_FORM_INTERACTION_RELIEF = 0.07;
  const ENTROPY_DENSITY_W = 0.35;
  const ENTROPY_DISSONANCE_W = 0.3;
  const ENTROPY_INTERACTION_W = 0.35;
  const ENTROPY_FLOOR = 0.15;
  const ENTROPY_CEIL = 0.95;
  const ENTROPY_FLOOR_REGIME = { exploring: 0.28, evolving: 0.25, coherent: 0.18 };
  const CONVERGENCE_BASE = 0.3;
  const CONVERGENCE_ARC_SCALE = 0.35;
  const CONVERGENCE_LATE_SURGE = 0.15;

  /** @type {{ densityTarget: number, dissonanceTarget: number, interactionTarget: number, entropyTarget: number, convergenceTarget: number }} */
  let lastIntent = {
    densityTarget: 0.5, dissonanceTarget: 0.5, interactionTarget: 0.5,
    entropyTarget: 0.5, convergenceTarget: 0.5
  };

  function getIntent() {
    const p = clamp(timeStream.compoundProgress('section'), 0, 1);
    const s = timeStream.getPosition('section');
    const totalSections = timeStream.getBounds('section');
    const ph = timeStream.getPosition('phrase');
    const sectionRoute = totalSections > 1 ? s / (totalSections - 1) : 0;
    const longFormPressure = clamp(totalSections - 4, 0, 1);
    const personality = hyperMetaManagerState.lastRunPersonality;
    const personalityContrastDensity = s === 0 && personality
      ? (personality.narrative && personality.narrative.includes('dense') ? -0.08 : personality.narrative && personality.narrative.includes('sparse') ? 0.06 : 0)
      : 0;
    const lateSurgeGate = clamp(1.0 - (sectionRoute - 0.70) / 0.30, 0, 1);
    const axisEnergyShares = conductorSignalBridge.getSignals().axisEnergyShares;
    const phaseShare = axisEnergyShares && typeof axisEnergyShares.phase === 'number' ? axisEnergyShares.phase : 1.0 / 6.0;
    const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const intentRegime = conductorSignalBridge.getSignals().regime;
    const phraseProgress = clamp(timeStream.compoundProgress('phrase'), 0, 1);

    const arc = m.sin(m.pow(p, 1.15) * m.PI);
    const wave = 0.5 + 0.5 * m.sin((p + (s + ph * PHRASE_PHASE_SCALE) * WAVE_PHASE_SPEED) * m.PI * 2);
    const lateLift = clamp((p - 0.58) / 0.42, 0, 1);
    const midSectionPocket = m.sin(clamp((p - 0.18) / 0.64, 0, 1) * m.PI);
    const middleSectionPressure = m.sin(clamp(sectionRoute, 0, 1) * m.PI);
    const longFormRelief = longFormPressure * middleSectionPressure * midSectionPocket * (1 - lowPhasePressure * 0.75);
    const reliefDepth = s === 1 ? 0.06 : sectionRoute > 0.7 ? 0.15 : 0.12;
    const sectionBoundaryRelief = s > 0 ? clamp(1.0 - (1.0 - p / 0.08) * reliefDepth, 1.0 - reliefDepth, 1.0) : 1.0;

    // Section contrast biases from helper
    const cb = sectionIntentCurvesHelpers.getSectionContrastBiases();

    // Melodic coupling: directionBias modulates dissonance asymmetry.
    // Ascending contour (positive bias) pushes dissonance up -- building tension.
    // Descending contour (negative bias) eases dissonance -- resolving.
    const melodicCtx = emergentMelodicEngine.getContext();
    const dirBias = melodicCtx ? V.optionalFinite(melodicCtx.directionBias, 0) : 0;
    const melodicDissonanceMod = dirBias * 0.06;

    // Rhythmic coupling: emergent rhythm density adjusts intent density floor.
    // High rhythm density -> raise density floor (match rhythmic activity).
    // Low rhythm density -> allow sparser texture (respect rhythmic space).
    const rhythmEntry = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const rhythmDensity = rhythmEntry && Number.isFinite(rhythmEntry.density) ? rhythmEntry.density : 0.5;
    const rhythmDensityMod = clamp((rhythmDensity - 0.5) * 0.08, -0.04, 0.04);

    // Harmonic gravity well -- distant keys boost density and dissonance
    const journeyStop = harmonicJourney.getStop(s);
    const journeyDist = (journeyStop && Number.isFinite(journeyStop.distance)) ? journeyStop.distance : 0;
    const gravityBoost = clamp(journeyDist * 0.025, 0, 0.10);

    const currentPhase = /** @type {string} */ (harmonicContext.getField('sectionPhase'));
    const densityTarget = clamp(
      (DENSITY_BASE + arc * DENSITY_ARC_SCALE - lateLift * DENSITY_LATE_TAPER - longFormRelief * LONG_FORM_DENSITY_RELIEF + cb.densityContrast + cb.regimeContrast + cb.coherenceLearning + cb.spectralContrast + gravityBoost + rhythmDensityMod) * sectionBoundaryRelief
      + m.sin(phraseProgress * m.PI) * 0.14 * (ph % 2 === 0 ? 1.0 : -0.55) * (1.0 + m.sin(clamp(sectionRoute, 0, 1) * m.PI) * 0.3)
      + (() => {
        const densitySlope = sectionMemory.getDensityTrajectory();
        if (densitySlope >= -0.03) return 0;
        const dPhaseGate = currentPhase === 'coda' || currentPhase === 'conclusion' ? 0.15
          : currentPhase === 'climax' ? 1.3 : 1.0;
        return clamp(-densitySlope * 0.12 * dPhaseGate, 0, 0.06);
      })(),
      0, 1
    );

    // Intent-aware tension trajectory correction
    const tensionSlope = sectionMemory.getTensionTrajectory();
    const phaseIntentGate = currentPhase === 'resolution' || currentPhase === 'conclusion' || currentPhase === 'coda' ? 0.4
      : currentPhase === 'climax' ? 1.5 : currentPhase === 'development' ? 1.2 : 1.0;
    const trajectoryCorrection = tensionSlope < -0.04 ? clamp(-tensionSlope * 0.20 * phaseIntentGate, 0, 0.12) : 0;
    // Xenolinguistic L1: feedback pitch complement bleeds into dissonance target
    const feedbackPitchEntry = L0.getLast(L0_CHANNELS.feedbackPitch, { layer: 'both' });
    const feedbackDissonancePull = feedbackPitchEntry && Number.isFinite(feedbackPitchEntry.pitchClass) ? 0.03 : 0;
    const dissonanceTarget = clamp(
      DISSONANCE_BASE + (DISSONANCE_WAVE_BASE + wave * DISSONANCE_WAVE_SCALE) * arc + lateLift * DISSONANCE_LATE_SURGE * lateSurgeGate - longFormRelief * LONG_FORM_DISSONANCE_RELIEF + cb.tensionContrast + cb.tensionLearning + trajectoryCorrection + gravityBoost * 0.7 + feedbackDissonancePull + melodicDissonanceMod
      + m.sin(clamp(sectionRoute, 0, 1) * m.PI) * 0.08,
      0, 1
    );

    const recentTransitions = L0.count(L0_CHANNELS.regimeTransition, { since: beatStartTime - 5, windowSeconds: 5 });
    const transitionSettling = recentTransitions > 2 ? clamp((recentTransitions - 2) * -0.02, -0.06, 0) : 0;
    const interactionTarget = clamp(
      INTERACTION_BASE + (INTERACTION_WAVE_BASE + wave * INTERACTION_WAVE_SCALE) * (INTERACTION_ARC_BASE + arc * INTERACTION_ARC_SCALE) + lateLift * INTERACTION_LATE_SURGE * lateSurgeGate - longFormRelief * LONG_FORM_INTERACTION_RELIEF + cb.flickerContrast + cb.turbulenceDampen + transitionSettling,
      0, 1
    );

    const effectiveEntropyFloor = V.optionalFinite(ENTROPY_FLOOR_REGIME[intentRegime], ENTROPY_FLOOR);
    const independentEntropyArc = 0.4 + arc * 0.25 + wave * 0.1;
    const blendedEntropy = (densityTarget * ENTROPY_DENSITY_W) + (dissonanceTarget * ENTROPY_DISSONANCE_W) + (interactionTarget * ENTROPY_INTERACTION_W);
    const entropyTarget = clamp(blendedEntropy * 0.6 + independentEntropyArc * 0.4, effectiveEntropyFloor, ENTROPY_CEIL);

    // Mid-section self-evaluation (helper)
    const totalPhrases = timeStream.getBounds('phrase');
    sectionIntentCurvesHelpers.midSectionEval(ph, p, totalPhrases);

    // Quality feed-forward via L0
    const halfPhrase = m.floor(totalPhrases / 2);
    const sectionStart = ph === 0 || ph === halfPhrase;
    const qualityEntry = sectionStart ? L0.getLast(L0_CHANNELS.sectionQuality, { layer: 'both' }) : null;
    const qBias = qualityEntry && Number.isFinite(qualityEntry.bias) ? qualityEntry.bias : 0;
    // Xenolinguistic L2: observation effect
    const bridgeSigs = conductorSignalBridge.getSignals();
    const exceedanceObs = V.optionalFinite(bridgeSigs.exceedanceTrendEma, 0);
    const observationConvergenceBoost = exceedanceObs > 0.3 ? clamp((exceedanceObs - 0.3) * 0.15, 0, 0.06) : 0;
    const convergenceTarget = clamp(CONVERGENCE_BASE + arc * CONVERGENCE_ARC_SCALE + lateLift * CONVERGENCE_LATE_SURGE + middleSectionPressure * 0.1 + qBias * 0.8 + observationConvergenceBoost, 0, 1);

    // CLAP guidance nudges (helper)
    const clap = sectionIntentCurvesHelpers.getClapNudges(s);
    const adjustedDensity = clamp(densityTarget + qBias * -0.5 + personalityContrastDensity + clap.density, 0, 1);
    const adjustedDissonance = clamp(dissonanceTarget + clap.dissonance, 0, 1);
    const adjustedInteraction = clamp(interactionTarget + clap.interaction, 0, 1);

    lastIntent = { densityTarget: adjustedDensity, dissonanceTarget: adjustedDissonance, interactionTarget: adjustedInteraction, entropyTarget, convergenceTarget };
    return lastIntent;
  }

  function getLastIntent() { return lastIntent; }

  /** @param {{ densityTarget?: number, dissonanceTarget?: number, interactionTarget?: number, entropyTarget?: number, convergenceTarget?: number }} intent */
  function setManualIntent(intent) {
    V.assertObject(intent, 'intent');
    lastIntent = {
      densityTarget: clamp(V.optionalFinite(intent.densityTarget, lastIntent.densityTarget), 0, 1),
      dissonanceTarget: clamp(V.optionalFinite(intent.dissonanceTarget, lastIntent.dissonanceTarget), 0, 1),
      interactionTarget: clamp(V.optionalFinite(intent.interactionTarget, lastIntent.interactionTarget), 0, 1),
      entropyTarget: clamp(V.optionalFinite(intent.entropyTarget, lastIntent.entropyTarget), 0, 1),
      convergenceTarget: clamp(V.optionalFinite(intent.convergenceTarget, lastIntent.convergenceTarget), 0, 1)
    };
    return lastIntent;
  }

  function reset() {
    lastIntent = { densityTarget: 0.5, dissonanceTarget: 0.5, interactionTarget: 0.5, entropyTarget: 0.5, convergenceTarget: 0.5 };
  }

  return { getIntent, getLastIntent, setManualIntent, reset };
  },
});
