SectionIntentCurves = (() => {
  const V = Validator.create('SectionIntentCurves');
  /** @type {{ densityTarget: number, dissonanceTarget: number, interactionTarget: number, entropyTarget: number }} */
  let lastIntent = {
    densityTarget: 0.5,
    dissonanceTarget: 0.5,
    interactionTarget: 0.5,
    entropyTarget: 0.5
  };

  /**
   * @param {number} sectionProgress - 0..1
   * @param {number} [sectionIdx=0]
   * @param {number} [phraseIdx=0]
   */
  function getIntent(sectionProgress, sectionIdx, phraseIdx) {
    const p = clamp(Number.isFinite(sectionProgress) ? sectionProgress : 0.5, 0, 1);
    const s = Number.isFinite(sectionIdx) ? Number(sectionIdx) : 0;
    const ph = Number.isFinite(phraseIdx) ? Number(phraseIdx) : 0;

    const arc = Math.sin(p * Math.PI);
    const wave = 0.5 + 0.5 * Math.sin((p + (s + ph * 0.3) * 0.07) * Math.PI * 2);

    const densityTarget = clamp(0.25 + arc * 0.55, 0, 1);
    const dissonanceTarget = clamp(0.2 + (0.35 + wave * 0.45) * arc, 0, 1);
    const interactionTarget = clamp(0.2 + (0.25 + wave * 0.55) * (0.5 + arc * 0.5), 0, 1);
    const entropyTarget = clamp((densityTarget * 0.35) + (dissonanceTarget * 0.3) + (interactionTarget * 0.35), 0.15, 0.95);

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
      densityTarget: clamp(Number(intent.densityTarget ?? lastIntent.densityTarget), 0, 1),
      dissonanceTarget: clamp(Number(intent.dissonanceTarget ?? lastIntent.dissonanceTarget), 0, 1),
      interactionTarget: clamp(Number(intent.interactionTarget ?? lastIntent.interactionTarget), 0, 1),
      entropyTarget: clamp(Number(intent.entropyTarget ?? lastIntent.entropyTarget), 0, 1)
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
CrossLayerRegistry.register('SectionIntentCurves', SectionIntentCurves, ['all']);
