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

function messageText(message) {
  const content = message && message.content;
  if (typeof content === 'string') return content;
  return messageContentItems(message).map(itemText).filter(Boolean).join('\n');
}

function isToolResultMessage(message) {
  if (!message || message.role !== 'user') return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some((item) => item && typeof item === 'object' && item.type === 'tool_result');
}

function realUserMessages(body) {
  return messagesArray(body).filter((message) => message && message.role === 'user' && !isToolResultMessage(message));
}

function lastRealUserMessage(body) {
  const msgs = realUserMessages(body);
  return msgs.length ? msgs[msgs.length - 1] : null;
}

module.exports = { TEXT_ITEM_TYPES, messagesArray, messageContentItems, itemText, messageText, isToolResultMessage, realUserMessages, lastRealUserMessage };
