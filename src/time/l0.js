// src/time/L0.js - Unified in-memory temporal layer (L0).
// Replaces absoluteTimeGrid and absoluteTimeWindow with a single flat-array
// buffer per channel. Never pruned - the composition run is finite and bounded.

L0 = (() => {
  const V = validator.create('l0');

  /**
   * Per-channel flat arrays of entries.
   * Each entry shape: { timeInSeconds, channel, layer, ...payload }
   * @type {Object.<string, Array<Object>>}
   */
  const channels = {};

  /** Query result cache. Invalidated on every post(). */
  /** @type {Map<string, Array<Object>>} */
  const queryCache = new Map();

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function ensureChannel(name) {
    if (!channels[name]) channels[name] = [];
    return channels[name];
  }

  function invalidateCache() {
    if (queryCache.size > 0) queryCache.clear();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Post an event to L0.
   * @param {string} channel - data domain (e.g. 'note', 'chord', 'binaural')
   * @param {string} layer   - source layer (e.g. 'L1', 'L2')
   * @param {number} timeInSeconds - absolute seconds from piece start
   * @param {Object} [data]  - arbitrary payload
   */
  function post(channel, layer, timeInSeconds, data) {
    V.assertNonEmptyString(channel, 'post.channel');
    V.assertNonEmptyString(layer, 'post.layer');
    const t = V.requireFinite(timeInSeconds, 'post.timeInSeconds');
    if (data !== undefined) V.assertPlainObject(data, 'post.data');

    const arr = ensureChannel(channel);
    const entry = Object.assign({}, data, { timeInSeconds: t, channel, layer });

    // Keep array time-sorted. Most callers push in order, so fast-path first.
    if (arr.length === 0 || t >= arr[arr.length - 1].timeInSeconds) {
      arr.push(entry);
    } else {
      const insertIdx = timeGridSearchStart(arr, 'timeInSeconds', t);
      arr.splice(insertIdx, 0, entry);
    }

    invalidateCache();
  }

  /**
   * Query a channel, returning a filtered slice.
   * @param {string} channel
   * @param {Object} [opts]
   *   layer?          - filter by layer name
   *   since?          - lower-bound timestamp (seconds), inclusive
   *   windowSeconds?  - rolling window from the last entry's time
   *   aroundSeconds?  - centre of a +/- toleranceSec window
   *   toleranceSec?   - half-width for aroundSeconds query
   * @returns {Array<Object>}
   */
  function query(channel, opts) {
    V.assertNonEmptyString(channel, 'query.channel');
    const arr = channels[channel];
    if (!arr || arr.length === 0) return [];

    let layer, since, windowSeconds, aroundSeconds, toleranceSec;
    if (opts !== undefined) {
      V.assertPlainObject(opts, 'query.opts');
      ({ layer, since, windowSeconds, aroundSeconds, toleranceSec } = opts);
    }

    if (aroundSeconds !== undefined && toleranceSec !== undefined) {
      const around = V.requireFinite(aroundSeconds, 'query.aroundSeconds');
      const tol    = V.requireFinite(toleranceSec, 'query.toleranceSec');
      const lo = around - tol;
      const hi = around + tol;
      const startIdx = timeGridSearchStart(arr, 'timeInSeconds', lo);
      const cacheKey = channel + ':' + (layer || '') + ':around:' + lo + ':' + hi;
      const cached = queryCache.get(cacheKey);
      if (cached) return cached;
      const result = [];
      for (let i = startIdx; i < arr.length; i++) {
        const e = arr[i];
        if (e.timeInSeconds > hi) break;
        if (layer && e.layer !== layer) continue;
        result.push(e);
      }
      queryCache.set(cacheKey, result);
      return result;
    }

    // since / windowSeconds / full-channel query
    let cutoff = -Infinity;
    if (typeof since === 'number' && Number.isFinite(since)) {
      cutoff = since;
    } else if (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) {
      cutoff = arr[arr.length - 1].timeInSeconds - windowSeconds;
    }

    const cacheKey = channel + ':' + (layer || '') + ':' + cutoff;
    const cached = queryCache.get(cacheKey);
    if (cached) return cached;

    const startIdx = cutoff === -Infinity ? 0 : timeGridSearchStart(arr, 'timeInSeconds', cutoff);
    const result = [];
    for (let i = startIdx; i < arr.length; i++) {
      const e = arr[i];
      if (layer && e.layer !== layer) continue;
      result.push(e);
    }
    queryCache.set(cacheKey, result);
    return result;
  }

  /**
   * Count entries in a channel matching opts.
   * @param {string} channel
   * @param {Object} [opts]
   * @returns {number}
   */
  function count(channel, opts) {
    V.assertNonEmptyString(channel, 'count.channel');
    const arr = channels[channel];
    if (!arr || arr.length === 0) return 0;

    let layer, since, windowSeconds;
    if (opts !== undefined) {
      V.assertPlainObject(opts, 'count.opts');
      ({ layer, since, windowSeconds } = opts);
    }

    let cutoff = -Infinity;
    if (typeof since === 'number' && Number.isFinite(since)) {
      cutoff = since;
    } else if (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) {
      cutoff = arr[arr.length - 1].timeInSeconds - windowSeconds;
    }

    const startIdx = cutoff === -Infinity ? 0 : timeGridSearchStart(arr, 'timeInSeconds', cutoff);
    let n = 0;
    for (let i = startIdx; i < arr.length; i++) {
      if (layer && arr[i].layer !== layer) continue;
      n++;
    }
    return n;
  }

  /**
   * Return the last (most recent) entry matching opts via reverse scan.
   * @param {string} channel
   * @param {Object} [opts]
   * @returns {Object|null}
   */
  function getLast(channel, opts) {
    V.assertNonEmptyString(channel, 'getLast.channel');
    const arr = channels[channel];
    if (!arr || arr.length === 0) return null;

    let layer, since, windowSeconds;
    if (opts !== undefined) {
      V.assertPlainObject(opts, 'getLast.opts');
      ({ layer, since, windowSeconds } = opts);
    }

    let cutoff = -Infinity;
    if (typeof since === 'number' && Number.isFinite(since)) {
      cutoff = since;
    } else if (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) {
      cutoff = arr[arr.length - 1].timeInSeconds - windowSeconds;
    }

    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (e.timeInSeconds < cutoff) break;
      if (layer && e.layer !== layer) continue;
      return e;
    }
    return null;
  }

  /**
   * Return { count, first, last } for entries matching opts.
   * @param {string} channel
   * @param {Object} [opts]
   * @returns {{ count: number, first: Object|null, last: Object|null }}
   */
  function getBounds(channel, opts) {
    V.assertNonEmptyString(channel, 'getBounds.channel');
    const arr = channels[channel];
    if (!arr || arr.length === 0) return { count: 0, first: null, last: null };

    let layer, since, windowSeconds;
    if (opts !== undefined) {
      V.assertPlainObject(opts, 'getBounds.opts');
      ({ layer, since, windowSeconds } = opts);
    }

    let cutoff = -Infinity;
    if (typeof since === 'number' && Number.isFinite(since)) {
      cutoff = since;
    } else if (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) {
      cutoff = arr[arr.length - 1].timeInSeconds - windowSeconds;
    }

    const startIdx = cutoff === -Infinity ? 0 : timeGridSearchStart(arr, 'timeInSeconds', cutoff);
    let n = 0;
    /** @type {Object|null} */ let first = null;
    /** @type {Object|null} */ let last = null;
    for (let i = startIdx; i < arr.length; i++) {
      const e = arr[i];
      if (layer && e.layer !== layer) continue;
      if (first === null) first = e;
      last = e;
      n++;
    }
    return { count: n, first, last };
  }

  /**
   * Find the single closest entry within toleranceSec of timeInSeconds.
   * @param {string} channel
   * @param {number} timeInSeconds
   * @param {number} toleranceSec
   * @param {string} [excludeLayer]
   * @returns {Object|null}
   */
  function findClosest(channel, timeInSeconds, toleranceSec, excludeLayer) {
    V.assertNonEmptyString(channel, 'findClosest.channel');
    const around = V.requireFinite(timeInSeconds, 'findClosest.timeInSeconds');
    const tol    = V.requireFinite(toleranceSec, 'findClosest.toleranceSec');
    if (excludeLayer !== undefined) V.assertNonEmptyString(excludeLayer, 'findClosest.excludeLayer');

    const arr = channels[channel];
    if (!arr || arr.length === 0) return null;

    const lo = around - tol;
    const hi = around + tol;
    const startIdx = timeGridSearchStart(arr, 'timeInSeconds', lo);

    /** @type {Object|null} */ let best = null;
    let bestDist = Infinity;
    for (let i = startIdx; i < arr.length; i++) {
      const e = arr[i];
      if (e.timeInSeconds > hi) break;
      if (excludeLayer && e.layer === excludeLayer) continue;
      const dist = m.abs(e.timeInSeconds - around);
      if (dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Reset one channel or all channels.
   * @param {string} [channel]
   */
  function reset(channel) {
    if (channel) {
      if (channels[channel]) channels[channel].length = 0;
    } else {
      const names = Object.keys(channels);
      for (let i = 0; i < names.length; i++) {
        channels[names[i]].length = 0;
      }
    }
    invalidateCache();
  }

  /**
   * Return all entries across all channels as a flat merged array (LM compatibility).
   * @returns {Array<Object>}
   */
  function getBuffer() {
    const names = Object.keys(channels);
    if (names.length === 0) return [];
    const out = [];
    for (let i = 0; i < names.length; i++) {
      const arr = channels[names[i]];
      for (let j = 0; j < arr.length; j++) out.push(arr[j]);
    }
    return out;
  }

  return {
    post,
    query,
    count,
    getLast,
    getBounds,
    findClosest,
    reset,
    getBuffer,
    channels
  };
})();
