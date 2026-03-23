sectionIntentCurves = (() => {
  const V = validator.create('sectionIntentCurves');

  // Intent curve shaping constants
  const PHRASE_PHASE_SCALE = 0.3;     // phrase contribution to wave phase
  const WAVE_PHASE_SPEED = 0.07;      // section+phrase modulation speed
  const DENSITY_BASE = 0.33;
  const DENSITY_ARC_SCALE = 0.55;
  const DENSITY_LATE_TAPER = 0.12;
  const DISSONANCE_BASE = 0.2;
  const DISSONANCE_WAVE_BASE = 0.35;
  const DISSONANCE_WAVE_SCALE = 0.45;
  const DISSONANCE_LATE_SURGE = 0.10;
  const INTERACTION_BASE = 0.2;
  const INTERACTION_WAVE_BASE = 0.25;
  const INTERACTION_WAVE_SCALE = 0.55;
  const INTERACTION_ARC_BASE = 0.5;
  const INTERACTION_ARC_SCALE = 0.5;
  const INTERACTION_LATE_SURGE = 0.12;
  const LONG_FORM_DENSITY_RELIEF = 0.10;
  const LONG_FORM_DISSONANCE_RELIEF = 0.08;
  const LONG_FORM_INTERACTION_RELIEF = 0.07;
  const ENTROPY_DENSITY_W = 0.35;
  const ENTROPY_DISSONANCE_W = 0.3;
  const ENTROPY_INTERACTION_W = 0.35;
  const ENTROPY_FLOOR = 0.15;
  const ENTROPY_CEIL = 0.95;

  /** @type {{ densityTarget: number, dissonanceTarget: number, interactionTarget: number, entropyTarget: number }} */
  let lastIntent = {
    densityTarget: 0.5,
    dissonanceTarget: 0.5,
    interactionTarget: 0.5,
    entropyTarget: 0.5
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
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);

    // R35 E3: Asymmetric arc - shift peak later (~62% through piece) for
    // building tension with late climax. pow(p, 0.8) skews the sine peak.
    const arc = m.sin(m.pow(p, 0.8) * m.PI);
    const wave = 0.5 + 0.5 * m.sin((p + (s + ph * PHRASE_PHASE_SCALE) * WAVE_PHASE_SPEED) * m.PI * 2);
    const lateLift = clamp((p - 0.58) / 0.42, 0, 1);
    const midSectionPocket = m.sin(clamp((p - 0.18) / 0.64, 0, 1) * m.PI);
    const middleSectionPressure = m.sin(clamp(sectionRoute, 0, 1) * m.PI);
    const longFormRelief = longFormPressure * middleSectionPressure * midSectionPocket * (1 - lowPhasePressure * 0.75);

    const densityTarget = clamp(
      DENSITY_BASE + arc * DENSITY_ARC_SCALE - lateLift * DENSITY_LATE_TAPER - longFormRelief * LONG_FORM_DENSITY_RELIEF,
      0,
      1
    );
    const dissonanceTarget = clamp(
      DISSONANCE_BASE + (DISSONANCE_WAVE_BASE + wave * DISSONANCE_WAVE_SCALE) * arc + lateLift * DISSONANCE_LATE_SURGE - longFormRelief * LONG_FORM_DISSONANCE_RELIEF,
      0,
      1
    );
    const interactionTarget = clamp(
      INTERACTION_BASE + (INTERACTION_WAVE_BASE + wave * INTERACTION_WAVE_SCALE) * (INTERACTION_ARC_BASE + arc * INTERACTION_ARC_SCALE) + lateLift * INTERACTION_LATE_SURGE - longFormRelief * LONG_FORM_INTERACTION_RELIEF,
      0,
      1
    );
    const entropyTarget = clamp((densityTarget * ENTROPY_DENSITY_W) + (dissonanceTarget * ENTROPY_DISSONANCE_W) + (interactionTarget * ENTROPY_INTERACTION_W), ENTROPY_FLOOR, ENTROPY_CEIL);

    lastIntent = { densityTarget, dissonanceTarget, interactionTarget, entropyTarget };
    return lastIntent;
  }

  function getLastIntent() {
    return lastIntent;
  }

  /** @param {{ densityTarget?: number, dissonanceTarget?: number, interactionTarget?: number, entropyTarget?: number }} intent */
  function setManualIntent(intent) {
    V.assertObject(intent, 'intent');
    lastIntent = {
      densityTarget: clamp(V.optionalFinite(intent.densityTarget, lastIntent.densityTarget), 0, 1),
      dissonanceTarget: clamp(V.optionalFinite(intent.dissonanceTarget, lastIntent.dissonanceTarget), 0, 1),
      interactionTarget: clamp(V.optionalFinite(intent.interactionTarget, lastIntent.interactionTarget), 0, 1),
      entropyTarget: clamp(V.optionalFinite(intent.entropyTarget, lastIntent.entropyTarget), 0, 1)
    };
    return lastIntent;
  }

  function reset() {
    lastIntent = {
      densityTarget: 0.5,
      dissonanceTarget: 0.5,
      interactionTarget: 0.5,
      entropyTarget: 0.5
    };
  }

  return { getIntent, getLastIntent, setManualIntent, reset };
})();
crossLayerRegistry.register('sectionIntentCurves', sectionIntentCurves, ['all']);
