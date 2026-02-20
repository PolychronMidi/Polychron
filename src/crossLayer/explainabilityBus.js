ExplainabilityBus = (() => {
  const V = Validator.create('ExplainabilityBus');
  const MAX_ENTRIES = 600;
  const CHANNEL = 'explainability';
  /** @type {Array<{ type: string, layer: string, payload: any, absTimeMs: number }>} */
  const entries = [];

  /**
   * @param {string} type
   * @param {string} layer
   * @param {any} payload
   * @param {number} [absTimeMs]
   */
  function emit(type, layer, payload, absTimeMs) {
    V.assertNonEmptyString(type, 'type');
    let t = 0;
    if (Number.isFinite(absTimeMs)) {
      t = Number(absTimeMs);
    } else if (Number.isFinite(beatStartTime)) {
      t = Number(beatStartTime) * 1000;
    } else {
      t = 0;
    }

    const entry = { type, layer: typeof layer === 'string' ? layer : 'L?', payload, absTimeMs: t };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();

    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') {
      EventBus.emit('CROSS_LAYER_EXPLAIN', entry);
    }
    if (typeof AbsoluteTimeGrid !== 'undefined' && AbsoluteTimeGrid && typeof AbsoluteTimeGrid.post === 'function') {
      AbsoluteTimeGrid.post(CHANNEL, entry.layer, t, { type, payload });
    }

    return entry;
  }

  /** @param {number} [limit=50] */
  function getRecent(limit) {
    const lim = Number.isFinite(limit) ? Math.max(1, Math.floor(Number(limit))) : 50;
    return entries.slice(-lim);
  }

  /** @param {number} sinceMs */
  function querySince(sinceMs) {
    V.requireFinite(sinceMs, 'sinceMs');
    return entries.filter(e => e.absTimeMs >= sinceMs);
  }

  function reset() {
    entries.length = 0;
  }

  return { emit, getRecent, querySince, reset };
})();
CrossLayerRegistry.register('ExplainabilityBus', ExplainabilityBus, ['all', 'section']);
