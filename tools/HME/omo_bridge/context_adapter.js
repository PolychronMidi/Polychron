'use strict';
const { emitOmo } = require('./telemetry');
const store = new Map();
const DEFAULT_BUDGET = 4096;
function _key(sessionId) { return String(sessionId || 'unknown'); }
function _id(entry) { return `${entry.source || 'omo'}:${entry.id || entry.content || ''}`; }
function registerOmoContext(sessionId, entry, options = {}) {
  const sid = _key(sessionId);
  const content = String(entry && entry.content || '');
  if (!content) return { registered: false, reason: 'empty' };
  const maxBytes = options.maxBytes || DEFAULT_BUDGET;
  const normalized = { source: entry.source || 'omo', id: entry.id || _id(entry), content: Buffer.byteLength(content) > maxBytes ? content.slice(0, maxBytes) : content, priority: entry.priority || 'normal', metadata: entry.metadata || {} };
  const rows = store.get(sid) || [];
  if (rows.some((r) => _id(r) === _id(normalized))) return { registered: false, reason: 'duplicate' };
  rows.push(normalized);
  store.set(sid, rows);
  emitOmo('omo_context_registered', { session_id: sid, bytes: Buffer.byteLength(normalized.content), source: normalized.source }, options.telemetry);
  return { registered: true, entry: normalized };
}
function consumeOmoContext(sessionId, budget = DEFAULT_BUDGET, options = {}) {
  const sid = _key(sessionId);
  const rows = store.get(sid) || [];
  const priority = { critical: 0, high: 1, normal: 2, low: 3 };
  const out = [];
  let bytes = 0;
  for (const row of [...rows].sort((a, b) => (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2))) {
    const b = Buffer.byteLength(row.content);
    if (bytes + b > budget) continue;
    out.push(row);
    bytes += b;
  }
  emitOmo('omo_context_injected', { session_id: sid, count: out.length, bytes }, options.telemetry);
  return { entries: out, bytes };
}
function clearOmoContext(sessionId, filter = {}) {
  const sid = _key(sessionId);
  if (!filter || Object.keys(filter).length === 0) { store.delete(sid); return { cleared: true }; }
  const rows = (store.get(sid) || []).filter((r) => Object.entries(filter).some(([k, v]) => r[k] !== v));
  store.set(sid, rows);
  return { cleared: true, remaining: rows.length };
}
module.exports = { registerOmoContext, consumeOmoContext, clearOmoContext };
