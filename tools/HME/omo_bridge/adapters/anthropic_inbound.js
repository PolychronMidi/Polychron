const { baseEvent, validate } = require('./common');

function chatParams(body = {}) {
  const { messages, ...rest } = body;
  return { params: rest, messages: Array.isArray(messages) ? messages : [] };
}

function toUniversalAnthropicEvent(native = {}, options = {}) {
  if (native.body) {
    const body = native.body;
    return validate({
      ...baseEvent(native, options, { host: 'anthropic', adapter: 'anthropic_inbound', rawEventName: 'proxy.request' }),
      phase: 'chat.params',
      session: { id: native.request_id, provider: 'anthropic', model: body.model },
      chat: chatParams(body),
      context: { capabilities: ['modify.chat.params'] },
    });
  }
  return validate({
    ...baseEvent(native, options, { host: 'anthropic', adapter: 'anthropic_inbound', rawEventName: 'sse.content_block_stop' }),
    phase: 'stream.text_block',
    session: { provider: 'anthropic' },
    stream: {
      eventName: native.eventName,
      blockIndex: native.blockIndex,
      blockType: native.blockType,
      text: native.text || '',
    },
    context: { capabilities: ['drop.stream.block', 'rewrite.stream.text'] },
  });
}

module.exports = { toUniversalAnthropicEvent };
