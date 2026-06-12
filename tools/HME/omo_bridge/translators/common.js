const { assertUniversalDecision } = require('../universal_decision');
const { supportsDecision, unsupportedDecision } = require('../host_capabilities');

function guardDecision(host, phase, decision) {
  assertUniversalDecision(decision);
  if (!supportsDecision(host, phase, decision)) return unsupportedDecision(host, phase, decision);
  return null;
}

function hookEventName(phase, fallback = '') {
  if (phase === 'tool.execute.before') return 'PreToolUse';
  if (phase === 'tool.execute.after') return 'PostToolUse';
  if (phase === 'stop.before') return 'Stop';
  return fallback || phase;
}

module.exports = { guardDecision, hookEventName };
