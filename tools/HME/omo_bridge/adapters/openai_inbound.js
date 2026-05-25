const { baseEvent, parseMaybeJson, validate } = require('./common');

function toUniversalOpenAiEvent(native = {}, options = {}) {
  if (native.body) {
    const { messages, input, ...params } = native.body;
    return validate({
      ...baseEvent(native, options, { host: 'openai', adapter: 'openai_inbound', rawEventName: 'proxy.request' }),
      phase: 'chat.params',
      session: { id: native.response_id || native.request_id, provider: 'openai', model: native.body.model },
      chat: { params, messages: Array.isArray(messages) ? messages : input || [] },
      context: { capabilities: ['modify.chat.params'] },
    });
  }
  const call = native.tool_call || {};
  const fn = call.function || {};
  return validate({
    ...baseEvent(native, options, { host: 'openai', adapter: 'openai_inbound', rawEventName: 'response.tool_call' }),
    phase: 'tool.execute.before',
    session: { id: native.response_id, provider: 'openai' },
    tool: { id: call.id, name: fn.name || call.name, input: parseMaybeJson(fn.arguments || call.arguments) },
    context: { lifecycle: { event: 'tool_call' } },
  });
}

module.exports = { toUniversalOpenAiEvent };
