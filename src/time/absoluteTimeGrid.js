// src/time/absoluteTimeGrid.js - Millisecond-precision cross-layer sync grid.
// Unit-agnostic: syncs layers by absolute wall-clock ms, not by musical structure.
// Designed as an extensible feedback-loop backbone for any cross-layer FX sync.
// Evolved to a spatial-hashed temporal ledger for O(1) scaling.

/**
 * @typedef {{
 *   timeMs: number,
 *   layer: string,
 *   [key: string]: unknown
 * }} ATGEntry
 */

absoluteTimeGrid = (() => {
  const V = validator.create('absoluteTimeGrid');
  /** Default ms window for pruning old entries */
  const DEFAULT_WINDOW_MS = 4000;
  const BUCKET_SIZE_MS = 1000; // Spatial hashing bucket size

  /** @type {Object.<string, Map<number, ATGEntry[]>>} */
  const channels = {};

  /** Latest absolute ms posted across all channels */
  let latestMs = 0;

  /**
   * Ensure a channel exists.
   * @param {string} name
   * @returns {Map<number, ATGEntry[]>}
   */
  function ensureChannel(name) {
    V.assertNonEmptyString(name, 'channel');
    if (!channels[name]) channels[name] = new Map();
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
    if (data !== undefined) V.assertPlainObject(data, 'post.data');

    if (t > latestMs) latestMs = t;

    const channelMap = ensureChannel(channel);
    const entry = typeof data === 'undefined' ? { timeMs: t, layer } : data;
    entry.timeMs = t;
    entry.layer = layer;

    const bucketIdx = m.floor(t / BUCKET_SIZE_MS);
    let bucket = channelMap.get(bucketIdx);
    if (!bucket) {
      bucket = [];
      channelMap.set(bucketIdx, bucket);
    }

    if (bucket.length === 0 || t >= bucket[bucket.length - 1].timeMs) {
      bucket.push(entry);
    } else {
      // Keep bucket time-sorted even when callers post out of order.
      const insertIdx = timeGridSearchStart(bucket, 'timeMs', t);
      bucket.splice(insertIdx, 0, entry);
    }

    // Prune old buckets (O(1) cleanup instead of O(n) array splice)
    const oldestAllowedBucket = m.floor((t - DEFAULT_WINDOW_MS) / BUCKET_SIZE_MS);
    for (const key of channelMap.keys()) {
      if (key < oldestAllowedBucket) {
        channelMap.delete(key);
      }
    }
  }

  /**
   * Query a channel for events within a ms tolerance window.
   * @param {string} channel - channel name
   * @param {number} aroundMs - center timestamp to search around
   * @param {number} toleranceMs -  ms tolerance
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
      throw new Error('absoluteTimeGrid.query: toleranceMs must be >= 0');
    }

    const channelMap = channels[channel];
    if (!channelMap || channelMap.size === 0) return [];

    const lo = around - tolerance;
    const hi = around + tolerance;
    let excludeLayer;
    let onlyLayer;
    if (opts === undefined) {
      excludeLayer = undefined;
      onlyLayer = undefined;
    } else {
      V.assertPlainObject(opts, 'query.opts');
      ({ excludeLayer, onlyLayer } = opts);
      if (excludeLayer !== undefined) V.assertNonEmptyString(excludeLayer, 'query.opts.excludeLayer');
      if (onlyLayer !== undefined) V.assertNonEmptyString(onlyLayer, 'query.opts.onlyLayer');
    }

    const startBucket = m.floor(lo / BUCKET_SIZE_MS);
    const endBucket = m.floor(hi / BUCKET_SIZE_MS);
    const result = [];

    for (let b = startBucket; b <= endBucket; b++) {
      const bucket = channelMap.get(b);
      if (!bucket) continue;

      // For the first bucket, we might need to skip early entries
      const startIdx = (b === startBucket) ? timeGridSearchStart(bucket, 'timeMs', lo) : 0;

      for (let i = startIdx; i < bucket.length; i++) {
        const e = bucket[i];
        if (e.timeMs > hi) break;
        if (excludeLayer && e.layer === excludeLayer) continue;
        if (onlyLayer && e.layer !== onlyLayer) continue;
        result.push(e);
      }
    }
    return result;
  }

  /**
   * Find the single closest cross-layer event within tolerance.
   * Zero-allocation: binary search + bounded forward scan, no intermediate array.
   * @param {string} channel - channel name
   * @param {number} aroundMs - center ms
   * @param {number} toleranceMs -  ms window
   * @param {string} [excludeLayer] - optional querying layer to exclude from results
   * @returns {ATGEntry|null}
   */
  function findClosest(channel, aroundMs, toleranceMs, excludeLayer) {
    V.assertNonEmptyString(channel, 'findClosest.channel');
    const around = V.requireFinite(aroundMs, 'findClosest.aroundMs');
    const tolerance = V.requireFinite(toleranceMs, 'findClosest.toleranceMs');
    if (excludeLayer !== undefined) V.assertNonEmptyString(excludeLayer, 'findClosest.excludeLayer');

    const channelMap = channels[channel];
    if (!channelMap || channelMap.size === 0) return null;

    const lo = around - tolerance;
    const hi = around + tolerance;

    const startBucket = m.floor(lo / BUCKET_SIZE_MS);
    const endBucket = m.floor(hi / BUCKET_SIZE_MS);

    /** @type {ATGEntry|null} */ let best = null;
    let bestDist = Infinity;

    for (let b = startBucket; b <= endBucket; b++) {
      const bucket = channelMap.get(b);
      if (!bucket) continue;

      const startIdx = (b === startBucket) ? timeGridSearchStart(bucket, 'timeMs', lo) : 0;

      for (let i = startIdx; i < bucket.length; i++) {
        const e = bucket[i];
        if (e.timeMs > hi) break;
        if (excludeLayer && e.layer === excludeLayer) continue;
        const dist = m.abs(e.timeMs - around);
        if (dist < bestDist) {
          best = e;
          bestDist = dist;
        }
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
      if (channels[channel]) channels[channel].clear();
    } else {
      const names = Object.keys(channels);
      for (let i = 0; i < names.length; i++) {
        channels[names[i]].clear();
      }
    }
  }

  /**
   * Return the latest absolute ms posted to any channel.
   * @returns {number}
   */
  function now() {
    return latestMs;
  }

  return {
    post,
    query,
    findClosest,
    getChannels,
    reset,
    now
  };
})();
