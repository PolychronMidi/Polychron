sectionIntentCurves = (() => {
  const V = validator.create('sectionIntentCurves');

  // Intent curve shaping constants
  const PHRASE_PHASE_SCALE = 0.3;     // phrase contribution to wave phase
  const WAVE_PHASE_SPEED = 0.07;      // section+phrase modulation speed
  const DENSITY_BASE = 0.33;
  const DENSITY_ARC_SCALE = 0.55;
  const DISSONANCE_BASE = 0.2;
  const DISSONANCE_WAVE_BASE = 0.35;
  const DISSONANCE_WAVE_SCALE = 0.45;
  const INTERACTION_BASE = 0.2;
  const INTERACTION_WAVE_BASE = 0.25;
  const INTERACTION_WAVE_SCALE = 0.55;
  const INTERACTION_ARC_BASE = 0.5;
  const INTERACTION_ARC_SCALE = 0.5;
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
    const ph = timeStream.getPosition('phrase');

    // R35 E3: Asymmetric arc - shift peak later (~62% through piece) for
    // building tension with late climax. pow(p, 0.8) skews the sine peak.
    const arc = m.sin(m.pow(p, 0.8) * m.PI);
    const wave = 0.5 + 0.5 * m.sin((p + (s + ph * PHRASE_PHASE_SCALE) * WAVE_PHASE_SPEED) * m.PI * 2);

    const densityTarget = clamp(DENSITY_BASE + arc * DENSITY_ARC_SCALE, 0, 1);
    const dissonanceTarget = clamp(DISSONANCE_BASE + (DISSONANCE_WAVE_BASE + wave * DISSONANCE_WAVE_SCALE) * arc, 0, 1);
    const interactionTarget = clamp(INTERACTION_BASE + (INTERACTION_WAVE_BASE + wave * INTERACTION_WAVE_SCALE) * (INTERACTION_ARC_BASE + arc * INTERACTION_ARC_SCALE), 0, 1);
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
