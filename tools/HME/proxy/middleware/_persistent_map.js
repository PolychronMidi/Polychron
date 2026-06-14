'use strict';
const { requireEnv: _hmeRequireEnv } = require('../shared/load_env.js');
// Persistent Map with append-only JSONL, LRU touch, and periodic compaction for warm caches.
// Used for performance-only middleware caches; correctness-critical dedup remains elsewhere.

const fs = require('fs');
const path = require('path');

const DEFAULT_CAP = 50_000;
const DEFAULT_COMPACT_BYTES = 4 * 1024 * 1024;
const COMPACT_CHECK_INTERVAL_MS = 60_000;

class PersistentMap {
  /**
   * @param {string} filePath - absolute or PROJECT_ROOT-relative path
   * @param {{cap?: number, compactBytes?: number}} opts
   */
  constructor(filePath, opts = {}) {
    this._file = path.isAbsolute(filePath)
      ? filePath
      : path.join(_hmeRequireEnv('PROJECT_ROOT'), filePath);
    this._cap = opts.cap || DEFAULT_CAP;
    this._compactBytes = opts.compactBytes || DEFAULT_COMPACT_BYTES;
    this._map = new Map();
    this._loaded = false;
    this._lastCompactCheck = 0;
  }

  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    if (!fs.existsSync(this._file)) return;
    try {
      const lines = fs.readFileSync(this._file, 'utf8').split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line);
          if (entry && entry.k !== undefined) {
            // Latest-wins for repeated keys; LRU touch via delete+re-insert.
            if (this._map.has(entry.k)) this._map.delete(entry.k);
            this._map.set(entry.k, entry.v);
          }
        } catch (_e) { /* skip malformed line */ }
      }
      // Cap to LRU-most-recent.
      if (this._map.size > this._cap) {
        const excess = this._map.size - this._cap;
        let i = 0;
        for (const k of this._map.keys()) {
          if (i++ >= excess) break;
          this._map.delete(k);
        }
      }
    } catch (err) {
      console.error(`[_persistent_map] failed to load ${this._file}: ${err.message}`);
    }
  }

  _persist(k, v) {
    try {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      fs.appendFileSync(this._file, JSON.stringify({ k, v, ts: Date.now() }) + '\n');
    } catch (_e) { /* best-effort */ }
  }

  _maybeCompact() {
    const now = Date.now();
    if (now - this._lastCompactCheck < COMPACT_CHECK_INTERVAL_MS) return;
    this._lastCompactCheck = now;
    try {
      const stat = fs.statSync(this._file);
      if (stat.size < this._compactBytes) return;
      const tmp = this._file + '.compact';
      const lines = [];
      for (const [k, v] of this._map) {
        lines.push(JSON.stringify({ k, v, ts: now }));
      }
      fs.writeFileSync(tmp, lines.join('\n') + (lines.length ? '\n' : ''));
      fs.renameSync(tmp, this._file);
    } catch (_e) { /* best-effort */ }
  }

  get(k) {
    this._ensureLoaded();
    return this._map.get(k);
  }

  set(k, v) {
    this._ensureLoaded();
    if (this._map.has(k)) this._map.delete(k);
    this._map.set(k, v);
    this._persist(k, v);
    if (this._map.size > this._cap) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._maybeCompact();
  }

  has(k) {
    this._ensureLoaded();
    return this._map.has(k);
  }

  get size() {
    this._ensureLoaded();
    return this._map.size;
  }

  delete(k) {
    this._ensureLoaded();
    return this._map.delete(k);
    // Persistence: deletes are NOT recorded; relies on compaction to
  }
}

module.exports = PersistentMap;
