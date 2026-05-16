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

function sanitizeMessages(payload, placeholder = SUCCESS_EMPTY) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  let dropped = 0;
  for (const msg of payload.messages) {
    if (!msg || !Array.isArray(msg.content)) continue;
    const before = msg.content.length;
    msg.content = msg.content.filter((b) => b && !(b.type === 'text' && typeof b.text === 'string' && b.text.trim().length === 0));
    dropped += before - msg.content.length;
    if (msg.content.length === 0) msg.content = [{ type: 'text', text: placeholder }];
  }
  return dropped;
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
