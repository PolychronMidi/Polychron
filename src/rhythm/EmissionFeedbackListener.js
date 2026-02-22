EmissionFeedbackListener = (() => {
  const V = Validator.create('EmissionFeedbackListener');

  let initialized = false;
  let ratio = 1;
  const decayRate = 0.85;
  let lastActual = 0;
  let lastIntended = 0;

  function initialize() {
    if (initialized) return;
    V.requireDefined(EventBus, 'EventBus');
    const EVENTS = V.getEventsOrThrow();

    EventBus.on(EVENTS.NOTES_EMITTED, (data) => {
      V.assertObject(data, 'notes-emitted payload');
      const actual = V.requireFinite(data.actual, 'notes-emitted.actual');
      const intended = V.requireFinite(data.intended, 'notes-emitted.intended');
      if (intended < 0 || actual < 0) {
        throw new Error('EmissionFeedbackListener: actual/intended must be non-negative numbers');
      }

      const safeIntended = m.max(1, intended);
      const currentRatio = clamp(actual / safeIntended, 0, 2);
      ratio = clamp(ratio * decayRate + currentRatio * (1 - decayRate), 0, 2);
      lastActual = actual;
      lastIntended = intended;
    });

    CrossLayerRegistry.register('EmissionFeedbackListener', { reset: resetSection }, ['section']);
    initialized = true;
  }

  function getEmissionRatio() {
    return clamp(ratio, 0, 2);
  }

  function getEmissionGap() {
    return clamp(1 - ratio, -1, 1);
  }

  function getMetrics() {
    return {
      ratio: clamp(ratio, 0, 2),
      lastActual,
      lastIntended
    };
  }

  function resetSection() {
    ratio = 1;
    lastActual = 0;
    lastIntended = 0;
  }

  function reset() {
    ratio = 1;
    lastActual = 0;
    lastIntended = 0;
  }

  return {
    initialize,
    getEmissionRatio,
    getEmissionGap,
    getMetrics,
    reset,
    resetSection
  };
})();
