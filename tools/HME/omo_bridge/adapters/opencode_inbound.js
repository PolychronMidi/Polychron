const { baseEvent, validate } = require('./common');

function toUniversalOpenCodeEvent(native = {}, options = {}) {
  const rawEventName = native.hook || native.event || options.rawEventName || 'unknown';
  const toolName = native.tool || native.tool_name || (native.action || {}).tool;
  const input = native.input || native.tool_input || (native.action || {}).input || {};
  const event = {
    ...baseEvent(native, options, { host: 'opencode', adapter: 'opencode_inbound', rawEventName }),
    phase: rawEventName,
    session: { id: native.sessionID || native.session_id, agent: 'opencode' },
    context: { capabilities: [rawEventName] },
  };
  if (toolName) event.tool = { name: toolName, input };
  if (rawEventName === 'permission.ask') {
    event.permission = {
      action: native.actionName || 'execute',
      target: toolName || '',
      risk: native.risk || 'low',
      reason: native.reason || 'OpenCode permission hook',
    };
  }
  return validate(event);
}

module.exports = { toUniversalOpenCodeEvent };
