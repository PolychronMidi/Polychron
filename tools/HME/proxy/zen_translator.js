'use strict';
// OpenAI <-> Anthropic translator for MODE=4 main-agent swap to Zen Go.

function _flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('');
}

function _toolUseBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && b.type === 'tool_use');
}

function _toolResultBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && b.type === 'tool_result');
}

function translateRequestToOpenAI(anthropicPayload, targetModel) {
  const out = {
    model: targetModel,
    max_tokens: anthropicPayload.max_tokens,
    stream: anthropicPayload.stream === true,
  };
  if (typeof anthropicPayload.temperature === 'number' && anthropicPayload.temperature !== 1.0) {
    out.temperature = anthropicPayload.temperature;
  }

  const messages = [];
  if (anthropicPayload.system) {
    const sysText = typeof anthropicPayload.system === 'string'
      ? anthropicPayload.system
      : _flattenContent(anthropicPayload.system);
    if (sysText) messages.push({ role: 'system', content: sysText });
  }

  for (const msg of (anthropicPayload.messages || [])) {
    if (!msg) continue;
    const role = msg.role;
    if (role === 'user') {
      const tr = _toolResultBlocks(msg.content);
      if (tr.length > 0) {
        const text = _flattenContent(msg.content);
        if (text.trim()) messages.push({ role: 'user', content: text });
        for (const block of tr) {
          const c = block.content;
          const flat = typeof c === 'string' ? c : _flattenContent(c);
          messages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id || '',
            content: flat,
          });
        }
      } else {
        messages.push({ role: 'user', content: _flattenContent(msg.content) });
      }
    } else if (role === 'assistant') {
      const tu = _toolUseBlocks(msg.content);
      const text = _flattenContent(msg.content);
      const oaMsg = { role: 'assistant' };
      if (text) oaMsg.content = text;
      if (tu.length > 0) {
        oaMsg.tool_calls = tu.map((b) => ({
          id: b.id || '',
          type: 'function',
          function: { name: b.name || '', arguments: JSON.stringify(b.input || {}) },
        }));
        if (!oaMsg.content) oaMsg.content = '';
      }
      messages.push(oaMsg);
    }
  }
  out.messages = messages;

  if (Array.isArray(anthropicPayload.tools)) {
    out.tools = anthropicPayload.tools.map((t) => {
      if (t && t.type === 'function' && t.function) return t;
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || t.parameters || { type: 'object', properties: {} },
        },
      };
    });
  }

  if (anthropicPayload.tool_choice && typeof anthropicPayload.tool_choice === 'object') {
    const tc = anthropicPayload.tool_choice;
    if (tc.type === 'auto') out.tool_choice = 'auto';
    else if (tc.type === 'any') out.tool_choice = 'required';
    else if (tc.type === 'tool' && tc.name) out.tool_choice = { type: 'function', function: { name: tc.name } };
  }

  return out;
}

function _sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

class ZenSseTranslator {
  constructor(opts) {
    this.model = opts.model || 'deepseek-v4-pro';
    this.messageId = opts.messageId || ('msg_' + Math.random().toString(36).slice(2, 14));
    this._buffer = '';
    this._emittedStart = false;
    this._textBlockOpen = null;
    this._toolBlockOpen = null;
    this._thinkingBlockOpen = null;
    this._nextBlockIndex = 0;
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._stopReason = 'end_turn';
    this._stopped = false;
  }

