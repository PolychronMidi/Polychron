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
  blockQuotaProbe,
  blockTodoWriteOnlyProbe,
};
