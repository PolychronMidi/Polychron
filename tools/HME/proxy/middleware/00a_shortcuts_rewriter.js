'use strict';

const SHORTCUTS = {
  'n': 'next suggestions?',
  'm': "what's missing?",
  'd': 'do all',
  'c': 'continue'
};

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const SHORTCUT_RE = /^\s*(n|m|d|c|cc)\s*$/;

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
  const replaced = raw.replace(/(^|\n)([ \t]*)(n|m|d|c|cc)([ \t]*)$/i, (_m, lead, indent) => `${lead}${indent}${value}`);
  if (replaced !== raw) return replaced;
  return value;
}

function _lastUserText(payload) {
  if (!payload || !Array.isArray(payload.messages)) return { text: '', block: null, msg: null };
  const userMsgs = payload.messages.filter(m => m && m.role === 'user');
  if (!userMsgs.length) return { text: '', block: null, msg: null };
  const last = userMsgs[userMsgs.length - 1];
  if (typeof last.content === 'string') {
    return { text: _withoutSystemReminders(last.content), block: null, msg: last, isString: true };
  }
  if (Array.isArray(last.content)) {
    for (let i = last.content.length - 1; i >= 0; i--) {
      const block = last.content[i];
      if (block && block.type === 'text' && typeof block.text === 'string') {
        const text = _withoutSystemReminders(block.text);
        if (text) return { text, block, msg: last };
      }
    }
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

  onRequest({ payload, ctx }) {
    const { text, block, msg, isString } = _lastUserText(payload);
    if (!text || !msg) return;

    const key = text.toLowerCase();
    const shortcut = SHORTCUTS[key];
    if (shortcut) {
      _setUserText({ msg, block, isString }, shortcut);
      if (ctx && typeof ctx.emit === 'function') ctx.emit({ event: 'shortcut_expanded', shortcut: key, replacement: shortcut });
      ctx.markDirty();
      return;
    }

    if (key === 'cc') {
      payload.__shortcut_compact = true;
      _setUserText({ msg, block, isString }, '/compact');
      if (ctx && typeof ctx.emit === 'function') ctx.emit({ event: 'shortcut_expanded', shortcut: key, replacement: '/compact' });
      ctx.markDirty();
    }
  },
};
