'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, emit } = require('./shared');

function normalizePlan(raw) {
  const plan = raw && typeof raw === 'object' ? raw : { threshold: raw };
  const threshold = Number(plan.threshold == null ? 250000 : plan.threshold);
  const maxTier = Number(plan.maxTier == null ? 4 : plan.maxTier);
  return {
    threshold: threshold === Infinity || Number.isFinite(threshold) ? threshold : 250000,
    maxTier: Number.isFinite(maxTier) ? maxTier : 4,
    keepMin: Number(plan.keepMin),
    maxToolResultAge: Number(plan.maxToolResultAge),
    toolResultByteFloor: Number(plan.toolResultByteFloor),
  };
}

function _emitCompaction(row, telemetry) {
  try {
    const sink = telemetry === false ? null : (typeof telemetry === 'function' ? telemetry : emit);
    if (sink) sink({ event: 'context_compaction', ...row });
  } catch (_e) { /* silent-ok: telemetry must not affect request path */ }
}

function _serializedBytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

function shrinkForPassthrough(payload, opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || console.error;
  const telemetry = opts.telemetry;
  const route = opts.route || 'passthrough';
  const model = opts.model || payload && (payload.model || payload.target_model || payload.original_model) || '';
  let keepMin = Number(opts.keepMin || 10);
  let maxToolResultAge = Number(opts.maxToolResultAge == null ? 0 : opts.maxToolResultAge);
  let toolResultByteFloor = Number(opts.toolResultByteFloor || 15000);
  const projectRoot = opts.projectRoot || PROJECT_ROOT;
  if (env.HME_NO_PASSTHROUGH_COMPACT === '1') return 0;
  if (!payload || !Array.isArray(payload.messages)) return 0;
  const rawPlan = typeof opts.effectiveThreshold === 'function' ? opts.effectiveThreshold(payload) : opts.threshold || 250000;
  const plan = normalizePlan(rawPlan);
  const { threshold, maxTier } = plan;
  if (Number.isFinite(plan.keepMin) && plan.keepMin > 0) keepMin = Math.floor(plan.keepMin);
  if (Number.isFinite(plan.maxToolResultAge) && plan.maxToolResultAge >= 0) maxToolResultAge = Math.floor(plan.maxToolResultAge);
  if (Number.isFinite(plan.toolResultByteFloor) && plan.toolResultByteFloor > 0) toolResultByteFloor = Math.floor(plan.toolResultByteFloor);
  const msgs = payload.messages;
  if (msgs.length <= keepMin) return 0;
  const beforeMessages = msgs.length;
  let beforeBytes = _serializedBytes(payload);
  let serialized = JSON.stringify(payload);
  if (maxTier <= 0 || beforeBytes <= threshold) return 0;
  log(`passthrough-compact decision: tier=${maxTier} threshold=${Number.isFinite(threshold) ? `${threshold}B` : 'none'} body=${beforeBytes}B keepMin=${keepMin}`);

  const recentStart = maxToolResultAge > 0 ? Math.max(0, msgs.length - maxToolResultAge) : 0;
  let elided = 0;
  for (let i = 0; i < recentStart; i += 1) {
    const m = msgs[i];
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || b.type !== 'tool_result') continue;
      const cstr = typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? JSON.stringify(b.content) : '');
      if (cstr.length < toolResultByteFloor) continue;
      b.content = `(content elided by hme-proxy precompact: original was ${cstr.length}B)`;
      elided += 1;
    }
  }
  if (elided > 0) {
    serialized = JSON.stringify(payload);
    const afterBytes = _serializedBytes(payload);
    log(`precompact tier-1 (microcompact): elided ${elided} stale tool_result block(s), body=${afterBytes}B`);
    if (afterBytes <= threshold) {
      log('precompact: tier-1 sufficient, no message drops needed');
      _emitCompaction({ route, model, stage: 'microcompact', tier: maxTier, before_bytes: beforeBytes, after_bytes: afterBytes, threshold_bytes: Number.isFinite(threshold) ? threshold : 0, before_messages: beforeMessages, after_messages: msgs.length, messages_dropped: 0, stale_tool_results_elided: elided, orphan_tool_blocks_scrubbed: 0, emergency_tail_elided: 0, keep_min: keepMin }, telemetry);
      return elided;
    }
  }

  if (maxTier >= 2 && env.HME_PROXY_LOCAL_SUMMARY === '1' && msgs.length > keepMin * 2) {
    const half = Math.floor(msgs.length / 2);
    msgs.splice(0, half, { role: 'user', content: `(hme-proxy local-summary placeholder: ${half} oldest messages compacted)` });
    serialized = JSON.stringify(payload);
    log(`precompact tier-2 (local-summary): collapsed ${half} oldest msgs into 1 marker, body=${serialized.length}B`);
    if (serialized.length <= threshold) return elided + half;
  }

  try {
    const notesPath = path.join(projectRoot, 'tmp', 'hme-session-notes.txt');
    if (maxTier >= 2 && fs.existsSync(notesPath) && msgs.length > keepMin * 2) {
      const notes = fs.readFileSync(notesPath, 'utf8');
      if (notes) {
        const half = Math.floor(msgs.length / 2);
        msgs.splice(0, half, { role: 'user', content: `(hme-proxy session-memory compact: ${half} oldest messages summarized)\n\n${notes.slice(0, 8_000)}` });
        serialized = JSON.stringify(payload);
        log(`precompact tier-3 (session-memory): used pre-extracted notes (${notes.length}B), body=${serialized.length}B`);
        if (serialized.length <= threshold) return elided + half;
      }
    }
  } catch (_err) { /* best effort */ }

  let dropped = 0;
  if (maxTier >= 3) {
    while (msgs.length > keepMin) {
      msgs.shift();
      dropped += 1;
      serialized = JSON.stringify(payload);
      if (serialized.length <= threshold) break;
    }
  }
  while (maxTier >= 3 && msgs.length > keepMin) {
    const first = msgs[0];
    if (!first || !Array.isArray(first.content)) break;
    const onlyOrphanResults = first.role === 'user'
      && first.content.length > 0
      && first.content.every((b) => b && b.type === 'tool_result');
    if (!onlyOrphanResults) break;
    msgs.shift();
    dropped += 1;
  }

  const survivingUseIds = new Set();
  const survivingResultIds = new Set();
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use' && b.id) survivingUseIds.add(b.id);
      if (b.type === 'tool_result' && b.tool_use_id) survivingResultIds.add(b.tool_use_id);
    }
  }
  let orphans = 0;
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    const before = m.content.length;
    const origTexts = [];
    for (const b of m.content) {
      if (b && typeof b === 'object' && typeof b.text === 'string') origTexts.push(b.text);
      if (b && typeof b === 'object' && b.type === 'tool_result' && typeof b.content === 'string') origTexts.push(b.content);
    }
    m.content = m.content.filter((b) => {
      if (!b || typeof b !== 'object') return true;
      if (b.type === 'tool_result' && b.tool_use_id && !survivingUseIds.has(b.tool_use_id)) return false;
      if (b.type === 'tool_use' && b.id && !survivingResultIds.has(b.id)) return false;
      return true;
    });
    orphans += before - m.content.length;
    if (m.content.length === 0) {
      const ofMatch = origTexts.join(' ').match(/output_file:\s*(\S+)/);
      m.content = [{ type: 'text', text: ofMatch ? `(hme-proxy compact: agent output at ${ofMatch[1]})` : '(content stripped by passthrough-compact)' }];
    }
  }
  let tailElided = 0;
  serialized = JSON.stringify(payload);
  if (maxTier >= 3 && serialized.length > threshold) {
    outer: for (const m of msgs) {
      if (!m || !Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (!b || b.type !== 'tool_result') continue;
        const cstr = typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? JSON.stringify(b.content) : '');
        if (cstr.length < toolResultByteFloor) continue;
        b.content = `(content elided by hme-proxy emergency tail-compact: original was ${cstr.length}B)`;
        tailElided += 1;
        serialized = JSON.stringify(payload);
        if (serialized.length <= threshold) break outer;
      }
    }
  }
  if (dropped > 0 && msgs[0] && msgs[0].role === 'assistant') {
    msgs.unshift({ role: 'user', content: `[hme-proxy passthrough-compact: ${dropped} oldest message(s) dropped to fit configured context budget]` });
  }
  serialized = JSON.stringify(payload);
  log(`passthrough-compact: dropped ${dropped} oldest messages, scrubbed ${orphans} orphan tool blocks, emergency-elided ${tailElided} tail tool_result blocks (now ${msgs.length} msgs, body=${serialized.length}B)`);
  return dropped + tailElided + elided;
}

module.exports = { shrinkForPassthrough };
