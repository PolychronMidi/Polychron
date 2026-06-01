const { baseEvent, lifecycle, validate } = require('./common');

function toUniversalCodexEvent(native = {}, options = {}) {
  const rawEventName = native.event || options.rawEventName || 'unknown';
  const common = baseEvent(native, options, { host: 'codex', adapter: 'codex_inbound', rawEventName });
  if (rawEventName === 'Stop') {
    return validate({
      ...common,
      phase: 'stop.before',
      session: { id: native.session_id, agent: 'codex' },
      turn: { assistantText: native.last_assistant_text || '', transcriptPath: native.transcript_path || '' },
      context: lifecycle(rawEventName),
    });
  }
  const phase = rawEventName === 'PostToolUse' ? 'tool.execute.after' : 'tool.execute.before';
  return validate({
    ...common,
    phase,
    session: { id: native.session_id, agent: 'codex' },
    tool: {
      id: native.tool_call_id || native.tool_use_id,
      name: native.tool_name,
      input: native.arguments || native.tool_input || {},
    },
    context: lifecycle(rawEventName),
  });
}

module.exports = { toUniversalCodexEvent };
