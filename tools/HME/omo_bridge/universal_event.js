const UNIVERSAL_HOOK_ABI = 'hme-opencode-hook/v1';

const PHASE_GROUPS = Object.freeze({
  core: Object.freeze(['chat.params', 'permission.ask', 'tool.execute.before', 'tool.execute.after']),
  hmeExtension: Object.freeze(['stop.before', 'stream.text_block']),
  observational: Object.freeze([
    'session.start',
    'session.end',
    'message.input',
    'message.output',
    'stream.delta',
    'policy.evaluate',
    'telemetry.event',
  ]),
});

const SUPPORTED_PHASES = Object.freeze([
  ...PHASE_GROUPS.core,
  ...PHASE_GROUPS.hmeExtension,
  ...PHASE_GROUPS.observational,
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushObjectError(errors, event, key) {
  if (event[key] !== undefined && !isPlainObject(event[key])) errors.push(`${key} must be an object`);
}

function validateUniversalEvent(event = {}) {
  const errors = [];
  if (!isPlainObject(event)) return { valid: false, errors: ['event must be an object'] };
  if (event.abi !== UNIVERSAL_HOOK_ABI) errors.push(`abi must be ${UNIVERSAL_HOOK_ABI}`);
  if (!SUPPORTED_PHASES.includes(event.phase)) errors.push(`phase must be one of: ${SUPPORTED_PHASES.join(', ')}`);
  ['source', 'session', 'turn', 'chat', 'tool', 'permission', 'stream', 'context'].forEach((key) => pushObjectError(errors, event, key));
  if (event.id !== undefined && typeof event.id !== 'string') errors.push('id must be a string');
  if (event.timestamp !== undefined && typeof event.timestamp !== 'string') errors.push('timestamp must be a string');
  if (event.phase === 'stream.text_block' && typeof (event.stream || {}).text !== 'string') errors.push('stream.text_block requires stream.text');
  if (event.phase && event.phase.startsWith('tool.execute.') && !isPlainObject(event.tool)) errors.push(`${event.phase} requires tool`);
  return { valid: errors.length === 0, errors };
}

function assertUniversalEvent(event) {
  const result = validateUniversalEvent(event);
  if (!result.valid) throw new Error(`Invalid universal hook event: ${result.errors.join('; ')}`);
  return event;
}

module.exports = {
  PHASE_GROUPS,
  SUPPORTED_PHASES,
  UNIVERSAL_HOOK_ABI,
  assertUniversalEvent,
  isPlainObject,
  validateUniversalEvent,
};