  feed(chunkBuf) {
    this._buffer += chunkBuf.toString('utf8');
    let out = '';
    while (true) {
      const nl = this._buffer.indexOf('\n');
      if (nl < 0) break;
      const line = this._buffer.slice(0, nl).replace(/\r$/, '');
      this._buffer = this._buffer.slice(nl + 1);
      if (!line.trim()) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        out += this._emitClose();
        this._stopped = true;
        continue;
      }
      let obj;
      try { obj = JSON.parse(payload); } catch (_e) { continue; }
      out += this._handleChunk(obj);
    }
    return out;
  }

  finalize() {
    if (this._stopped) return '';
    return this._emitClose();
  }

  _handleChunk(obj) {
    let out = '';
    const choice = (obj.choices && obj.choices[0]) || null;
    const delta = (choice && choice.delta) || {};
    const finishReason = choice && choice.finish_reason;

    if (obj.usage) {
      if (typeof obj.usage.prompt_tokens === 'number') this._inputTokens = obj.usage.prompt_tokens;
      if (typeof obj.usage.completion_tokens === 'number') this._outputTokens = obj.usage.completion_tokens;
    }

    if (!this._emittedStart) {
      out += _sseEvent('message_start', {
        type: 'message_start',
        message: {
          id: this.messageId, type: 'message', role: 'assistant',
          model: this.model, content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: this._inputTokens, output_tokens: 0 },
        },
      });
      this._emittedStart = true;
    }

    // DeepSeek R1 reasoning_content -> Anthropic thinking_delta.
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      if (this._textBlockOpen !== null) {
        out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._textBlockOpen });
        this._textBlockOpen = null;
      }
      if (this._toolBlockOpen) {
        out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._toolBlockOpen.index });
        this._toolBlockOpen = null;
      }
      if (this._thinkingBlockOpen === null) {
        out += _sseEvent('content_block_start', {
          type: 'content_block_start',
          index: this._nextBlockIndex,
          content_block: { type: 'thinking', thinking: '' },
        });
        this._thinkingBlockOpen = this._nextBlockIndex;
        this._nextBlockIndex++;
      }
      out += _sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: this._thinkingBlockOpen,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      });
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      if (this._thinkingBlockOpen !== null) {
        out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._thinkingBlockOpen });
        this._thinkingBlockOpen = null;
      }
      if (this._toolBlockOpen) {
        out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._toolBlockOpen.index });
        this._toolBlockOpen = null;
      }
      if (this._textBlockOpen === null) {
        out += _sseEvent('content_block_start', {
          type: 'content_block_start',
          index: this._nextBlockIndex,
          content_block: { type: 'text', text: '' },
        });
        this._textBlockOpen = this._nextBlockIndex;
        this._nextBlockIndex++;
      }
      out += _sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: this._textBlockOpen,
        delta: { type: 'text_delta', text: delta.content },
      });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (!tc || typeof tc !== 'object') continue;
        const tcIdx = typeof tc.index === 'number' ? tc.index : 0;
        const fn = tc.function || {};
        if (this._textBlockOpen !== null) {
          out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._textBlockOpen });
          this._textBlockOpen = null;
        }
        if (!this._toolBlockOpen || this._toolBlockOpen.openaiIdx !== tcIdx) {
          if (this._toolBlockOpen) {
            out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._toolBlockOpen.index });
          }
          this._toolBlockOpen = {
            index: this._nextBlockIndex,
            openaiIdx: tcIdx,
            id: tc.id || ('toolu_' + Math.random().toString(36).slice(2, 14)),
          };
          out += _sseEvent('content_block_start', {
            type: 'content_block_start',
            index: this._toolBlockOpen.index,
            content_block: { type: 'tool_use', id: this._toolBlockOpen.id, name: fn.name || '', input: {} },
          });
          this._nextBlockIndex++;
        }
        if (typeof fn.arguments === 'string' && fn.arguments.length > 0) {
          out += _sseEvent('content_block_delta', {
            type: 'content_block_delta',
            index: this._toolBlockOpen.index,
            delta: { type: 'input_json_delta', partial_json: fn.arguments },
          });
        }
      }
    }

    if (finishReason) {
      if (finishReason === 'tool_calls' || finishReason === 'function_call') this._stopReason = 'tool_use';
      else if (finishReason === 'length') this._stopReason = 'max_tokens';
      else this._stopReason = 'end_turn';
    }

    return out;
  }

  _emitClose() {
    let out = '';
    if (this._textBlockOpen !== null) {
      out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._textBlockOpen });
      this._textBlockOpen = null;
    }
    if (this._toolBlockOpen) {
      out += _sseEvent('content_block_stop', { type: 'content_block_stop', index: this._toolBlockOpen.index });
      this._toolBlockOpen = null;
    }
    out += _sseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: this._stopReason, stop_sequence: null },
      usage: { output_tokens: this._outputTokens },
    });
    out += _sseEvent('message_stop', { type: 'message_stop' });
    return out;
  }
}

function translateNonStreamResponseToAnthropic(openAIBody, model) {
  const choice = (openAIBody.choices && openAIBody.choices[0]) || {};
  const msg = choice.message || {};
  const content = [];
  if (msg.content && typeof msg.content === 'string' && msg.content.length > 0) {
    content.push({ type: 'text', text: msg.content });
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      const fn = tc.function || {};
      let input = {};
      try { input = JSON.parse(fn.arguments || '{}'); } catch (_e) { input = { _raw: fn.arguments }; }
      content.push({ type: 'tool_use', id: tc.id || '', name: fn.name || '', input });
    }
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });
  let stopReason = 'end_turn';
  if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') stopReason = 'tool_use';
  else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
  return {
    id: openAIBody.id || ('msg_' + Math.random().toString(36).slice(2, 14)),
    type: 'message',
    role: 'assistant',
    model: model || openAIBody.model || 'deepseek-v4-pro',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: (openAIBody.usage && openAIBody.usage.prompt_tokens) || 0,
      output_tokens: (openAIBody.usage && openAIBody.usage.completion_tokens) || 0,
    },
  };
}

module.exports = {
  translateRequestToOpenAI,
  translateNonStreamResponseToAnthropic,
  ZenSseTranslator,
};
