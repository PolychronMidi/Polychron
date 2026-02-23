ExplainabilityBus = (() => {
  const V = Validator.create('explainabilityBus');
  const MAX_ENTRIES = 600;
  const EVICT_BATCH = 100; // amortize O(n) splice cost over many emit calls
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
    } else {
      t = beatStartTime * 1000;
    }

    V.assertNonEmptyString(layer, 'layer');
    const entry = { type, layer, payload, absTimeMs: t };
    entries.push(entry);
    // Batch evict: let buffer grow past capacity, then splice once — avoids O(n) shift per emit
    if (entries.length > MAX_ENTRIES + EVICT_BATCH) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }

    AbsoluteTimeGrid.post(CHANNEL, entry.layer, t, { type, payload });

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

  /**
   * Return entries matching a specific type, most recent first.
   * @param {string} type — event type to filter on
   * @param {number} [limit=20] max entries to return
   * @returns {Array<{ type: string, layer: string, payload: any, absTimeMs: number }>}
   */
  function queryByType(type, limit) {
    V.assertNonEmptyString(type, 'type');
    const lim = Number.isFinite(limit) ? Math.max(1, Math.floor(Number(limit))) : 20;
    const out = [];
    for (let i = entries.length - 1; i >= 0 && out.length < lim; i--) {
      if (entries[i].type === type) out.push(entries[i]);
    }
    return out;
  }

  function reset() {
    entries.length = 0;
  }

  return { emit, getRecent, querySince, queryByType, reset };
})();
CrossLayerRegistry.register('ExplainabilityBus', ExplainabilityBus, ['all', 'section']);
