'use strict';
const { emitOmo } = require('./telemetry');
function _bytes(payload) { return Buffer.byteLength(JSON.stringify(payload || {})); }
function _messageKey(m) { return JSON.stringify({ role: m.role, content: m.content }); }
function _compatPrune(payload, protectedTools = []) {
  const out = JSON.parse(JSON.stringify(payload || {}));
  if (!Array.isArray(out.messages)) return { payload: out, duplicates_pruned: 0, protected_skipped: 0 };
  const seen = new Set();
  const kept = [];
  let duplicates = 0;
  let protectedSkipped = 0;
  for (const m of out.messages) {
    const hasProtectedTool = JSON.stringify(m).split(/[^A-Za-z0-9_:-]+/).some((x) => protectedTools.includes(x));
    const key = _messageKey(m);
    if (hasProtectedTool) { protectedSkipped += 1; kept.push(m); continue; }
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    kept.push(m);
  }
  out.messages = kept;
  return { payload: out, duplicates_pruned: duplicates, protected_skipped: protectedSkipped };
}
function pruneWithOmoSync(payload, options = {}) {
  const beforeBytes = _bytes(payload);
  emitOmo('omo_pruning_started', { route: options.route || '', model: options.model || '', before_bytes: beforeBytes }, options.telemetry);
  const result = _compatPrune(payload, options.protectedTools || []);
  const prunedPayload = result.payload || payload;
  const afterBytes = _bytes(prunedPayload);
  const changed = afterBytes !== beforeBytes;
  if (changed && payload && typeof payload === 'object') {
    for (const key of Object.keys(payload)) delete payload[key];
    Object.assign(payload, prunedPayload);
  }
  const out = { changed, beforeBytes, afterBytes, stats: result, payload };
  emitOmo('omo_pruning_completed', { route: options.route || '', model: options.model || '', before_bytes: beforeBytes, after_bytes: afterBytes, bytes_saved: beforeBytes - afterBytes, duplicates_pruned: result.duplicates_pruned || 0, protected_skipped: result.protected_skipped || 0, source: 'compat' }, options.telemetry);
  return out;
}

async function pruneWithOmo(payload, options = {}) {
  const beforeBytes = _bytes(payload);
  emitOmo('omo_pruning_started', { route: options.route || '', model: options.model || '', before_bytes: beforeBytes }, options.telemetry);
  let source = 'compat';
  let result;
  if (options.omo && typeof options.omo.prune === 'function') {
    source = 'omo';
    result = await options.omo.prune(payload, options);
  } else {
    result = _compatPrune(payload, options.protectedTools || []);
  }
  const prunedPayload = result.payload || payload;
  const afterBytes = _bytes(prunedPayload);
  const out = { changed: afterBytes !== beforeBytes, beforeBytes, afterBytes, stats: result, payload: prunedPayload };
  emitOmo('omo_pruning_completed', { route: options.route || '', model: options.model || '', before_bytes: beforeBytes, after_bytes: afterBytes, bytes_saved: beforeBytes - afterBytes, duplicates_pruned: result.duplicates_pruned || 0, protected_skipped: result.protected_skipped || 0, source }, options.telemetry);
  return out;
}
module.exports = { pruneWithOmo };
