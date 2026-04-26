moduleLifecycle.declare({
  name: 'explainabilityBus',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['explainabilityBus'],
  crossLayerScopes: ['all', 'section'],
  init: (deps) => {
  const V = deps.validator.create('explainabilityBus');
  const MAX_ENTRIES = 600;
  const EVICT_BATCH = 100; // amortize O(n) splice cost over many emit calls
  const CHANNEL = 'explainability';
  /** @type {Array<{ type: string, layer: string, payload: any, absoluteSeconds: number }>} */
  const entries = [];

  /**
   * @param {string} type
   * @param {string} layer
   * @param {any} payload
   * @param {number} [absoluteSeconds]
   * @param {string} [cause]
   */
  function emit(type, layer, payload, absoluteSeconds, cause) {
    V.assertNonEmptyString(type, 'type');
    V.assertNonEmptyString(layer, 'layer');
    let t = 0;
    if (Number.isFinite(absoluteSeconds)) {
      t = Number(absoluteSeconds);
    } else {
      t = beatStartTime;
    }
    const entry = { type, layer, payload, absoluteSeconds: t, cause: cause || null };
    entries.push(entry);
    // Batch evict: let buffer grow past capacity, then splice once - avoids O(n) shift per emit
    if (entries.length > MAX_ENTRIES + EVICT_BATCH) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }

    L0.post(CHANNEL, entry.layer, t, { type, payload, cause: cause || null });

    return entry;
  }

  /** @param {number} [limit=50] */
  function getRecent(limit) {
    const lim = m.max(1, m.floor(V.optionalFinite(limit, 50)));
    return entries.slice(-lim);
  }

  /** @param {number} sinceSec */
  function querySince(sinceSec) {
    V.requireFinite(sinceSec, 'sinceSec');
    return entries.filter(e => e.absoluteSeconds >= sinceSec);
  }

  /**
   * Return entries matching a specific type, most recent first.
   * @param {string} type - event type to filter on
   * @param {number} [limit=20] max entries to return
   * @returns {Array<{ type: string, layer: string, payload: any, absoluteSeconds: number }>}
   */
  function queryByType(type, limit) {
    V.assertNonEmptyString(type, 'type');
    const lim = m.max(1, m.floor(V.optionalFinite(limit, 20)));
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
  },
});
