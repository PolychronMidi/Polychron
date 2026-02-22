// src/time/absoluteTimeGrid.js — Millisecond-precision cross-layer sync grid.
// Unit-agnostic: syncs layers by absolute wall-clock ms, not by musical structure.
// Designed as an extensible feedback-loop backbone for any cross-layer FX sync.

/**
 * @typedef {{
 *   timeMs: number,
 *   layer: string,
 *   [key: string]: unknown
 * }} ATGEntry
 */

AbsoluteTimeGrid = (() => {
  const V = Validator.create('AbsoluteTimeGrid');
  /** Default ms window for pruning old entries */
  const DEFAULT_WINDOW_MS = 4000;
  const MAX_ENTRIES_PER_TYPE = 250;

  /** @type {Object.<string, ATGEntry[]>} */
  const channels = {};

  /**
   * Ensure a channel exists.
   * @param {string} name
   * @returns {ATGEntry[]}
   */
  function ensureChannel(name) {
    V.assertNonEmptyString(name, 'channel');
    if (!channels[name]) channels[name] = [];
    return channels[name];
  }

  /**
   * Post a sync event to a named channel.
   * @param {string} channel - e.g. 'binaural', 'stutter', 'density'
   * @param {string} layer - layer that posted (e.g. 'L1')
   * @param {number} timeMs - absolute ms from piece start
   * @param {Object} [data] - arbitrary payload for the event
   */
  function post(channel, layer, timeMs, data) {
    V.assertNonEmptyString(channel, 'post.channel');
    V.assertNonEmptyString(layer, 'post.layer');
    const t = V.requireFinite(timeMs, 'post.timeMs');
    if (typeof data !== 'undefined') V.assertPlainObject(data, 'post.data');

    const arr = ensureChannel(channel);
    const entry = typeof data === 'undefined' ? { timeMs: t, layer } : data;
    entry.timeMs = t;
    entry.layer = layer;
    arr.push(entry);
    // Only prune when over capacity to avoid O(n) splice on every post
    if (arr.length > MAX_ENTRIES_PER_TYPE) {
      timeGridPrune(arr, 'timeMs', t, DEFAULT_WINDOW_MS, MAX_ENTRIES_PER_TYPE);
    }
  }

  /**
   * Query a channel for events within a ms tolerance window.
   * @param {string} channel - channel name
   * @param {number} aroundMs - center timestamp to search around
   * @param {number} toleranceMs - +/- ms tolerance
   * @param {Object} [opts]
   * @param {string} [opts.excludeLayer] - skip entries from this layer
   * @param {string} [opts.onlyLayer] - only include entries from this layer
   * @returns {ATGEntry[]}
   */
  function query(channel, aroundMs, toleranceMs, opts) {
    V.assertNonEmptyString(channel, 'query.channel');
    const around = V.requireFinite(aroundMs, 'query.aroundMs');
    const tolerance = V.requireFinite(toleranceMs, 'query.toleranceMs');
    if (tolerance < 0) {
      throw new Error('AbsoluteTimeGrid.query: toleranceMs must be >= 0');
    }

    const arr = channels[channel];
    if (!arr || arr.length === 0) return [];

    const lo = around - tolerance;
    const hi = around + tolerance;
    let excludeLayer;
    let onlyLayer;
    if (typeof opts === 'undefined') {
      excludeLayer = undefined;
      onlyLayer = undefined;
    } else {
      V.assertPlainObject(opts, 'query.opts');
      ({ excludeLayer, onlyLayer } = opts);
      if (typeof excludeLayer !== 'undefined') V.assertNonEmptyString(excludeLayer, 'query.opts.excludeLayer');
      if (typeof onlyLayer !== 'undefined') V.assertNonEmptyString(onlyLayer, 'query.opts.onlyLayer');
    }

    // Binary search for first entry >= lo — O(log n)
    const startIdx = timeGridSearchStart(arr, 'timeMs', lo);

    const result = [];
    // Forward scan from startIdx — only touches entries within the [lo, hi] window
    for (let i = startIdx; i < arr.length; i++) {
      const e = arr[i];
      if (e.timeMs > hi) break;
      if (excludeLayer && e.layer === excludeLayer) continue;
      if (onlyLayer && e.layer !== onlyLayer) continue;
      result.push(e);
    }
    return result;
  }

  /**
   * Find the single closest cross-layer event within tolerance.
   * Zero-allocation: binary search + bounded forward scan, no intermediate array.
   * @param {string} channel - channel name
   * @param {number} aroundMs - center ms
   * @param {number} toleranceMs - +/- ms window
   * @param {string} [excludeLayer] - optional querying layer to exclude from results
   * @returns {ATGEntry|null}
   */
  function findClosest(channel, aroundMs, toleranceMs, excludeLayer) {
    V.assertNonEmptyString(channel, 'findClosest.channel');
    const around = V.requireFinite(aroundMs, 'findClosest.aroundMs');
    const tolerance = V.requireFinite(toleranceMs, 'findClosest.toleranceMs');
    if (typeof excludeLayer !== 'undefined') V.assertNonEmptyString(excludeLayer, 'findClosest.excludeLayer');

    const arr = channels[channel];
    if (!arr || arr.length === 0) return null;

    const lo = around - tolerance;
    const hi = around + tolerance;

    // Binary search for first entry >= lo — O(log n)
    const startIdx = timeGridSearchStart(arr, 'timeMs', lo);

    // Forward scan within window — only touches entries in [lo, hi]
    /** @type {ATGEntry|null} */ let best = null;
    let bestDist = Infinity;
    for (let i = startIdx; i < arr.length; i++) {
      const e = arr[i];
      if (e.timeMs > hi) break;
      if (excludeLayer && e.layer === excludeLayer) continue;
      const dist = Math.abs(e.timeMs - around);
      if (dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Get all registered channel names.
   * @returns {string[]}
   */
  function getChannels() {
    return Object.keys(channels);
  }

  /**
   * Reset a single channel or all channels.
   * @param {string} [channel] - if omitted, resets everything
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
  }

  return {
    post,
    query,
    findClosest,
    getChannels,
    reset
  };
})();
