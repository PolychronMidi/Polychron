const { DECISION_KINDS, DECISION_TARGETS } = require('./universal_decision');
const { SUPPORTED_PHASES } = require('./universal_event');

const HOSTS = Object.freeze(['anthropic', 'claude', 'codex', 'openai', 'opencode']);
const CAPABILITY_MODES = Object.freeze(['unsupported', 'advisory', 'enforcement']);
const SAFETY_CRITICAL_PHASES = Object.freeze(['permission.ask', 'tool.execute.before', 'stop.before']);
const SAFETY_CRITICAL_DECISIONS = Object.freeze(['deny', 'drop', 'inject', 'modify', 'rewrite', 'ask_permission']);

function freezeDecisionSpec(decisions = {}) {
  const frozen = {};
  for (const [kind, support] of Object.entries(decisions)) {
    if (!DECISION_KINDS.includes(kind)) throw new Error(`Unknown universal decision kind in capability map: ${kind}`);
    if (Array.isArray(support)) {
      const allowedTargets = DECISION_TARGETS[kind] || [];
      for (const target of support) {
        if (!allowedTargets.includes(target)) throw new Error(`Unknown ${kind} target in capability map: ${target}`);
      }
      frozen[kind] = Object.freeze([...support]);
    } else {
      frozen[kind] = support === true;
    }
  }
  return Object.freeze(frozen);
}

function capability(mode, decisions = {}) {
  if (!CAPABILITY_MODES.includes(mode)) throw new Error(`Unknown host capability mode: ${mode}`);
  return Object.freeze({ mode, decisions: freezeDecisionSpec(decisions) });
}

const UNSUPPORTED_CAPABILITY = capability('unsupported');
const OBSERVE_CAPABILITY = capability('advisory', { allow: true, defer: true });

function advisory(decisions = { allow: true, defer: true }) {
  return capability('advisory', decisions);
}

function enforcement(decisions) {
  return capability('enforcement', decisions);
}

function explicitPhaseMap(overrides) {
  const phases = {};
  for (const phase of SUPPORTED_PHASES) phases[phase] = UNSUPPORTED_CAPABILITY;
  for (const [phase, spec] of Object.entries(overrides)) {
    if (!SUPPORTED_PHASES.includes(phase)) throw new Error(`Unknown universal hook phase in capability map: ${phase}`);
    phases[phase] = spec;
  }
  return Object.freeze(phases);
}

const HOST_CAPABILITIES = Object.freeze({
  anthropic: explicitPhaseMap({
    'chat.params': enforcement({ allow: true, modify: ['chat.params'] }),
    'tool.execute.before': enforcement({ allow: true, deny: true }),
    'tool.execute.after': enforcement({ allow: true, deny: true }),
    'stop.before': enforcement({ allow: true, deny: true, inject: ['assistant', 'user', 'system'] }),
    'stream.text_block': enforcement({ allow: true, drop: ['stream.block'], rewrite: ['stream.text'] }),
    'session.start': OBSERVE_CAPABILITY,
    'session.end': OBSERVE_CAPABILITY,
    'message.input': OBSERVE_CAPABILITY,
    'message.output': OBSERVE_CAPABILITY,
    'stream.delta': OBSERVE_CAPABILITY,
    'policy.evaluate': OBSERVE_CAPABILITY,
    'telemetry.event': OBSERVE_CAPABILITY,
  }),
  claude: explicitPhaseMap({
    'permission.ask': enforcement({ allow: true, deny: true, ask_permission: true }),
    'tool.execute.before': enforcement({ allow: true, deny: true }),
    'tool.execute.after': enforcement({ allow: true, deny: true }),
    'stop.before': enforcement({ allow: true, deny: true }),
    'session.start': OBSERVE_CAPABILITY,
    'session.end': OBSERVE_CAPABILITY,
    'message.input': OBSERVE_CAPABILITY,
    'message.output': OBSERVE_CAPABILITY,
    'policy.evaluate': OBSERVE_CAPABILITY,
    'telemetry.event': OBSERVE_CAPABILITY,
  }),
  codex: explicitPhaseMap({
    'permission.ask': enforcement({ allow: true, deny: true, ask_permission: true }),
    'tool.execute.before': enforcement({ allow: true, deny: true }),
    'tool.execute.after': enforcement({ allow: true, deny: true }),
    'stop.before': enforcement({ allow: true, deny: true }),
    'session.start': OBSERVE_CAPABILITY,
    'session.end': OBSERVE_CAPABILITY,
    'message.input': OBSERVE_CAPABILITY,
    'message.output': OBSERVE_CAPABILITY,
    'policy.evaluate': OBSERVE_CAPABILITY,
    'telemetry.event': OBSERVE_CAPABILITY,
  }),
  openai: explicitPhaseMap({
    'chat.params': enforcement({ allow: true, modify: ['chat.params'] }),
    'tool.execute.before': enforcement({ allow: true, deny: true }),
    'tool.execute.after': advisory({ allow: true, defer: true }),
    'stop.before': enforcement({ allow: true, deny: true, inject: ['assistant', 'user', 'system'] }),
    'stream.text_block': enforcement({ allow: true, drop: ['stream.block'], rewrite: ['stream.text'] }),
    'session.start': OBSERVE_CAPABILITY,
    'session.end': OBSERVE_CAPABILITY,
    'message.input': OBSERVE_CAPABILITY,
    'message.output': OBSERVE_CAPABILITY,
    'stream.delta': OBSERVE_CAPABILITY,
    'policy.evaluate': OBSERVE_CAPABILITY,
    'telemetry.event': OBSERVE_CAPABILITY,
  }),
  opencode: explicitPhaseMap({
    'chat.params': enforcement({ allow: true, modify: ['chat.params'] }),
    'permission.ask': enforcement({ allow: true, deny: true, ask_permission: true }),
    'tool.execute.before': enforcement({ allow: true, deny: true, modify: ['tool.input'] }),
    'tool.execute.after': advisory({ allow: true, defer: true }),
    'session.start': OBSERVE_CAPABILITY,
    'session.end': OBSERVE_CAPABILITY,
    'message.input': OBSERVE_CAPABILITY,
    'message.output': OBSERVE_CAPABILITY,
    'policy.evaluate': OBSERVE_CAPABILITY,
    'telemetry.event': OBSERVE_CAPABILITY,
  }),
});

function phaseCapabilities(host, phase) {
  return (HOST_CAPABILITIES[host] || {})[phase] || null;
}

function supportsTarget(support, target) {
  if (support === true) return true;
  if (Array.isArray(support)) return support.includes(target);
  return false;
}

function supportsDecision(host, phase, decision = {}) {
  const kind = typeof decision === 'string' ? decision : decision.kind;
  const target = typeof decision === 'string' ? undefined : decision.target;
  const capabilities = phaseCapabilities(host, phase);
  if (!capabilities || capabilities.mode === 'unsupported' || !kind) return false;
  return supportsTarget(capabilities.decisions[kind], target);
}

function shouldFailClosed(phase, kind) {
  if (kind === 'deny') return true;
  return SAFETY_CRITICAL_PHASES.includes(phase) && SAFETY_CRITICAL_DECISIONS.includes(kind);
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
    failClosed: shouldFailClosed(phase, kind),
    reason: `${host || 'unknown'} does not support ${kind || 'unknown'} for ${phase || 'unknown phase'}`,
  };
}

module.exports = {
  CAPABILITY_MODES,
  HOSTS,
  HOST_CAPABILITIES,
  SAFETY_CRITICAL_PHASES,
  phaseCapabilities,
  supportsDecision,
  unsupportedDecision,
};
