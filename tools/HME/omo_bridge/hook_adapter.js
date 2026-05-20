'use strict';
const { emitOmo } = require('./telemetry');
const MUTATION_KEYS = new Set(['system', 'messages', 'tools', 'write', 'command', 'session']);
function validateHookResult(result = {}, options = {}) {
  const mutations = Object.keys(result || {}).filter((k) => MUTATION_KEYS.has(k));
  if (mutations.length && options.allowMutations !== true) return { allowed: false, reason: `OMO hook mutation blocked: ${mutations.join(',')}`, mutations };
  const bytesAdded = Buffer.byteLength(JSON.stringify(result || {}));
  if (options.maxBytes && bytesAdded > options.maxBytes) return { allowed: false, reason: 'OMO hook result exceeds byte budget', mutations, bytesAdded };
  return { allowed: true, reason: 'allowed', mutations, bytesAdded };
}
function _defaultOutputForHook(hookName, input) {
  if (hookName === 'chat.params') return { options: {} };
  if (hookName === 'chat.headers') return { headers: {} };
  if (hookName === 'chat.message') return { message: { id: input.message && input.message.id || '', model: input.model }, parts: [] };
  if (hookName === 'experimental.chat.messages.transform') return { messages: input.messages || [] };
  if (hookName === 'experimental.chat.system.transform') return { system: input.system || '' };
  return {};
}
async function invokeOmoHook(hookName, input = {}, options = {}) {
  if (options.enabled !== true) {
    emitOmo('omo_hook_invoked', { hook: hookName, phase: input.phase || '', result: 'noop' }, options.telemetry);
    return { result: 'noop', output: null };
  }
  try {
    const hook = options.hooks && options.hooks[hookName];
    if (typeof hook !== 'function') {
      emitOmo('omo_hook_invoked', { hook: hookName, phase: input.phase || '', result: 'noop' }, options.telemetry);
      return { result: 'noop', output: null };
    }
    const output = options.output || _defaultOutputForHook(hookName, input);
    const returned = await hook(input, output);
    const finalOutput = returned === undefined ? output : returned;
    const validation = validateHookResult(finalOutput, options);
    emitOmo('omo_hook_invoked', { hook: hookName, phase: input.phase || '', result: validation.allowed ? 'applied' : 'blocked', bytes_added: validation.bytesAdded || 0, blocked_reason: validation.allowed ? '' : validation.reason }, options.telemetry);
    return { result: validation.allowed ? 'applied' : 'blocked', output: validation.allowed ? finalOutput : null, validation };
  } catch (err) {
    emitOmo('omo_hook_invoked', { hook: hookName, phase: input.phase || '', result: 'error', error: err.message }, options.telemetry);
    return { result: 'error', error: err.message };
  }
}
module.exports = { invokeOmoHook, validateHookResult };
