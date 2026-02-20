// src/time/AbsoluteTimeWindow.js - Rolling window tracker using absolute seconds.
// Provides a cross-layer common clock for phrase-scale musical analysis.
// Uses beatStartTime (absolute seconds from piece start) as time reference.

/**
 * @typedef {{
 *   time: number,
 *   layer?: string,
 *   [key: string]: unknown
 * }} ATWEntry
 */

AbsoluteTimeWindow = (() => {
  const V = Validator.create('AbsoluteTimeWindow');
  const DEFAULT_WINDOW_SECONDS = 8;
  const MAX_ENTRIES = 2000;

  /** @type {Object.<string, ATWEntry[]>} */
  const entries = {
    note: [],
    rhythm: [],
    chord: []
  };

  const VALID_TYPES = new Set(['note', 'rhythm', 'chord']);

  /**
   * Binary-search prune: remove entries older than the window cutoff.
   * @param {ATWEntry[]} arr - sorted entry array
   * @param {number} currentTime - absolute seconds
   * @param {number} windowSeconds - window size
   */
  function prune(arr, currentTime, windowSeconds) {
    if (!Array.isArray(arr) || arr.length === 0) return;
    const cutoff = currentTime - windowSeconds;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const entry = /** @type {ATWEntry|undefined} */ (arr[mid]);
      if (entry && typeof entry.time === 'number' && entry.time < cutoff) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) arr.splice(0, lo);
    if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
  }

  /**
   * Generic record method — inserts a typed entry and prunes.
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
      prune(arr, e.time, DEFAULT_WINDOW_SECONDS);
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
    record('note', { time, layer, midi, velocity, unit: unitLabel });
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

    let result = arr.filter(e => {
        const entry = /** @type {ATWEntry|undefined} */ (e);
        return entry && typeof entry.time === 'number' && entry.time >= cutoff;
    });

    if (layer) {
      result = result.filter(e => {
        const entry = /** @type {ATWEntry|undefined} */ (e);
        return entry && entry.layer === layer;
      });
    }
    return result;
  }

  /** @param {Object} [opts] */
  function getNotes(opts) { return getEntries('note', opts); }
  /** @param {Object} [opts] */
  function getRhythms(opts) { return getEntries('rhythm', opts); }
  /** @param {Object} [opts] */
  function getChords(opts) { return getEntries('chord', opts); }

  /** Get the current window size in seconds. */
  function getWindowSize() { return DEFAULT_WINDOW_SECONDS; }

  /** Reset all entry buffers. */
  function reset() {
    if (entries.note) entries.note.length = 0;
    if (entries.rhythm) entries.rhythm.length = 0;
    if (entries.chord) entries.chord.length = 0;
  }

  return {
    recordNote,
    recordRhythm,
    recordChord,
    getNotes,
    getRhythms,
    getChords,
    getEntries,
    getWindowSize,
    reset
  };
})();
