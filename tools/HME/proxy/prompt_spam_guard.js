'use strict';

const QUOTA_PROBE_TEXT = 'quota';

function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
    } else if (block && typeof block === 'object') {
      if (block.type && block.type !== 'text' && block.type !== 'input_text') continue;
      if (typeof block.text === 'string') parts.push(block.text);
      else if (typeof block.content === 'string') parts.push(block.content);
    }
  }
  return parts.join('\n');
}

function messageText(message) {
  if (!message || typeof message !== 'object') return '';
  return textFromContent(message.content);
}

function contentHasToolResult(content) {
  return Array.isArray(content) && content.some((block) => block && typeof block === 'object' && block.type === 'tool_result');
}

function stripSystemReminderBlocks(text) {
  return String(text || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
}

function isNoopSystemReminderTurn(payload) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) return false;
  const lastUser = [...payload.messages].reverse().find((message) => message && message.role === 'user');
  if (!lastUser || contentHasToolResult(lastUser.content)) return false;
  const text = messageText(lastUser);
  const raw = String(text || '').trim();
  if (!raw) return true;
  if (!/<system-reminder>/i.test(raw)) return false;
  return stripSystemReminderBlocks(raw) === '';
}

function isCountTokensRequest(req) {
  return /\/v1\/messages\/count_tokens(?:\?|$)/.test(String((req && req.url) || ''));
}

function isTextEventStream(payload) {
  return payload && payload.stream === true;
}

function contentTypeJson(headers = {}) {
  return String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase().includes('json');
}

function responseInputText(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.type === 'message' || item.role) return textFromContent(item.content);
  return textFromContent(item);
}

function isSingleQuotaAnthropicPayload(payload) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length !== 1) return false;
  const message = payload.messages[0];
  return message && message.role === 'user' && normalizeText(messageText(message)) === QUOTA_PROBE_TEXT;
}

function isSingleQuotaOpenAiChatPayload(payload) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length !== 1) return false;
  const message = payload.messages[0];
  return message && message.role === 'user' && normalizeText(messageText(message)) === QUOTA_PROBE_TEXT;
}

function isSingleQuotaOpenAiResponsesPayload(payload) {
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'input')) return false;
  if (typeof payload.input === 'string') return normalizeText(payload.input) === QUOTA_PROBE_TEXT;
  if (!Array.isArray(payload.input) || payload.input.length !== 1) return false;
  const item = payload.input[0];
  if (typeof item === 'string') return normalizeText(item) === QUOTA_PROBE_TEXT;
  return normalizeText(responseInputText(item)) === QUOTA_PROBE_TEXT;
}

function isSingleQuotaProbe(payload) {
  return isSingleQuotaAnthropicPayload(payload)
    || isSingleQuotaOpenAiChatPayload(payload)
    || isSingleQuotaOpenAiResponsesPayload(payload);
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const NOOP_TURN_TEXT = String.fromCharCode(0x2063);

function anthropicEmptyResponse(payload, prefix = 'hme_empty') {
  return {
    id: `${prefix}_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: payload && payload.model ? payload.model : 'hme-proxy',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function anthropicTextResponse(payload, text, prefix = 'hme_text') {
  return {
    ...anthropicEmptyResponse(payload, prefix),
    content: [{ type: 'text', text: String(text || '') }],
  };
}

function anthropicTextSse(payload, text, prefix = 'hme_text') {
  const id = `${prefix}_${Date.now()}`;
  const model = payload && payload.model ? payload.model : 'hme-proxy';
  const events = [
    ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: String(text || '') } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function anthropicQuotaProbeResponse(payload) {
  return anthropicEmptyResponse(payload, 'hme_quota_probe');
}

function blockQuotaProbe({ res, payload, record, source = {}, component = 'hme-proxy' }) {
  if (record) {
    record({
      kind: 'quota-probe-blocked',
      source,
      model: payload && payload.model ? payload.model : '',
      reason: 'single user message content exactly quota',
    });
  }
  jsonResponse(res, 200, anthropicQuotaProbeResponse(payload));
}

function toolNames(payload) {
  return Array.isArray(payload && payload.tools)
    ? payload.tools.map((tool) => tool && tool.name).filter(Boolean)
    : [];
}

function headerHas(headers, name, needle) {
  const raw = headers && headers[name];
  if (!raw) return false;
  const value = Array.isArray(raw) ? raw.join(',') : String(raw);
  return value.toLowerCase().includes(String(needle).toLowerCase());
}

function isStructuredOutputsProbe(payload, headers) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length !== 1) return false;
  if (!headerHas(headers, 'anthropic-beta', 'structured-outputs')) return false;
  const names = toolNames(payload);
  if (names.length === 0) return true;
  if (names.length === 1 && names[0] === 'TodoWrite') return true;
  return false;
}

function isTodoWriteOnlyProbe(payload) {
  const names = toolNames(payload);
  return names.length === 1 && names[0] === 'TodoWrite'
    && payload && Array.isArray(payload.messages) && payload.messages.length === 1;
}

function blockNoopSystemReminderTurn({ req, res, payload, record, source = {} }) {
  if (record) {
    record({
      kind: 'noop-system-reminder-turn-blocked',
      source,
      model: payload && payload.model ? payload.model : '',
      reason: 'last user message is empty or system-reminder-only',
    });
  }
  if (isCountTokensRequest(req)) {
    jsonResponse(res, 200, { input_tokens: 0 });
    return;
  }
  if (isTextEventStream(payload)) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(anthropicTextSse(payload, NOOP_TURN_TEXT, 'hme_noop_turn'));
    return;
  }
  jsonResponse(res, 200, anthropicTextResponse(payload, NOOP_TURN_TEXT, 'hme_noop_turn'));
}

function shouldBlockNoopSystemReminderTurn({ req, payload, headers }) {
  return contentTypeJson(headers || (req && req.headers))
    && (isCountTokensRequest(req) || isNoopSystemReminderTurn(payload));
}

function blockTodoWriteOnlyProbe({ res, payload, record, source = {}, component = 'hme-proxy' }) {
  if (record) {
    record({
      kind: 'todowrite-only-probe-blocked',
      source,
      model: payload && payload.model ? payload.model : '',
      reason: 'single-message TodoWrite-only structured-output probe',
    });
  }
  jsonResponse(res, 200, anthropicEmptyResponse(payload, 'hme_todowrite_probe'));
}

function blockStructuredOutputsProbe({ res, payload, record, source = {}, component = 'hme-proxy' }) {
  if (record) {
    record({
      kind: 'structured-outputs-probe-blocked',
      source,
      model: payload && payload.model ? payload.model : '',
      reason: 'single-message structured-outputs beta probe',
    });
  }
  jsonResponse(res, 200, anthropicEmptyResponse(payload, 'hme_structured_outputs_probe'));
}

module.exports = {
  QUOTA_PROBE_TEXT,
  textFromContent,
  messageText,
  responseInputText,
  isSingleQuotaProbe,
  isSingleQuotaAnthropicPayload,
  isSingleQuotaOpenAiChatPayload,
  isSingleQuotaOpenAiResponsesPayload,
  isTodoWriteOnlyProbe,
  isStructuredOutputsProbe,
  blockQuotaProbe,
  blockTodoWriteOnlyProbe,
  blockStructuredOutputsProbe,
};
