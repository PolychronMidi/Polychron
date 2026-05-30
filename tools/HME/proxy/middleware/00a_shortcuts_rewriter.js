'use strict';

const { lastRealUserMessage, messageContentItems, messageText } = require('../request_shape');

const SHORTCUTS = {
  'n': 'next suggestions?',
  'm': "what's missing?",
  'd': 'do all',
  'c': 'continue',
  'r': 'restarted. continue'
};

// Two-step shortcuts: the proxy sends `first` as the user message this turn,
// captures the response, then auto-submits `second` as a follow-up user message.
const TWO_STEP_SHORTCUTS = {
  '1': { first: "reply only with 'hi'", second: "reply only with 'high'" },
  'cc': { first: '/compact', second: 'continue' },
};

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
// Derive the match alternation from both shortcut maps so the regex can never
// drift out of sync with the keys it must match.
const _SHORTCUT_KEYS = [...Object.keys(SHORTCUTS), ...Object.keys(TWO_STEP_SHORTCUTS)].sort((a, b) => b.length - a.length);
const _SHORTCUT_ALT = _SHORTCUT_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const SHORTCUT_RE = new RegExp(`^\\s*(${_SHORTCUT_ALT})\\s*$`);
const _SHORTCUT_TAIL_RE = new RegExp(`(^|\\n)([ \\t]*)(${_SHORTCUT_ALT})([ \\t]*)$`, 'i');

function _withoutSystemReminders(text) {
  return String(text || '').replace(SYSTEM_REMINDER_RE, '').trim();
}

function _rewriteShortcutText(text, value) {
  const raw = String(text || '');
  if (SHORTCUT_RE.test(raw)) return value;
  const withoutReminders = _withoutSystemReminders(raw);
  if (SHORTCUT_RE.test(withoutReminders)) {
    const reminders = raw.match(SYSTEM_REMINDER_RE) || [];
    return reminders.length ? `${reminders.join('\n')}\n${value}` : value;
  }
  const replaced = raw.replace(_SHORTCUT_TAIL_RE, (_m, lead, indent) => `${lead}${indent}${value}`);
  if (replaced !== raw) return replaced;
  return value;
}

function _lastUserText(payload) {
  const last = lastRealUserMessage(payload);
  if (!last) return { text: '', block: null, msg: null };
  if (typeof last.content === 'string') {
    return { text: _withoutSystemReminders(last.content), block: null, msg: last, isString: true };
  }
  const items = messageContentItems(last);
  for (let i = items.length - 1; i >= 0; i--) {
    const block = items[i];
    const raw = messageText({ content: [block] });
    const text = _withoutSystemReminders(raw);
    if (text) return { text, block, msg: last };
  }
  return { text: '', block: null, msg: null };
}

function _setUserText({ msg, block, isString }, value) {
  if (block) {
    block.text = _rewriteShortcutText(block.text, value);
  } else if (isString && msg) {
    msg.content = _rewriteShortcutText(msg.content, value);
  }
}

module.exports = {
  name: 'shortcuts_rewriter',
  SHORTCUTS,
  SHORTCUT_RE,

  onRequest({ payload, ctx }) {
    const { text, block, msg, isString } = _lastUserText(payload);
    if (!text || !msg) return;

    const key = text.toLowerCase();
    const shortcut = SHORTCUTS[key];
    if (shortcut) {
      _setUserText({ msg, block, isString }, shortcut);
      if (ctx && typeof ctx.emit === 'function') ctx.emit({ event: 'shortcut_expanded', shortcut: key, replacement: shortcut });
      if (ctx && typeof ctx.markDirty === 'function') ctx.markDirty();
    }
  },
};
