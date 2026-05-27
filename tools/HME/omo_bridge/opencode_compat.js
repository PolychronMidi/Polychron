const { SUPPORTED_PHASES } = require('./universal_event');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function diffPatch(before = {}, after = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) patch[key] = value;
  }
  return patch;
}

function permissionDecision(output = {}) {
  if (output.status === 'deny') return { kind: 'deny', reason: 'OpenCode permission denied', machineCode: 'opencode_permission_denied' };
  if (output.status === 'ask') return { kind: 'ask_permission', prompt: 'OpenCode permission requested', choices: ['allow', 'deny'], default: 'deny' };
  return { kind: 'allow' };
}

function returnedDecision(output) {
  if (!output || typeof output !== 'object') return null;
  if (output.decision && typeof output.decision === 'object') return output.decision;
  if (typeof output.kind === 'string') return output;
  if (output.status === 'deny' || output.status === 'ask') return permissionDecision(output);
  return null;
}

function chatParamsAdapter(event) {
  const before = event.chat && event.chat.params ? cloneJson(event.chat.params) : {};
  const output = { ...before, maxOutputTokens: before.max_tokens ?? before.maxOutputTokens };
  return {
    input: { sessionID: event.session && event.session.id, agent: event.session && event.session.agent, model: { id: before.model }, provider: { id: event.source.host }, message: (event.chat && event.chat.messages || [])[0] || {} },
    output,
    decision() {
      const after = { ...output };
      if (Object.prototype.hasOwnProperty.call(after, 'maxOutputTokens')) after.max_tokens = after.maxOutputTokens;
      delete after.maxOutputTokens;
      const patch = diffPatch(before, after);
      return Object.keys(patch).length ? { kind: 'modify', target: 'chat.params', patch, reason: 'OpenCode chat.params mutation' } : { kind: 'allow' };
    },
  };
}

function permissionAdapter(event) {
  const output = { status: 'allow' };
  return { input: event.permission || event.tool || {}, output, decision: () => permissionDecision(output) };
}

function toolBeforeAdapter(event) {
  const before = cloneJson(event.tool && event.tool.input);
  const output = { args: cloneJson(before) };
  return {
    input: { tool: event.tool && event.tool.name, sessionID: event.session && event.session.id, callID: event.tool && event.tool.id },
    output,
    decision: () => (JSON.stringify(before) === JSON.stringify(output.args) ? { kind: 'allow' } : { kind: 'modify', target: 'tool.input', patch: output.args, reason: 'OpenCode tool args mutation' }),
  };
}

function adapterFor(event) {
  if (event.phase === 'chat.params') return chatParamsAdapter(event);
  if (event.phase === 'permission.ask') return permissionAdapter(event);
  if (event.phase === 'tool.execute.before') return toolBeforeAdapter(event);
  return { input: event, output: {}, decision: () => ({ kind: 'allow' }) };
}

function defaultCapabilities(phases) {
  const decisions = ['allow', 'deny', 'ask_permission', 'modify'];
  return { decisions, targets: { modify: ['chat.params', 'tool.input'] }, effects: ['telemetry', 'log', 'counter'] };
}

function createOpenCodeCompatPlugin(hooks = {}, options = {}) {
  const phases = Object.keys(hooks).filter((phase) => SUPPORTED_PHASES.includes(phase));
  return {
    name: options.name || hooks.name || 'opencode-compat-plugin',
    trust: options.trust || 'project',
    phases,
    capabilities: options.capabilities || defaultCapabilities(phases),
    async handler(event) {
      const hook = hooks[event.phase];
      if (typeof hook !== 'function') return { kind: 'allow' };
      const call = adapterFor(event);
      const returned = await hook(call.input, call.output);
      const directDecision = returnedDecision(returned);
      if (directDecision) return directDecision;
      return call.decision();
    },
  };
}

module.exports = { createOpenCodeCompatPlugin };
