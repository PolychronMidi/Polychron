// Section intent curve helpers -- CLAP guidance, section contrast biases, mid-section self-eval.
// Loaded before sectionIntentCurves.js via subsystem index.js.

sectionIntentCurvesHelpers = (() => {
  const V = validator.create('sectionIntentCurvesHelpers');

  // Per-section CLAP xenolinguistic probes from previous run.
  // alien/organic/chaotic/sparse scores nudge intent targets each section.
  const _clapGuide = (() => {
    try {
      const fs = require('fs');
      const statePath = require('path').join(METRICS_DIR, 'perceptual-report.json');
      const rep = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const secs = (rep.encodec && rep.encodec.sections) ?? {};
      const confidence = rep.confidence ?? 0;
      const guide = {};
      for (const [k, v] of Object.entries(secs)) {
        if (v && v.clap) guide[k] = v.clap;
      }
      return Object.keys(guide).length > 0 ? { guide, confidence } : null;
    } catch { return null; }
  })();

  /**
   * Compute CLAP-driven nudges for density, dissonance, interaction.
   * @param {number} sectionIdx
   * @returns {{ density: number, dissonance: number, interaction: number }}
   */
  function getClapNudges(sectionIdx) {
    let density = 0, dissonance = 0, interaction = 0;
    if (!_clapGuide || _clapGuide.confidence < 0.10) return { density, dissonance, interaction };
    const clapStr = clamp((_clapGuide.confidence - 0.10) / 0.20, 0, 1);
    const secClap = _clapGuide.guide[String(sectionIdx)];
    if (!secClap) return { density, dissonance, interaction };
    if (Number.isFinite(secClap.alien)) {
      if (secClap.alien > 0.45) {
        dissonance -= clamp((secClap.alien - 0.45) * 0.40 * clapStr, 0, 0.04);
      } else {
        dissonance += clamp(secClap.alien * 0.20 * clapStr, 0, 0.04);
      }
    }
    if (Number.isFinite(secClap.organic) && secClap.organic > 0.25)
      dissonance += clamp((secClap.organic - 0.25) * 0.35 * clapStr, 0, 0.05);
    if (Number.isFinite(secClap.chaotic))
      interaction -= clamp(secClap.chaotic * 0.25 * clapStr, 0, 0.05);
    if (Number.isFinite(secClap.sparse))
      density += clamp(secClap.sparse * 0.40 * clapStr, -0.06, 0.06);
    return { density, dissonance, interaction };
  }

  /**
   * Cross-section contrast biases from previous section memory.
   * @returns {{ densityContrast: number, regimeContrast: number, coherenceLearning: number, turbulenceDampen: number, spectralContrast: number, tensionContrast: number, tensionLearning: number, flickerContrast: number }}
   */
  function getSectionContrastBiases() {
    const prev = sectionMemory.getPrevious ? sectionMemory.getPrevious() : null;
    const densityContrast = prev && Number.isFinite(prev.density) ? clamp((prev.density - 0.5) * -0.12, -0.06, 0.06) : 0;
    const regimeContrast = prev && prev.regime === 'exploring' ? 0.04 : prev && prev.regime === 'coherent' ? -0.03 : 0;
    const prevCoherenceBias = prev ? V.optionalFinite(prev.coherenceBias, 1.0) : 1.0;
    const coherenceLearning = clamp((prevCoherenceBias - 1.0) * 0.08, -0.04, 0.04);
    const prevTransitions = prev ? V.optionalFinite(prev.regimeTransitionCount, 0) : 0;
    const turbulenceDampen = prevTransitions > 8 ? clamp((prevTransitions - 8) * -0.01, -0.05, 0) : 0;
    const prevBrightness = prev ? V.optionalFinite(prev.spectralBrightness, 0.5) : 0.5;
    const spectralContrast = clamp((prevBrightness - 0.5) * -0.06, -0.03, 0.03);
    const tensionContrast = prev && Number.isFinite(prev.tension) ? clamp((prev.tension - 0.85) * -0.10, -0.05, 0.05) : 0;
    const prevIntentTension = prev ? V.optionalFinite(prev.intentTension, 0.5) : 0.5;
    const prevActualTension = prev && Number.isFinite(prev.tension) ? prev.tension : 0.85;
    const tensionLearning = clamp((prevActualTension - prevIntentTension) * -0.06, -0.03, 0.03);
    const flickerContrast = prev && Number.isFinite(prev.flicker) ? clamp((prev.flicker - 1.0) * -0.08, -0.04, 0.04) : 0;
    return { densityContrast, regimeContrast, coherenceLearning, turbulenceDampen, spectralContrast, tensionContrast, tensionLearning, flickerContrast };
  }

  /**
   * Mid-section self-evaluation: post quality bias if section is declining.
   * @param {number} ph - phrase index
   * @param {number} p - compound section progress
   * @param {number} totalPhrases
   */
  function midSectionEval(ph, p, totalPhrases) {
    const halfPhrase = m.floor(totalPhrases / 2);
    if (ph !== halfPhrase || p <= 0.3 || p >= 0.7) return;
    const midTensionSlope = sectionMemory.getTensionTrajectory();
    const midSignals = safePreBoot.call(() => conductorSignalBridge.getSignals(), null);
    const midRegime = midSignals ? midSignals.regime || 'evolving' : 'evolving';
    if (midTensionSlope < -0.1 && midRegime !== 'coherent') {
      L0.post(L0_CHANNELS.sectionQuality, 'both', beatStartTime, { quality: 0.35, bias: 0.08 });
    }
    const midCoupling = midSignals && typeof midSignals.couplingStrength === 'number' ? midSignals.couplingStrength : 0.3;
    const prevCouplingEntry = L0.getLast(L0_CHANNELS.climaxPressure, { layer: 'both' });
    const prevCoupling = prevCouplingEntry && Number.isFinite(prevCouplingEntry.level) ? prevCouplingEntry.level : midCoupling;
    const couplingTrend = midCoupling - prevCoupling;
    if (couplingTrend < -0.05) {
      L0.post(L0_CHANNELS.sectionQuality, 'both', beatStartTime, {
        quality: 0.3, bias: clamp(m.abs(couplingTrend) * 0.5, 0, 0.10)
      });
    }
  }

  return { getClapNudges, getSectionContrastBiases, midSectionEval };
})();
