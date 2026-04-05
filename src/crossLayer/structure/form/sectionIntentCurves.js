sectionIntentCurves = (() => {
  const V = validator.create('sectionIntentCurves');

  // Intent curve shaping constants
  const PHRASE_PHASE_SCALE = 0.3;     // phrase contribution to wave phase
  const WAVE_PHASE_SPEED = 0.07;      // section+phrase modulation speed
  // R77 E2: Raise density base 0.33->0.36 to recover note count. R76
  // showed -37% note drop (29258->18361) with L1 halved. Higher base
  // lifts the density floor across all sections.
  const DENSITY_BASE = 0.36;
  // R76 E4: Widen density arc scale 0.55->0.62 to amplify section-level
  // density contrast. Creates bigger density swings between section peaks
  // and troughs, improving densityVariance and musical section differentiation.
  const DENSITY_ARC_SCALE = 0.62;
  const DENSITY_LATE_TAPER = 0.12;
  const DISSONANCE_BASE = 0.2;
  const DISSONANCE_WAVE_BASE = 0.35;
  // R77 E5: Widen dissonance wave scale 0.45->0.52 for greater harmonic
  // tension variety across phrases. This amplifies the wave-based dissonance
  // modulation, creating more contrast between phrase peaks and troughs.
  const DISSONANCE_WAVE_SCALE = 0.52;
  // R71 E5: 0.10->0.15. Stronger late-section dissonance surge creates
  // more dramatic climaxes and greater tension contrast within sections.
  const DISSONANCE_LATE_SURGE = 0.15;
  const INTERACTION_BASE = 0.28;
  const INTERACTION_WAVE_BASE = 0.25;
  const INTERACTION_WAVE_SCALE = 0.55;
  const INTERACTION_ARC_BASE = 0.5;
  const INTERACTION_ARC_SCALE = 0.5;
  // R73 E4: 0.12->0.16. Stronger late-section interaction target supports
  // Q3 tension recovery (0.79->0.76 in R72) by creating more musical
  // activity in the final quarter of each section.
  const INTERACTION_LATE_SURGE = 0.16;
  const LONG_FORM_DENSITY_RELIEF = 0.10;
  const LONG_FORM_DISSONANCE_RELIEF = 0.08;
  const LONG_FORM_INTERACTION_RELIEF = 0.07;
  const ENTROPY_DENSITY_W = 0.35;
  const ENTROPY_DISSONANCE_W = 0.3;
  const ENTROPY_INTERACTION_W = 0.35;
  const ENTROPY_FLOOR = 0.15;
  const ENTROPY_CEIL = 0.95;
  // R94 E4: Regime-responsive entropy floor. During exploring, raise the
  // entropy floor to ensure minimum entropy diversity even in low-density
  // sections. During coherent, lower it to allow tighter entropy ranges.
  // This creates regime-dependent entropy variety at the intent level,
  // helping recover entropy axis share (collapsed 0.193->0.114 in R93).
  // R18 E2: Raised all floors (exploring 0.22->0.28, evolving 0.20->0.25,
  // coherent 0.12->0.18). Entropy axis share dropped to 0.123 in R17,
  // lowest recent. Higher intent floors prevent entropy from being crushed
  // in any regime, particularly during coherent passages (46.6% of beats).
  const ENTROPY_FLOOR_REGIME = { exploring: 0.28, evolving: 0.25, coherent: 0.18 };

  const CONVERGENCE_BASE = 0.3;
  const CONVERGENCE_ARC_SCALE = 0.35;
  const CONVERGENCE_LATE_SURGE = 0.15;

  // Evolution 2: Per-section CLAP xenolinguistic probes from previous run.
  // alien/organic/chaotic/sparse scores nudge intent targets each section.
  const _clapGuide = (() => {
    try {
      const fs = require('fs');
      const statePath = require('path').join(process.cwd(), 'metrics', 'perceptual-report.json');
      const rep = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const secs = (rep.encodec && rep.encodec.sections) || {};
      const confidence = rep.confidence || 0;
      const guide = {};
      for (const [k, v] of Object.entries(secs)) {
        if (v && v.clap) guide[k] = v.clap;
      }
      return Object.keys(guide).length > 0 ? { guide, confidence } : null;
    } catch { return null; }
  })();

  /** @type {{ densityTarget: number, dissonanceTarget: number, interactionTarget: number, entropyTarget: number, convergenceTarget: number }} */
  let lastIntent = {
    densityTarget: 0.5,
    dissonanceTarget: 0.5,
    interactionTarget: 0.5,
    entropyTarget: 0.5,
    convergenceTarget: 0.5
  };

  /**
   * Compute section intent from timeStream positions.
   * Accepts no arguments - reads section/phrase progress and indices directly.
   */
  function getIntent() {
    const p = clamp(timeStream.compoundProgress('section'), 0, 1);
    const s = timeStream.getPosition('section');
    const totalSections = timeStream.getBounds('section');
    const ph = timeStream.getPosition('phrase');
    const sectionRoute = totalSections > 1 ? s / (totalSections - 1) : 0;
    const longFormPressure = clamp(totalSections - 4, 0, 1);
    // Xenolinguistic L5: cross-run personality contrast. First section opposes previous run's character.
    const personality = hyperMetaManagerState.lastRunPersonality;
    const personalityContrastDensity = s === 0 && personality
      ? (personality.narrative && personality.narrative.includes('dense') ? -0.08 : personality.narrative && personality.narrative.includes('sparse') ? 0.06 : 0)
      : 0;
    // R23 E4 / R24 fix: Piece-route-aware late surge gate. Per-section late surges
    // (interaction, dissonance) taper off in Q3-Q4 of the piece to prevent
    // compounding section-level surges into piece-level overload.
    // R24: Onset moved 0.55->0.70 -- 0.55 suppressed surges too early (sections 3-4),
    // reducing tension buildup and contributing to coherent collapse.
    const lateSurgeGate = clamp(1.0 - (sectionRoute - 0.70) / 0.30, 0, 1);
    const axisEnergyShares = safePreBoot.call(() => conductorSignalBridge.getSignals().axisEnergyShares, null);
    const phaseShare = axisEnergyShares && typeof axisEnergyShares.phase === 'number'
      ? axisEnergyShares.phase
      : 1.0 / 6.0;
    const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const intentRegime = safePreBoot.call(() => conductorSignalBridge.getSignals().regime, 'evolving') || 'evolving';
    const phraseProgress = clamp(timeStream.compoundProgress('phrase'), 0, 1);

    // R35 E3: Asymmetric arc - shift peak later (~62% through piece) for
    // Asymmetric arc: pow(p, 1.15) shifts sine peak to p~0.55 (mid Q2).
    const arc = m.sin(m.pow(p, 1.15) * m.PI);
    const wave = 0.5 + 0.5 * m.sin((p + (s + ph * PHRASE_PHASE_SCALE) * WAVE_PHASE_SPEED) * m.PI * 2);
    const lateLift = clamp((p - 0.58) / 0.42, 0, 1);
    const midSectionPocket = m.sin(clamp((p - 0.18) / 0.64, 0, 1) * m.PI);
    const middleSectionPressure = m.sin(clamp(sectionRoute, 0, 1) * m.PI);
    const longFormRelief = longFormPressure * middleSectionPressure * midSectionPocket * (1 - lowPhasePressure * 0.75);
    // R67 E4: Section-boundary density relief. Brief density dip in the first
    // 8% of each section creates textural breathing space, improving density
    // variance (currently 0.0089) and clarifying section boundaries musically.
    // The dip is gentle (up to 0.12 reduction) and ramps linearly back to full.
    // Only applies after S0 to preserve the opening statement.
    // R69 E1 / R75 E5: Graduate relief depth by section position.
    // S1 gets 6% (protect opening), middle sections 12%, final sections
    // 15% for stronger resolution breathing. R74 densityVariance at 0.0077
    // could benefit from bigger late-section density dips.
    const reliefDepth = s === 1 ? 0.06 : sectionRoute > 0.7 ? 0.15 : 0.12;
    const sectionBoundaryRelief = s > 0 ? clamp(1.0 - (1.0 - p / 0.08) * reliefDepth, 1.0 - reliefDepth, 1.0) : 1.0;

    // Cross-section contrast: bias density, tension, and interaction based on previous section state
    const prevSection = sectionMemory.getPrevious ? sectionMemory.getPrevious() : null;
    const sectionContrastBias = prevSection && Number.isFinite(prevSection.density) ? clamp((prevSection.density - 0.5) * -0.12, -0.06, 0.06) : 0;
    // Regime contrast: exploring-dominant prev -> encourage coherent (denser, less interactive), and vice versa
    const regimeContrastDensity = prevSection && prevSection.regime === 'exploring' ? 0.04 : prevSection && prevSection.regime === 'coherent' ? -0.03 : 0;
    // Coherence learning: if previous section's coherence bias deviated from 1.0, adjust density intent to compensate
    const prevCoherenceBias = prevSection ? V.optionalFinite(prevSection.coherenceBias, 1.0) : 1.0;
    const coherenceLearning = clamp((prevCoherenceBias - 1.0) * 0.08, -0.04, 0.04);

    // Turbulence calming: if previous section had many regime transitions, reduce interaction target for stability
    const prevTransitions = prevSection ? V.optionalFinite(prevSection.regimeTransitionCount, 0) : 0;
    const turbulenceDampen = prevTransitions > 8 ? clamp((prevTransitions - 8) * -0.01, -0.05, 0) : 0;

    const prevBrightness = prevSection ? V.optionalFinite(prevSection.spectralBrightness, 0.5) : 0.5;
    const spectralContrastBias = clamp((prevBrightness - 0.5) * -0.06, -0.03, 0.03);

    // Section phase for intent-aware corrections (used by both density and tension)
    const currentPhase = /** @type {string} */ (safePreBoot.call(() => harmonicContext.getField('sectionPhase'), 'development'));

    // R23: harmonic gravity well - distant keys boost density and dissonance
    const journeyStop = safePreBoot.call(() => harmonicJourney.getStop(s), null);
    const journeyDist = (journeyStop && Number.isFinite(journeyStop.distance)) ? journeyStop.distance : 0;
    const gravityBoost = clamp(journeyDist * 0.025, 0, 0.10);

    const densityTarget = clamp(
      (DENSITY_BASE + arc * DENSITY_ARC_SCALE - lateLift * DENSITY_LATE_TAPER - longFormRelief * LONG_FORM_DENSITY_RELIEF + sectionContrastBias + regimeContrastDensity + coherenceLearning + spectralContrastBias + gravityBoost) * sectionBoundaryRelief
      // R70 E3: Per-phrase density perturbation. Density variance declined
      // steadily (0.0139 -> 0.0100 -> 0.0055) as section-level smoothing
      // dominates. Adding a phrase-level sine wave creates mid-phrase
      // density peaks that inject variance below the section arc level.
      // R72 E3: Phrase-alternating density perturbation. R71 showed that
      // amplifying the smooth sine (0.06->0.10) didn't improve density
      // variance (0.0071->0.0060) -- symmetric per-phrase arches average
      // out. Alternating sign by phrase index creates genuine inter-phrase
      // density contrast: even phrases get +0.08 boost, odd phrases get
      // -0.03 dip, breaking the averaging symmetry.
      // R70 E2: Amplify phrase density perturbation 0.08->0.14 and widen
      // odd-phrase dip -0.4->-0.55. Density variance at 0.0097 (half the
      // 0.019 baseline) needs stronger inter-phrase contrast. Wider amplitude
      // creates genuinely distinct phrase textures.
      + m.sin(phraseProgress * m.PI) * 0.14 * (ph % 2 === 0 ? 1.0 : -0.55) * (1.0 + m.sin(clamp(sectionRoute, 0, 1) * m.PI) * 0.3)
      // Intent-aware density trajectory correction: same phase-gated principle as tension.
      // Prevents monotonic density decline but respects coda/resolution sparsity.
      + (() => {
        const densitySlope = sectionMemory.getDensityTrajectory();
        if (densitySlope >= -0.03) return 0;
        const dPhaseGate = currentPhase === 'coda' || currentPhase === 'conclusion' ? 0.15
          : currentPhase === 'climax' ? 1.3 : 1.0;
        return clamp(-densitySlope * 0.12 * dPhaseGate, 0, 0.06);
      })(),
      0,
      1
    );
    // Cross-section tension contrast: if previous section had high tension, bias this one lower
    const tensionContrastBias = prevSection && Number.isFinite(prevSection.tension) ? clamp((prevSection.tension - 0.85) * -0.10, -0.05, 0.05) : 0;
    // Tension learning: if previous section overshot its dissonance target, pull lower
    const prevIntentTension = prevSection ? V.optionalFinite(prevSection.intentTension, 0.5) : 0.5;
    const prevActualTension = prevSection && Number.isFinite(prevSection.tension) ? prevSection.tension : 0.85;
    const tensionLearning = clamp((prevActualTension - prevIntentTension) * -0.06, -0.03, 0.03);
    // Intent-aware trajectory correction: push tension back up when declining,
    // but respect phases where low tension is intentional (resolution/coda).
    // During resolution/conclusion/coda, suppresses correction since tension
    // SHOULD decline. During development/climax, strengthens it.
    const tensionSlope = sectionMemory.getTensionTrajectory();
    const phaseIntentGate = currentPhase === 'resolution' || currentPhase === 'conclusion' || currentPhase === 'coda'
      ? 0.4
      : currentPhase === 'climax' ? 1.5
      : currentPhase === 'development' ? 1.2
      : 1.0;
    const trajectoryCorrection = tensionSlope < -0.04 ? clamp(-tensionSlope * 0.20 * phaseIntentGate, 0, 0.12) : 0;

    // Xenolinguistic L1: feedback pitch complement bleeds into dissonance target.
    // Active sub-harmonic feedback = slight dissonance pull (sub-conscious tension).
    const feedbackPitchEntry = L0.getLast('feedbackPitch', { layer: 'both' });
    const feedbackDissonancePull = feedbackPitchEntry && Number.isFinite(feedbackPitchEntry.pitchClass) ? 0.03 : 0;
    const dissonanceTarget = clamp(
      DISSONANCE_BASE + (DISSONANCE_WAVE_BASE + wave * DISSONANCE_WAVE_SCALE) * arc + lateLift * DISSONANCE_LATE_SURGE * lateSurgeGate - longFormRelief * LONG_FORM_DISSONANCE_RELIEF + tensionContrastBias + tensionLearning + trajectoryCorrection + gravityBoost * 0.7 + feedbackDissonancePull
      // R70 E5: Section-route dissonance escalation. Middle sections get
      // more dissonance (up to +0.08) than edge sections, creating harmonic
      // contrast across the piece. This complements the per-section key
      // changes with varying harmonic tension density.
      + m.sin(clamp(sectionRoute, 0, 1) * m.PI) * 0.08,
      0,
      1
    );
    // Real-time regime transition settling: if a transition happened recently, moderate interaction to let system settle
    const recentTransitions = L0.count('regimeTransition', { since: beatStartTime - 5, windowSeconds: 5 });
    const transitionSettling = recentTransitions > 2 ? clamp((recentTransitions - 2) * -0.02, -0.06, 0) : 0;

    // Cross-section flicker contrast: if previous section had high flicker, bias interaction lower for textural contrast
    const flickerContrastBias = prevSection && Number.isFinite(prevSection.flicker) ? clamp((prevSection.flicker - 1.0) * -0.08, -0.04, 0.04) : 0;
    const interactionTarget = clamp(
      INTERACTION_BASE + (INTERACTION_WAVE_BASE + wave * INTERACTION_WAVE_SCALE) * (INTERACTION_ARC_BASE + arc * INTERACTION_ARC_SCALE) + lateLift * INTERACTION_LATE_SURGE * lateSurgeGate - longFormRelief * LONG_FORM_INTERACTION_RELIEF + flickerContrastBias + turbulenceDampen + transitionSettling,
      0,
      1
    );
    // R94 E4: Apply regime-responsive entropy floor
    const effectiveEntropyFloor = V.optionalFinite(ENTROPY_FLOOR_REGIME[intentRegime], ENTROPY_FLOOR);
    // Independent entropy arc: entropy peaks mid-section with wave modulation for variety
    const independentEntropyArc = 0.4 + arc * 0.25 + wave * 0.1;
    const blendedEntropy = (densityTarget * ENTROPY_DENSITY_W) + (dissonanceTarget * ENTROPY_DISSONANCE_W) + (interactionTarget * ENTROPY_INTERACTION_W);
    const entropyTarget = clamp(blendedEntropy * 0.6 + independentEntropyArc * 0.4, effectiveEntropyFloor, ENTROPY_CEIL);
    // R37: mid-section self-evaluation -- at halfway phrase, assess trajectory
    // and post quality bias if the section is declining. Piece adjusts its own
    // dramatic arc mid-stream.
    const totalPhrases = timeStream.getBounds('phrase');
    const halfPhrase = m.floor(totalPhrases / 2);
    if (ph === halfPhrase && p > 0.3 && p < 0.7) {
      const midTensionSlope = sectionMemory.getTensionTrajectory();
      const midSignals = safePreBoot.call(() => conductorSignalBridge.getSignals(), null);
      const midRegime = midSignals ? midSignals.regime || 'evolving' : 'evolving';
      if (midTensionSlope < -0.1 && midRegime !== 'coherent') {
        L0.post('section-quality', 'both', beatStartTime, { quality: 0.35, bias: 0.08 });
      }
      // R38: coupling decay predictor -- rapid coupling decay boosts convergence
      const midCoupling = midSignals && typeof midSignals.couplingStrength === 'number' ? midSignals.couplingStrength : 0.3;
      const prevCouplingEntry = L0.getLast('climax-pressure', { layer: 'both' });
      const prevCoupling = prevCouplingEntry && Number.isFinite(prevCouplingEntry.level) ? prevCouplingEntry.level : midCoupling;
      const couplingTrend = midCoupling - prevCoupling;
      if (couplingTrend < -0.05) {
        L0.post('section-quality', 'both', beatStartTime, {
          quality: 0.3, bias: clamp(m.abs(couplingTrend) * 0.5, 0, 0.10)
        });
      }
    }
    // R33: quality feed-forward via L0 -- only applies during first phrase or mid-eval
    const sectionStart = ph === 0 || ph === halfPhrase;
    const qualityEntry = sectionStart ? L0.getLast('section-quality', { layer: 'both' }) : null;
    const qBias = qualityEntry && Number.isFinite(qualityEntry.bias) ? qualityEntry.bias : 0;
    // Xenolinguistic L2: observation effect. System reads its own exceedance trend
    // and self-corrects convergence target. Measurement changes behavior.
    const bridgeSigs = conductorSignalBridge.getSignals();
    const exceedanceObs = V.optionalFinite(bridgeSigs.exceedanceTrendEma, 0);
    const observationConvergenceBoost = exceedanceObs > 0.3 ? clamp((exceedanceObs - 0.3) * 0.15, 0, 0.06) : 0;
    const convergenceTarget = clamp(CONVERGENCE_BASE + arc * CONVERGENCE_ARC_SCALE + lateLift * CONVERGENCE_LATE_SURGE + middleSectionPressure * 0.1 + qBias * 0.8 + observationConvergenceBoost, 0, 1);
    // CLAP guidance: previous run's section character nudges this run's intent.
    // High alien -> moderate dissonance (section already xenolinguistic, ease off).
    // High organic -> boost dissonance (push toward tension). High chaotic ->
    // reduce interaction. High sparse -> boost density. +-0.06 max at full confidence.
    let clapDensityNudge = 0, clapDissonanceNudge = 0, clapInteractionNudge = 0;
    if (_clapGuide && _clapGuide.confidence >= 0.10) {
      const clapStr = clamp((_clapGuide.confidence - 0.10) / 0.20, 0, 1);
      const secClap = _clapGuide.guide[String(s)];
      if (secClap) {
        if (Number.isFinite(secClap.alien))   clapDissonanceNudge -= clamp(secClap.alien * 0.30 * clapStr, 0, 0.06);
        if (Number.isFinite(secClap.organic)) clapDissonanceNudge += clamp(secClap.organic * 0.35 * clapStr, 0, 0.06);
        if (Number.isFinite(secClap.chaotic)) clapInteractionNudge -= clamp(secClap.chaotic * 0.25 * clapStr, 0, 0.05);
        if (Number.isFinite(secClap.sparse))  clapDensityNudge += clamp(secClap.sparse * 0.40 * clapStr, 0, 0.06);
      }
    }
    const adjustedDensity = clamp(densityTarget + qBias * -0.5 + personalityContrastDensity + clapDensityNudge, 0, 1);
    const adjustedDissonance = clamp(dissonanceTarget + clapDissonanceNudge, 0, 1);
    const adjustedInteraction = clamp(interactionTarget + clapInteractionNudge, 0, 1);

    lastIntent = { densityTarget: adjustedDensity, dissonanceTarget: adjustedDissonance, interactionTarget: adjustedInteraction, entropyTarget, convergenceTarget };
    return lastIntent;
  }

  function getLastIntent() {
    return lastIntent;
  }

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
    lastIntent = {
      densityTarget: 0.5,
      dissonanceTarget: 0.5,
      interactionTarget: 0.5,
      entropyTarget: 0.5,
      convergenceTarget: 0.5
    };
  }

  return { getIntent, getLastIntent, setManualIntent, reset };
})();
crossLayerRegistry.register('sectionIntentCurves', sectionIntentCurves, ['all']);
