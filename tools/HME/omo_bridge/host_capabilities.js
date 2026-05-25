const HOST_CAPABILITIES = Object.freeze({
  anthropic: Object.freeze({
    'chat.params': Object.freeze({ allow: true, modify: Object.freeze(['chat.params']) }),
    'stream.text_block': Object.freeze({ allow: true, drop: Object.freeze(['stream.block']), rewrite: Object.freeze(['stream.text']) }),
    'tool.execute.before': Object.freeze({ allow: true, deny: true }),
    'tool.execute.after': Object.freeze({ allow: true, deny: true }),
    'stop.before': Object.freeze({ allow: true, deny: true, inject: Object.freeze(['assistant', 'user', 'system']) }),
  }),
  claude: Object.freeze({
    'permission.ask': Object.freeze({ allow: true, deny: true, ask_permission: true }),
    'tool.execute.before': Object.freeze({ allow: true, deny: true }),
    'tool.execute.after': Object.freeze({ allow: true, deny: true }),
    'stop.before': Object.freeze({ allow: true, deny: true }),
  }),
  codex: Object.freeze({
    'permission.ask': Object.freeze({ allow: true, deny: true, ask_permission: true }),
    'tool.execute.before': Object.freeze({ allow: true, deny: true }),
    'tool.execute.after': Object.freeze({ allow: true, deny: true }),
    'stop.before': Object.freeze({ allow: true, deny: true }),
  }),
  openai: Object.freeze({
    'chat.params': Object.freeze({ allow: true, modify: Object.freeze(['chat.params']) }),
    'stream.text_block': Object.freeze({ allow: true, drop: Object.freeze(['stream.block']), rewrite: Object.freeze(['stream.text']) }),
    'tool.execute.before': Object.freeze({ allow: true, deny: true }),
    'tool.execute.after': Object.freeze({ allow: true }),
    'stop.before': Object.freeze({ allow: true, deny: true, inject: Object.freeze(['assistant', 'user', 'system']) }),
  }),
  opencode: Object.freeze({
    'chat.params': Object.freeze({ allow: true, modify: Object.freeze(['chat.params']) }),
    'permission.ask': Object.freeze({ allow: true, deny: true, ask_permission: true }),
    'tool.execute.before': Object.freeze({ allow: true, deny: true, modify: Object.freeze(['tool.input']) }),
    'tool.execute.after': Object.freeze({ allow: true }),
  }),
});

const SAFETY_CRITICAL_PHASES = new Set(['permission.ask', 'tool.execute.before', 'stop.before']);

function phaseCapabilities(host, phase) {
  return (HOST_CAPABILITIES[host] || {})[phase] || null;
}

function supportsDecision(host, phase, decision = {}) {
  const kind = typeof decision === 'string' ? decision : decision.kind;
  const target = typeof decision === 'string' ? undefined : decision.target;
  const capabilities = phaseCapabilities(host, phase);
  if (!capabilities || !kind) return false;
  const support = capabilities[kind];
  if (support === true) return true;
  if (Array.isArray(support)) return support.includes(target);
  return false;
}

function unsupportedDecision(host, phase, decision = {}) {
  const kind = typeof decision === 'string' ? decision : decision.kind;
  const target = typeof decision === 'string' ? undefined : decision.target;
  return {
    unsupported: true,
    host,
    phase,
    decisionKind: kind || '',
    target: target || '',
    failClosed: kind === 'deny' || SAFETY_CRITICAL_PHASES.has(phase),
    reason: `${host || 'unknown'} does not support ${kind || 'unknown'} for ${phase || 'unknown phase'}`,
  };
}

module.exports = {
  HOST_CAPABILITIES,
  phaseCapabilities,
  supportsDecision,
  unsupportedDecision,
};
