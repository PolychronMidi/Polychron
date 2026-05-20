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
    const output = await hook(input);
    const validation = validateHookResult(output, options);
    emitOmo('omo_hook_invoked', { hook: hookName, phase: input.phase || '', result: validation.allowed ? 'applied' : 'blocked', bytes_added: validation.bytesAdded || 0, blocked_reason: validation.allowed ? '' : validation.reason }, options.telemetry);
    return { result: validation.allowed ? 'applied' : 'blocked', output: validation.allowed ? output : null, validation };
  } catch (err) {
    emitOmo('omo_hook_invoked', { hook: hookName, phase: input.phase || '', result: 'error', error: err.message }, options.telemetry);
    return { result: 'error', error: err.message };
  }
}
module.exports = { invokeOmoHook, validateHookResult };
