'use strict';

function reasoningTextFromData(data) {
  if (!data || typeof data !== 'object') return '';
  const parts = [];
  const push = (v) => { if (typeof v === 'string' && v.trim()) parts.push(v); };
  const delta = data.delta && typeof data.delta === 'object' ? data.delta : null;
  const item = data.item && typeof data.item === 'object' ? data.item : null;
  const content = data.content && typeof data.content === 'object' ? data.content : null;
  push(data.reasoning_content);
  push(data.reasoning);
  push(data.reasoning_summary);
  push(data.summary);
  if (delta) {
    push(delta.reasoning_content);
    push(delta.reasoning);
    push(delta.reasoning_summary);
    push(delta.summary);
    if (/reasoning|thinking/.test(String(data.type || ''))) push(delta.text);
  }
  if (item) {
    push(item.reasoning_content);
    push(item.reasoning);
    push(item.summary);
    push(item.text);
  }
  if (content) {
    push(content.reasoning_content);
    push(content.reasoning);
    push(content.summary);
    push(content.text);
  }
  if (Array.isArray(data.summary)) {
    for (const s of data.summary) {
      if (typeof s === 'string') push(s);
      else if (s && typeof s === 'object') push(s.text || s.summary || s.content);
    }
  }
  return parts.join('');
}

function isReasoningEvent(eventName, data) {
  const name = String(eventName || '').toLowerCase();
  if (/reasoning|thinking/.test(name) && !/message_start|content_block/.test(name)) return true;
  const text = reasoningTextFromData(data);
  return Boolean(text);
}

function providerReasoningToThinkingRewrite(eventName, data, ctx) {
  if (!isReasoningEvent(eventName, data)) return data;
  const text = reasoningTextFromData(data);
  if (!text) return null;
  let index = ctx.get('providerReasoningThinkingIndex');
  const events = [];
  if (index == null) {
    index = ctx.get('nextSyntheticThinkingIndex') || 0;
    ctx.set('providerReasoningThinkingIndex', index);
    ctx.set('nextSyntheticThinkingIndex', index + 1);
    events.push(['content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'thinking', thinking: '' },
    }]);
  }
  events.push(['content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'thinking_delta', thinking: text },
  }]);
  return { events };
}

module.exports = {
  reasoningTextFromData,
  isReasoningEvent,
  providerReasoningToThinkingRewrite,
};
