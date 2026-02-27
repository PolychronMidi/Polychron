// src/time/absoluteTimeWindow.js - Rolling window tracker using absolute seconds.
// Provides a cross-layer common clock for phrase-scale musical analysis.
// Uses beatStartTime (absolute seconds from piece start) as time reference.

/**
 * @typedef {{
 *   time: number,
 *   layer?: string,
 *   [key: string]: unknown
 * }} ATWEntry
 */

absoluteTimeWindow = (() => {
  const V = validator.create('absoluteTimeWindow');
  const DEFAULT_WINDOW_SECONDS = 4;
  const MAX_ENTRIES = 1000;

  /** @type {Object.<string, ATWEntry[]>} */
  const entries = {
    note: [],
    rhythm: [],
    chord: []
  };

  const VALID_TYPES = new Set(['note', 'rhythm', 'chord']);

  // Per-beat query cache: avoids re-scanning the same window for identical params.
  // Cleared on every record() call (new data invalidates cached results).
  /** @type {Map<string, ATWEntry[]>} */
  const _queryCache = new Map();

  /** Prune via shared helper. */
  function prune(arr, currentTime, windowSeconds) {
    if (!Array.isArray(arr) || arr.length === 0) return;
    timeGridPrune(arr, 'time', currentTime, windowSeconds, MAX_ENTRIES);
  }

  /**
   * Generic record method - inserts a typed entry and prunes.
   * @param {string} type - 'note' | 'rhythm' | 'chord'
   * @param {Object} entry - must include `.time` (absolute seconds)
   */
  function record(type, entry) {
    V.assertPlainObject(entry, 'record.entry');
    const e = /** @type {ATWEntry} */ (entry);
    V.requireFinite(e.time, 'record.entry.time');
    V.assertInSet(type, VALID_TYPES, 'record.type');

    const arr = entries[type];
    if (Array.isArray(arr)) {
      arr.push(e);
      // Invalidate query cache - new data makes cached results stale
      if (_queryCache.size > 0) _queryCache.clear();
      // Only prune when over capacity to avoid O(n) splice on every record
      if (arr.length > MAX_ENTRIES) {
        prune(arr, e.time, DEFAULT_WINDOW_SECONDS);
      }
    }
  }

  /**
   * Record a note event.
   * @param {number} midi - MIDI note number
   * @param {number} velocity - 0-127
   * @param {string} layer - layer identifier (e.g. 'L1', 'L2')
   * @param {number} time - absolute seconds from piece start
   * @param {string} unitLabel - timing unit (e.g. 'beat', 'subdiv')
   */
  function recordNote(midi, velocity, layer, time, unitLabel) {
    // Inlined from record() - skips assertPlainObject (literal just created)
    // and assertInSet (type is always 'note')
    V.requireFinite(time, 'recordNote.time');
    const arr = entries.note;
    arr.push({ time, layer, midi, velocity, unit: unitLabel });
    if (_queryCache.size > 0) _queryCache.clear();
    if (arr.length > MAX_ENTRIES) {
      prune(arr, time, DEFAULT_WINDOW_SECONDS);
    }
  }

  /**
   * Record a rhythm selection event.
   * @param {string} method - rhythm method key
   * @param {number} length - pattern length
   * @param {string} layer - layer identifier
   * @param {number} time - absolute seconds
   */
  function recordRhythm(method, length, layer, time) {
    record('rhythm', { time, layer, method, length });
  }

  /**
   * Record a chord/harmonic state change.
   * @param {Array} chords - active chord set
   * @param {string} key - harmonic key
   * @param {string} mode - harmonic mode
   * @param {string} layer - layer identifier
   * @param {number} time - absolute seconds
   */
  function recordChord(chords, key, mode, layer, time) {
    record('chord', { time, layer, chords, key, mode });
  }

  /**
   * Query entries with backward-compatible overloads:
   * - getEntries(type, opts)
   * - getEntries(windowSeconds)
   * - getEntries(opts)
   * - getEntries() // defaults to note entries
   * @param {string|number|Object|undefined} typeOrWindowOrOpts
   * @param {Object} [opts]
   * @returns {ATWEntry[]}
   */
  function getEntries(typeOrWindowOrOpts, opts) {
    let type = 'note';
    let effectiveOpts = opts;

    if (typeof typeOrWindowOrOpts === 'string') {
      type = typeOrWindowOrOpts;
    } else if (typeof typeOrWindowOrOpts === 'number') {
      const w = V.requireFinite(typeOrWindowOrOpts, 'getEntries.windowSeconds');
      effectiveOpts = { windowSeconds: w };
    } else if (typeof typeOrWindowOrOpts === 'undefined') {
      // default type 'note' with optional opts
    } else {
      V.assertPlainObject(typeOrWindowOrOpts, 'getEntries.opts');
      effectiveOpts = typeOrWindowOrOpts;
    }

    V.assertInSet(type, VALID_TYPES, 'getEntries.type');
    let layer;
    let since;
    let windowSeconds;
    if (typeof effectiveOpts === 'undefined') {
      layer = undefined;
      since = undefined;
      windowSeconds = undefined;
    } else {
      V.assertPlainObject(effectiveOpts, 'getEntries.opts');
      ({ layer, since, windowSeconds } = effectiveOpts);
      if (typeof layer !== 'undefined') V.assertNonEmptyString(layer, 'getEntries.opts.layer');
      if (typeof since !== 'undefined') V.requireFinite(since, 'getEntries.opts.since');
      if (typeof windowSeconds !== 'undefined') V.requireFinite(windowSeconds, 'getEntries.opts.windowSeconds');
    }
    const arr = entries[type];
    if (!Array.isArray(arr) || arr.length === 0) {
      return [];
    }

    const last = /** @type {ATWEntry|undefined} */ (arr[arr.length - 1]);
    if (!last || typeof last.time !== 'number') {
      return [];
    }

    const lastTime = last.time;
    const effectiveWindowSeconds =
      (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds))
        ? windowSeconds
        : DEFAULT_WINDOW_SECONDS;
    const cutoff = (typeof since === 'number' && Number.isFinite(since))
      ? since
      : (lastTime - effectiveWindowSeconds);

    // Query cache: identical (type, layer, cutoff) - reuse prior result array
    const cacheKey = type + ':' + (layer || '') + ':' + cutoff;
    const cached = _queryCache.get(cacheKey);
    if (cached) return cached;

    // Binary search for cutoff position - O(log n)
    const startIdx = timeGridSearchStart(arr, 'time', cutoff);
    // Single-pass scan from cutoff to end - O(k) where k = matching entries
    const result = [];
    for (let i = startIdx; i < arr.length; i++) {
      const entry = /** @type {ATWEntry|undefined} */ (arr[i]);
      if (!entry || typeof entry.time !== 'number') continue;
      if (layer && entry.layer !== layer) continue;
      result.push(entry);
    }
    _queryCache.set(cacheKey, result);
    return result;
  }

  /** @param {Object} [opts] */
  function getNotes(opts) { return getEntries('note', opts); }
  /** @param {Object} [opts] */
  function getRhythms(opts) { return getEntries('rhythm', opts); }
  /** @param {Object} [opts] */
  function getChords(opts) { return getEntries('chord', opts); }

  // --- Fast-path query methods (zero array allocation) ---

  /**
   * Parse note query opts and compute binary-search start index.
   * Shared by countNotes / getLastNote / getNoteBounds.
   * @param {Object} [opts] - { layer?, since?, windowSeconds? }
   * @returns {{ layer: string|undefined, startIdx: number, cutoff: number }|null}
   */
  function _parseNoteQuery(opts) {
    const arr = entries.note;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    let layer, since, windowSeconds;
    if (opts !== undefined) {
      V.assertPlainObject(opts, 'noteQuery.opts');
      ({ layer, since, windowSeconds } = opts);
      if (layer !== undefined) V.assertNonEmptyString(layer, 'noteQuery.layer');
      if (since !== undefined) V.requireFinite(since, 'noteQuery.since');
      if (windowSeconds !== undefined) V.requireFinite(windowSeconds, 'noteQuery.windowSeconds');
    }
    const last = /** @type {ATWEntry} */ (arr[arr.length - 1]);
    if (!last || typeof last.time !== 'number') return null;
    const effectiveWindow = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds))
      ? windowSeconds : DEFAULT_WINDOW_SECONDS;
    const cutoff = (typeof since === 'number' && Number.isFinite(since))
      ? since : (last.time - effectiveWindow);
    return { layer, startIdx: timeGridSearchStart(arr, 'time', cutoff), cutoff };
  }

  /**
   * Count notes matching the query without allocating a result array.
   * Drop-in replacement for getNotes(opts).length.
   * @param {Object} [opts] - { layer?, since?, windowSeconds? }
   * @returns {number}
   */
  function countNotes(opts) {
    const q = _parseNoteQuery(opts);
    if (!q) return 0;
    const arr = entries.note;
    const { layer, startIdx } = q;
    let count = 0;
    for (let i = startIdx; i < arr.length; i++) {
      const entry = /** @type {ATWEntry|undefined} */ (arr[i]);
      if (!entry || typeof entry.time !== 'number') continue;
      if (layer && entry.layer !== layer) continue;
      count++;
    }
    return count;
  }

  /**
   * Get the most recent note matching the query via reverse scan.
   * Drop-in replacement for: const a = getNotes(opts); a[a.length - 1].
   * Typically O(1-5) since recent entries for any layer are near the end.
   * @param {Object} [opts] - { layer?, since?, windowSeconds? }
   * @returns {ATWEntry|null}
   */
  function getLastNote(opts) {
    const q = _parseNoteQuery(opts);
    if (!q) return null;
    const arr = entries.note;
    const { layer, cutoff } = q;
    for (let i = arr.length - 1; i >= 0; i--) {
      const entry = /** @type {ATWEntry|undefined} */ (arr[i]);
      if (!entry || typeof entry.time !== 'number') continue;
      if (entry.time < cutoff) break;
      if (layer && entry.layer !== layer) continue;
      return entry;
    }
    return null;
  }

  /**
   * Get count, first, and last matching notes without allocating a result array.
   * Drop-in replacement for getNotes(opts) when only boundary info is needed.
   * @param {Object} [opts] - { layer?, since?, windowSeconds? }
   * @returns {{ count: number, first: ATWEntry|null, last: ATWEntry|null }}
   */
  function getNoteBounds(opts) {
    const q = _parseNoteQuery(opts);
    if (!q) return { count: 0, first: null, last: null };
    const arr = entries.note;
    const { layer, startIdx } = q;
    let count = 0;
    /** @type {ATWEntry|null} */ let first = null;
    /** @type {ATWEntry|null} */ let last = null;
    for (let i = startIdx; i < arr.length; i++) {
      const entry = /** @type {ATWEntry|undefined} */ (arr[i]);
      if (!entry || typeof entry.time !== 'number') continue;
      if (layer && entry.layer !== layer) continue;
      if (first === null) first = entry;
      last = entry;
      count++;
    }
    return { count, first, last };
  }

  /** Get the current window size in seconds. */
  function getWindowSize() { return DEFAULT_WINDOW_SECONDS; }

  /** Reset all entry buffers. */
  function reset() {
    if (entries.note) entries.note.length = 0;
    if (entries.rhythm) entries.rhythm.length = 0;
    if (entries.chord) entries.chord.length = 0;
    _queryCache.clear();
  }

  return {
    recordNote,
    recordRhythm,
    recordChord,
    getNotes,
    getRhythms,
    getChords,
    getEntries,
    countNotes,
    getLastNote,
    getNoteBounds,
    getWindowSize,
    reset
  };
})();
