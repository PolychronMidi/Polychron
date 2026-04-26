moduleLifecycle.declare({
  name: 'emissionFeedbackListener',
  subsystem: 'rhythm',
  deps: ['validator'],
  provides: ['emissionFeedbackListener'],
  init: (deps) => {
  const V = deps.validator.create('emissionFeedbackListener');

  let initialized = false;
  // Per-layer emission tracking prevents L1's emission ratio from biasing L2
  const ratioByLayer = { L1: 1, L2: 1 };
  const lastActualByLayer = { L1: 0, L2: 0 };
  const lastIntendedByLayer = { L1: 0, L2: 0 };
  const decayRate = 0.85;

  function initialize() {
    if (initialized) return;
    V.requireDefined(eventBus, 'eventBus');
    const EVENTS = V.getEventsOrThrow();

    eventBus.on(EVENTS.NOTES_EMITTED, (data) => {
      V.assertObject(data, 'notes-emitted payload');
      const actual = V.requireFinite(data.actual, 'notes-emitted.actual');
      const intended = V.requireFinite(data.intended, 'notes-emitted.intended');
      if (intended < 0 || actual < 0) {
        throw new Error('emissionFeedbackListener: actual/intended must be non-negative numbers');
      }

      const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
      const safeIntended = m.max(1, intended);
      const currentRatio = clamp(actual / safeIntended, 0, 2);
      ratioByLayer[layer] = clamp(ratioByLayer[layer] * decayRate + currentRatio * (1 - decayRate), 0, 2);
      lastActualByLayer[layer] = actual;
      lastIntendedByLayer[layer] = intended;
    });

    crossLayerRegistry.register('emissionFeedbackListener', { reset: resetSection }, ['section']);
    initialized = true;
  }

  function getEmissionRatio() {
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    return clamp(ratioByLayer[layer], 0, 2);
  }

  function getEmissionGap() {
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    return clamp(1 - ratioByLayer[layer], -1, 1);
  }

  function getMetrics() {
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    return {
      ratio: clamp(ratioByLayer[layer], 0, 2),
      lastActual: lastActualByLayer[layer],
      lastIntended: lastIntendedByLayer[layer]
    };
  }

  function resetSection() {
    ratioByLayer.L1 = 1; ratioByLayer.L2 = 1;
    lastActualByLayer.L1 = 0; lastActualByLayer.L2 = 0;
    lastIntendedByLayer.L1 = 0; lastIntendedByLayer.L2 = 0;
  }

  function reset() {
    ratioByLayer.L1 = 1; ratioByLayer.L2 = 1;
    lastActualByLayer.L1 = 0; lastActualByLayer.L2 = 0;
    lastIntendedByLayer.L1 = 0; lastIntendedByLayer.L2 = 0;
  }


  moduleLifecycle.registerInitializer('emissionFeedbackListener', initialize);
  return {
    initialize,
    getEmissionRatio,
    getEmissionGap,
    getMetrics,
    reset,
    resetSection
  };
  },
});
