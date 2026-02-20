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
  const DEFAULT_WINDOW_MS = 8000;
  const MAX_ENTRIES_PER_TYPE = 500;

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
   * Binary-search prune: remove entries older than cutoff.
   * @param {ATGEntry[]} arr - sorted by timeMs
   * @param {number} nowMs - current absolute ms
   * @param {number} windowMs - retention window
   */
  function prune(arr, nowMs, windowMs) {
    if (arr.length === 0) return;
    const cutoff = nowMs - windowMs;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].timeMs < cutoff) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) arr.splice(0, lo);
    if (arr.length > MAX_ENTRIES_PER_TYPE) arr.splice(0, arr.length - MAX_ENTRIES_PER_TYPE);
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
    const payload = typeof data === 'undefined' ? {} : data;
    const entry = Object.assign({ timeMs: t, layer }, payload);
    arr.push(entry);
    prune(arr, t, DEFAULT_WINDOW_MS);
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

    const result = [];
    // Reverse scan — most recent first, short-circuit once past window
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (e.timeMs < lo) break;
      if (e.timeMs > hi) continue;
      if (excludeLayer && e.layer === excludeLayer) continue;
      if (onlyLayer && e.layer !== onlyLayer) continue;
      result.push(e);
    }
    return result;
  }

  /**
   * Find the single closest cross-layer event within tolerance.
   * @param {string} channel - channel name
   * @param {number} aroundMs - center ms
   * @param {number} toleranceMs - +/- ms window
   * @param {string} [excludeLayer] - optional querying layer to exclude from results
   * @returns {ATGEntry|null}
   */
  function findClosest(channel, aroundMs, toleranceMs, excludeLayer) {
    V.assertNonEmptyString(channel, 'findClosest.channel');
    V.requireFinite(aroundMs, 'findClosest.aroundMs');
    V.requireFinite(toleranceMs, 'findClosest.toleranceMs');
    let matches;
    if (typeof excludeLayer === 'undefined') {
      matches = query(channel, aroundMs, toleranceMs);
    } else {
      V.assertNonEmptyString(excludeLayer, 'findClosest.excludeLayer');
      matches = query(channel, aroundMs, toleranceMs, { excludeLayer });
    }
    if (matches.length === 0) return null;
    let best = matches[0];
    let bestDist = Math.abs(best.timeMs - aroundMs);
    for (let i = 1; i < matches.length; i++) {
      const dist = Math.abs(matches[i].timeMs - aroundMs);
      if (dist < bestDist) {
        best = matches[i];
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
