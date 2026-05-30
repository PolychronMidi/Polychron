'use strict';

/** Universal request shape helpers for Anthropic Messages and OpenAI Responses. */

const TEXT_ITEM_TYPES = new Set(['text', 'input_text', 'output_text']);

function messagesArray(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  return [];
}

function messageContentItems(message) {
  if (!message || typeof message !== 'object') return [];
  const content = message.content;
  if (typeof content === 'string') return [{ type: 'text', text: content, _hme_string_content: true }];
  return Array.isArray(content) ? content : [];
}

function itemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  if (!TEXT_ITEM_TYPES.has(String(item.type || ''))) return '';
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  return '';
}

// Text of a single content block. tool_result blocks contribute their inner
// text only when opts.toolResults is true (callers walking tool output, e.g.
// boilerplate strip / sanitize); the default skips them so user-prompt readers
function blockText(block, opts = {}) {
  if (typeof block === 'string') return block;
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'tool_result') {
    if (!opts.toolResults) return '';
    const c = block.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
    return '';
  }
  return itemText(block);
}

function contentText(content, opts = {}) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const joiner = Object.prototype.hasOwnProperty.call(opts, 'joiner') ? opts.joiner : '\n';
  return content.map((item) => blockText(item, opts)).filter(Boolean).join(joiner);
}

function messageText(message, opts = {}) {
  const content = message && message.content;
  if (typeof content === 'string') return content;
  return contentText(messageContentItems(message), opts);
}

function isToolResultMessage(message) {
  if (!message || message.role !== 'user') return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  const hasToolResult = content.some((item) => item && typeof item === 'object' && item.type === 'tool_result');
  if (!hasToolResult) return false;
  // A user message that ALSO carries non-empty prose text is a real user prompt
  // Claude Code bundled alongside the tool_results (every tool-using turn) -- NOT
  return !content.some((item) => item && typeof item === 'object'
    && item.type === 'text' && typeof item.text === 'string' && item.text.trim() !== '');
}

function realUserMessages(body) {
  return messagesArray(body).filter((message) => message && message.role === 'user' && !isToolResultMessage(message));
}

function lastRealUserMessage(body) {
  const msgs = realUserMessages(body);
  return msgs.length ? msgs[msgs.length - 1] : null;
}

module.exports = { TEXT_ITEM_TYPES, messagesArray, messageContentItems, itemText, blockText, contentText, messageText, isToolResultMessage, realUserMessages, lastRealUserMessage };
