EmissionFeedbackListener = (() => {
  const { getEventsOrThrow } = Validator;

  let initialized = false;
  let ratio = 1;
  const decayRate = 0.85;
  let lastActual = 0;
  let lastIntended = 0;

  function initialize() {
    if (initialized) return;
    if (typeof EventBus === 'undefined' || !EventBus || typeof EventBus.on !== 'function') {
      throw new Error('EmissionFeedbackListener.initialize: EventBus not available');
    }
    const EVENTS = getEventsOrThrow('EmissionFeedbackListener');

    EventBus.on(EVENTS.NOTES_EMITTED, (data) => {
      if (!data || typeof data !== 'object') {
        throw new Error('EmissionFeedbackListener: invalid notes-emitted payload');
      }
      const actual = Number(data.actual);
      const intended = Number(data.intended);
      if (!Number.isFinite(actual) || !Number.isFinite(intended) || intended < 0 || actual < 0) {
        throw new Error('EmissionFeedbackListener: actual/intended must be finite non-negative numbers');
      }

      const safeIntended = m.max(1, intended);
      const currentRatio = clamp(actual / safeIntended, 0, 2);
      ratio = clamp(ratio * decayRate + currentRatio * (1 - decayRate), 0, 2);
      lastActual = actual;
      lastIntended = intended;
    });

    EventBus.on(EVENTS.SECTION_BOUNDARY, () => {
      ratio = 1;
      lastActual = 0;
      lastIntended = 0;
    });

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
    reset
  };
})();
