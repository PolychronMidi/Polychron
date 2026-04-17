'use strict';
/**
 * SSE event transform stream.
 *
 * Reads raw bytes from an Anthropic SSE response, parses each complete event
 * (`event: <name>\ndata: <json>\n\n`), runs registered rewriters on the
 * parsed data, re-encodes, and pushes downstream.
 *
 * Rewriter signature:
 *   (eventName, data, ctx) => replacement
 *
 * Where `replacement` is one of:
 *   - `data` (unchanged or mutated object): emit 1 event with (eventName, data)
 *   - `null`: drop the event
 *   - `{ events: [[name, data], ...] }`: emit this list in order, replacing
 *     the incoming event (used for hold-and-rewrite patterns)
 *
 * Rewriters run left-to-right. When a rewriter returns `{events}`, the
 * remaining rewriters run on each element in the list.
 *
 * `ctx` is a Map shared across events for a single stream — use it to
 * accumulate tool_use input fragments across content_block_delta events.
 *
 * Non-SSE bytes pass through unchanged (comments `:` lines, keepalives).
 */

const { Transform } = require('stream');

class SseTransform extends Transform {
  constructor({ rewriters = [] } = {}) {
    super();
    this._rewriters = rewriters;
    this._buf = '';
    this._ctx = new Map();
  }

  _serializeEvent(eventName, data) {
    let out = '';
    if (eventName) out += `event: ${eventName}\n`;
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    for (const line of serialized.split('\n')) {
      out += `data: ${line}\n`;
    }
    out += '\n';
    return out;
  }

  _runRewriters(eventName, data, startIdx = 0) {
    // Returns an array of [name, data] pairs to emit.
    let working = [[eventName, data]];
    for (let i = startIdx; i < this._rewriters.length; i++) {
      const rw = this._rewriters[i];
      const next = [];
      for (const [name, d] of working) {
        let result;
        try { result = rw(name, d, this._ctx); }
        catch (err) {
          console.error(`[sse-transform] rewriter ${i} threw: ${err.message}`);
          next.push([name, d]);
          continue;
        }
        if (result === null) continue; // drop
        if (result && Array.isArray(result.events)) {
          for (const ev of result.events) next.push(ev);
          continue;
        }
        next.push([name, result]);
      }
      working = next;
      if (working.length === 0) return [];
    }
    return working;
  }

  _emitEvent(eventName, data) {
    const emitted = this._runRewriters(eventName, data);
    for (const [name, d] of emitted) {
      this.push(this._serializeEvent(name, d));
    }
  }

  _processBuffer() {
    let idx;
    while ((idx = this._buf.indexOf('\n\n')) !== -1) {
      const raw = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 2);
      if (!raw.trim()) continue; // empty event — just keepalive separator

      // Parse event:/data: lines
      let eventName = '';
      const dataLines = [];
      let isComment = false;
      for (const line of raw.split('\n')) {
        if (line.startsWith(':')) { isComment = true; continue; }
        if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue; }
        if (line.startsWith('data:')) { dataLines.push(line.slice(5).trim()); continue; }
      }
      if (isComment && dataLines.length === 0) {
        // Pure comment event (: ping) — pass through verbatim
        this.push(raw + '\n\n');
        continue;
      }
      if (dataLines.length === 0) {
        this.push(raw + '\n\n');
        continue;
      }

      const payloadStr = dataLines.join('\n');
      let data;
      try { data = JSON.parse(payloadStr); }
      catch (_err) {
        // Not JSON — forward verbatim.
        this.push(raw + '\n\n');
        continue;
      }
      this._emitEvent(eventName, data);
    }
  }

  _transform(chunk, _enc, cb) {
    this._buf += chunk.toString('utf8');
    try { this._processBuffer(); }
    catch (err) { return cb(err); }
    cb();
  }

  _flush(cb) {
    // Emit any trailing incomplete event as-is (rare — Anthropic terminates cleanly).
    if (this._buf.length > 0) this.push(this._buf);
    cb();
  }
}

module.exports = { SseTransform };
