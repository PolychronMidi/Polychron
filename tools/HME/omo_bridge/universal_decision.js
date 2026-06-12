const { isPlainObject } = require('./universal_event');

const DECISION_KINDS = Object.freeze([
  'allow',
  'deny',
  'modify',
  'rewrite',
  'drop',
  'inject',
  'ask_permission',
  'defer',
]);

const DECISION_TARGETS = Object.freeze({
  modify: Object.freeze(['chat.params', 'tool.input', 'message', 'context']),
  rewrite: Object.freeze(['stream.text', 'assistant.text', 'tool.output']),
  drop: Object.freeze(['stream.block', 'message.part', 'tool.call']),
  inject: Object.freeze(['system', 'user', 'assistant', 'tool']),
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function pushTargetError(errors, decision, kind) {
  if (!DECISION_TARGETS[kind].includes(decision.target)) errors.push(`${kind} target must be one of: ${DECISION_TARGETS[kind].join(', ')}`);
}

function validateEffects(errors, effects) {
  if (effects === undefined) return;
  if (!Array.isArray(effects)) {
    errors.push('effects must be an array');
    return;
  }
  effects.forEach((effect, index) => {
    if (!isPlainObject(effect)) errors.push(`effects[${index}] must be an object`);
    else if (typeof effect.kind !== 'string') errors.push(`effects[${index}].kind must be a string`);
  });
}

function validateUniversalDecision(decision = {}) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['decision must be an object'] };
  if (!DECISION_KINDS.includes(decision.kind)) errors.push(`kind must be one of: ${DECISION_KINDS.join(', ')}`);
  validateEffects(errors, decision.effects);
  if (decision.kind === 'deny' && typeof decision.reason !== 'string') errors.push('deny requires reason');
  if (decision.kind === 'modify') {
    pushTargetError(errors, decision, 'modify');
    if (!hasOwn(decision, 'patch')) errors.push('modify requires patch');
  }
  if (decision.kind === 'rewrite') {
    pushTargetError(errors, decision, 'rewrite');
    if (typeof decision.text !== 'string') errors.push('rewrite requires text');
  }
  if (decision.kind === 'drop') pushTargetError(errors, decision, 'drop');
  if (decision.kind === 'inject') {
    pushTargetError(errors, decision, 'inject');
    if (!hasOwn(decision, 'payload')) errors.push('inject requires payload');
  }
  if (decision.kind === 'ask_permission' && typeof decision.prompt !== 'string') errors.push('ask_permission requires prompt');
  return { valid: errors.length === 0, errors };
}

function assertUniversalDecision(decision) {
  const result = validateUniversalDecision(decision);
  if (!result.valid) throw new Error(`Invalid universal hook decision: ${result.errors.join('; ')}`);
  return decision;
}

module.exports = {
  DECISION_KINDS,
  DECISION_TARGETS,
  assertUniversalDecision,
  validateUniversalDecision,
};
