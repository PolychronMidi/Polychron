'use strict';

function _json(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_e) { return {}; }
}

function normalize(input = {}) {
  const envelope = typeof input === 'string' ? _json(input) : (input || {});
  let toolInput = envelope.tool_input || {};
  if (typeof toolInput === 'string') toolInput = _json(toolInput);
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) toolInput = {};
  const toolResponse = envelope.tool_response || envelope.tool_output || {};
  return {
    raw: envelope,
    session_id: envelope.session_id || envelope.agent_id || '',
    agent_id: envelope.agent_id || '',
    agent_type: envelope.agent_type || '',
    event: envelope.hook_event_name || '',
    tool_name: envelope.tool_name || '',
    tool_input: toolInput,
    tool_response: toolResponse,
    is_error: Boolean(envelope.tool_result_is_error || envelope.is_error),
    file_path: toolInput.file_path || toolInput.path || '',
    content: toolInput.content || '',
    old_string: toolInput.old_string || '',
    new_string: toolInput.new_string || '',
    command: toolInput.command || '',
  };
}

module.exports = { normalize };
