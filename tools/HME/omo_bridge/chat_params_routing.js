const { toUniversalAnthropicEvent } = require('./adapters/anthropic_inbound');
const { assertUniversalEvent } = require('./universal_event');
const { resolveUniversalDecisions } = require('./decision_resolver');
const { translateAnthropicDecision } = require('./translators/anthropic_decision');
const { translateOpenAiDecision } = require('./translators/openai_decision');

const CHAT_PARAM_HOSTS = Object.freeze({ anthropic: translateAnthropicDecision, openai: translateOpenAiDecision });
const PROTECTED_PARAM_KEYS = Object.freeze(['model']);

function toChatParamsEvent(host, body, options = {}) {
  if (host === 'anthropic') return toUniversalAnthropicEvent({ body, request_id: options.requestId }, options);
  return assertUniversalEvent({
    abi: 'hme-opencode-hook/v1',
    id: options.id || `${host}-chat-params`,
    timestamp: options.timestamp || new Date(0).toISOString(),
    source: { host, adapter: `${host}_chat_params`, rawEventName: 'proxy.request' },
    phase: 'chat.params',
    session: { provider: host, model: body.model },
    chat: { params: { ...body, messages: undefined }, messages: Array.isArray(body.messages) ? body.messages : [] },
    context: { capabilities: ['modify.chat.params'] },
  });
}

function validatePatch(patch = {}, protectedKeys = PROTECTED_PARAM_KEYS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { valid: false, reason: 'patch must be an object' };
  const blocked = protectedKeys.filter((key) => Object.prototype.hasOwnProperty.call(patch, key));
  if (blocked.length) return { valid: false, reason: `protected params: ${blocked.join(',')}` };
  return { valid: true };
}

function applyPatch(body, patch) {
  return { ...body, ...patch };
}

async function routeChatParams(body = {}, options = {}) {
  const host = options.host || 'anthropic';
  const translate = CHAT_PARAM_HOSTS[host];
  if (!translate) return { body, output: { unsupported: true, host, phase: 'chat.params' }, changed: false };
  try {
    const event = toChatParamsEvent(host, body, options);
    const pluginResult = options.pluginHost ? await options.pluginHost.invokePhase(event, { host }) : { decisions: [{ kind: 'allow' }] };
    const resolution = resolveUniversalDecisions(pluginResult.decisions || [pluginResult.primaryDecision || { kind: 'allow' }]);
    const output = translate(resolution.decision, { phase: 'chat.params' });
    if (resolution.decision.kind !== 'modify') return { body, output, changed: false, event, resolution };
    const patchCheck = validatePatch(resolution.decision.patch, options.protectedKeys || PROTECTED_PARAM_KEYS);
    if (!patchCheck.valid) return { body, output: { blocked: true, reason: patchCheck.reason, machineCode: 'invalid_chat_params_patch' }, changed: false, event, resolution };
    return { body: applyPatch(body, resolution.decision.patch), output, changed: true, event, resolution };
  } catch (error) {
    if (typeof options.emit === 'function') options.emit('universal_hook.chat_params_error', { host, error: error.message });
    return { body, output: { allowed: true, warning: 'optional_chat_params_plugin_failed' }, changed: false, error: error.message };
  }
}

module.exports = { CHAT_PARAM_HOSTS, PROTECTED_PARAM_KEYS, routeChatParams, validatePatch };
