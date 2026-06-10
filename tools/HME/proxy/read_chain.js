'use strict';

// Self-driven native Read chain.
//

const MARKER = 'hme_read_chain';

function _encodeQueue(files) {
  return Buffer.from(JSON.stringify(files), 'utf8').toString('base64');
}

function _decodeQueue(b64) {
  try {
    const arr = JSON.parse(Buffer.from(String(b64 || ''), 'base64').toString('utf8'));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (_e) {
    return [];
  }
}

// tool_use id carries the entire remaining queue + index so no session state is
// needed: hme_read_chain__<index>__<base64(files)>
function _toolId(index, files) {
  return `${MARKER}__${index}__${_encodeQueue(files)}`;
}

function _parseToolId(id) {
  const s = String(id || '');
  if (!s.startsWith(`${MARKER}__`)) return null;
  const rest = s.slice(MARKER.length + 2);
  const sep = rest.indexOf('__');
  if (sep < 0) return null;
  const index = Number(rest.slice(0, sep));
  const files = _decodeQueue(rest.slice(sep + 2));
  if (!Number.isInteger(index) || index < 0) return null;
  return { index, files };
}

// Build a synthetic Anthropic (non-streaming) message whose content is a single
// Read tool_use for files[index]. Returns null when the queue is exhausted.
function buildReadToolUseMessage(files, index, { model = 'claude-read-chain' } = {}) {
  if (!Array.isArray(files) || index >= files.length) return null;
  const filePath = String(files[index]);
  return {
    id: `msg_${MARKER}_${index}`,
    type: 'message',
    role: 'assistant',
    model,
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [
      {
        type: 'text',
        text: `[read-chain ${index + 1}/${files.length}] reading ${filePath}`,
      },
      {
        type: 'tool_use',
        id: _toolId(index, files),
        name: 'Read',
        input: { file_path: filePath },
      },
    ],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

// Build the terminal (no more reads) synthetic message.
function buildDoneMessage(count, { model = 'claude-read-chain' } = {}) {
  return {
    id: `msg_${MARKER}_done`,
    type: 'message',
    role: 'assistant',
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: `[read-chain] done: ${count} file(s) read automatically.` }],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function toAnthropicSse(message) {
  const events = [];
  const base = { ...message, content: [] };
  events.push(['message_start', { type: 'message_start', message: base }]);
  for (let i = 0; i < message.content.length; i += 1) {
    const block = message.content[i];
    events.push(['content_block_start', { type: 'content_block_start', index: i, content_block: block.type === 'tool_use'
      ? { type: 'tool_use', id: block.id, name: block.name, input: {} }
      : block }]);
    if (block.type === 'tool_use') {
      events.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) } }]);
    } else if (block.type === 'text' && block.text) {
      events.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: block.text } }]);
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
  }
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 0 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`).join('\n') + '\n';
}

// Inspect an inbound request payload. If the LAST user message is a tool_result
// echoing one of our read-chain tool_use ids, return the next-step descriptor so
function nextStepFromToolResult(payload) {
  if (!payload || !Array.isArray(payload.messages)) return null;
  for (let i = payload.messages.length - 1; i >= 0; i--) {
    const m = payload.messages[i];
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block && block.type === 'tool_result') {
        const parsed = _parseToolId(block.tool_use_id);
        if (parsed) return { nextIndex: parsed.index + 1, files: parsed.files };
      }
    }
    // Only inspect the most recent user turn.
    break;
  }
  return null;
}

// Detect a fresh read-chain start request: the last user message text begins with
// the read-chain trigger marker the wire shortcut expands to.
const TRIGGER_RE = /^\s*\[HME_READ_CHAIN\]\s*([\s\S]+)$/;

function startFilesFromTrigger(payload) {
  if (!payload || !Array.isArray(payload.messages)) return null;
  for (let i = payload.messages.length - 1; i >= 0; i--) {
    const m = payload.messages[i];
    if (!m || m.role !== 'user') continue;
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) {
      text = m.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
    }
    const match = TRIGGER_RE.exec(text);
    if (!match) return null;
    const files = match[1].split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
    return files.length ? files : null;
  }
  return null;
}

module.exports = {
  MARKER,
  buildReadToolUseMessage,
  buildDoneMessage,
  toAnthropicSse,
  nextStepFromToolResult,
  startFilesFromTrigger,
  _toolId,
  _parseToolId,
};
