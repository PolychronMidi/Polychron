const { baseEvent, lifecycle, validate } = require('./common');

function toUniversalClaudeEvent(native = {}, options = {}) {
  const rawEventName = native.event || options.rawEventName || 'unknown';
  const common = baseEvent(native, options, { host: 'claude', adapter: 'claude_inbound', rawEventName });
  if (rawEventName === 'Stop') {
    return validate({
      ...common,
      phase: 'stop.before',
      session: { id: native.session_id, agent: 'claude' },
      turn: { assistantText: native.last_assistant_text || '', transcriptPath: native.transcript_path || '' },
      context: lifecycle(rawEventName),
    });
  }
  const phase = rawEventName === 'PostToolUse' ? 'tool.execute.after' : 'tool.execute.before';
  return validate({
    ...common,
    phase,
    session: {
      id: native.session_id,
      cwd: native.cwd,
      projectRoot: options.projectRoot || native.project_root || native.cwd,
      agent: 'claude',
    },
    tool: { id: native.tool_use_id, name: native.tool_name, input: native.tool_input || {} },
    context: lifecycle(rawEventName),
  });
}

module.exports = { toUniversalClaudeEvent };
