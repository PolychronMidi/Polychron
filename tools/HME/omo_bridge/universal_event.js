const UNIVERSAL_HOOK_ABI = 'hme-opencode-hook/v1';

const PHASE_GROUPS = Object.freeze({
  core: Object.freeze(['chat.params', 'chat.headers', 'permission.ask', 'tool.execute.before', 'tool.execute.after']),
  hmeExtension: Object.freeze(['stop.before', 'stream.text_block']),
  observational: Object.freeze([
    'experimental.chat.messages.transform',
    'experimental.chat.system.transform',
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

function requireObject(errors, event, key, reason) {
  if (!isPlainObject(event[key])) errors.push(`${reason} requires ${key}`);
}

function validateUniversalEvent(event = {}) {
  const errors = [];
  if (!isPlainObject(event)) return { valid: false, errors: ['event must be an object'] };
  if (event.abi !== UNIVERSAL_HOOK_ABI) errors.push(`abi must be ${UNIVERSAL_HOOK_ABI}`);
  if (!SUPPORTED_PHASES.includes(event.phase)) errors.push(`phase must be one of: ${SUPPORTED_PHASES.join(', ')}`);
  ['source', 'session', 'turn', 'chat', 'tool', 'permission', 'stream', 'context'].forEach((key) => pushObjectError(errors, event, key));
  requireObject(errors, event, 'source', 'universal hook event');
  if (isPlainObject(event.source) && typeof event.source.host !== 'string') errors.push('source.host must be a string');
  if (event.id !== undefined && typeof event.id !== 'string') errors.push('id must be a string');
  if (event.timestamp !== undefined && typeof event.timestamp !== 'string') errors.push('timestamp must be a string');
  if (event.phase === 'chat.params') requireObject(errors, event, 'chat', 'chat.params');
  if (event.phase === 'permission.ask' && !isPlainObject(event.permission) && !isPlainObject(event.tool)) errors.push('permission.ask requires permission or tool');
  if (event.phase === 'stream.text_block' && typeof (event.stream || {}).text !== 'string') errors.push('stream.text_block requires stream.text');
  if (event.phase && event.phase.startsWith('tool.execute.')) requireObject(errors, event, 'tool', event.phase);
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
