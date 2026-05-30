'use strict';

const { SUCCESS_EMPTY } = require('./tool_result_semantics');

function blockText(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text') return block.text || '';
  if (block.type === 'tool_result') {
    const c = block.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

function stripStaleToolResults(payload, keepTurns = 7) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  const msgs = payload.messages;
  let userWithToolResults = 0;
  const strippedIds = new Set();
  let stripped = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
    const toolResults = m.content.filter((b) => b && b.type === 'tool_result');
    if (!toolResults.length) continue;
    userWithToolResults++;
    if (userWithToolResults > keepTurns) {
      for (const b of toolResults) strippedIds.add(b.tool_use_id);
      const before = m.content.length;
      m.content = m.content.filter((b) => !b || b.type !== 'tool_result');
      stripped += before - m.content.length;
    }
  }
  if (strippedIds.size > 0) {
    for (const m of msgs) {
      if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      const before = m.content.length;
      m.content = m.content.filter((b) => !b || b.type !== 'tool_use' || !strippedIds.has(b.id));
      stripped += before - m.content.length;
    }
  }
  return stripped;
}

function scrubOrphanToolPairs(payload) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  const useIds = new Set();
  const resultIds = new Set();
  for (const m of payload.messages) {
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b && b.type === 'tool_use' && b.id) useIds.add(b.id);
      if (b && b.type === 'tool_result' && b.tool_use_id) resultIds.add(b.tool_use_id);
    }
  }
  let scrubbed = 0;
  for (const m of payload.messages) {
    if (!m || !Array.isArray(m.content)) continue;
    const before = m.content.length;
    const original = m.content.map(blockText).join(' ');
    m.content = m.content.filter((b) => {
      if (!b || typeof b !== 'object') return true;
      if (b.type === 'tool_result' && b.tool_use_id && !useIds.has(b.tool_use_id)) return false;
      if (b.type === 'tool_use' && b.id && !resultIds.has(b.id)) return false;
      return true;
    });
    scrubbed += before - m.content.length;
    if (m.content.length === 0) {
      const outFile = original.match(/output_file:\s*(\S+)/);
      m.content = [{ type: 'text', text: outFile ? `(hme-proxy compact: agent output at ${outFile[1]})` : SUCCESS_EMPTY }];
    }
  }
  return scrubbed;
}

function _allMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockText).filter(Boolean).join('\n');
  return '';
}

function _hoistToSystem(payload, text) {
  const t = String(text || '').trim();
  if (!t) return;
  if (payload.system == null) payload.system = [];
  else if (typeof payload.system === 'string') payload.system = payload.system.trim() ? [{ type: 'text', text: payload.system }] : [];
  if (!Array.isArray(payload.system)) return;
  payload.system.push({ type: 'text', text: t });
}

function sanitizeMessages(payload, placeholder = SUCCESS_EMPTY) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  let changed = 0;
  // Anthropic's messages array accepts ONLY role user/assistant. A role:system
  // message -- e.g. one whose whole body was a <system-reminder> that provenance
  const kept = [];
  for (const msg of payload.messages) {
    if (msg && (msg.role === 'user' || msg.role === 'assistant')) { kept.push(msg); continue; }
    _hoistToSystem(payload, msg && _allMessageText(msg.content));
    changed++;
  }
  if (kept.length !== payload.messages.length) payload.messages = kept;
  for (const msg of payload.messages) {
    if (!msg) continue;
    // Non-array content (string / null / malformed). The upstream rejects any
    // message whose content is empty -- e.g. "messages.N: system content must
    if (!Array.isArray(msg.content)) {
      if (typeof msg.content !== 'string' || msg.content.trim().length === 0) {
        msg.content = placeholder;
        changed++;
      }
      continue;
    }
    const before = msg.content.length;
    msg.content = msg.content.filter((b) => {
      if (!b) return false;
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim().length === 0) return false;
      if (b.type === 'thinking' && !String(b.signature || '').trim()) return false;
      return true;
    });
    changed += before - msg.content.length;
    for (const block of msg.content) {
      if (!block || block.type !== 'tool_result') continue;
      const text = blockText(block);
      if (text && text.trim().length > 0) continue;
      const marker = block.is_error === true ? '[FAIL] tool returned no error text' : placeholder;
      if (Array.isArray(block.content)) {
        block.content = [{ type: 'text', text: marker }];
      } else {
        block.content = marker;
      }
      changed++;
    }
    if (msg.content.length === 0) msg.content = [{ type: 'text', text: placeholder }];
  }
  return changed;
}

function toGraph(payload) {
  return ((payload && payload.messages) || []).map((m) => ({
    role: m.role || '',
    blocks: Array.isArray(m.content) ? m.content.map((b) => ({
      kind: b && b.type === 'tool_use' ? 'tool_use' : (b && b.type === 'tool_result' ? 'tool_result' : 'text'),
      id: b && (b.id || b.tool_use_id) || '',
      name: b && b.name || '',
      text: blockText(b),
    })) : [{ kind: 'text', text: typeof m.content === 'string' ? m.content : '' }],
  }));
}

module.exports = { blockText, stripStaleToolResults, scrubOrphanToolPairs, sanitizeMessages, toGraph };
