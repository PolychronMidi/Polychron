'use strict';

const { lastRealUserMessage, messageContentItems, messageText } = require('../request_shape');
// Wire-lane shortcuts come from the single source of truth (config/shortcuts.json
// via shortcuts_config.js). This middleware handles ONLY the wire lanes: `simple`
const { SHORTCUTS, TWO_STEP_SHORTCUTS } = require('../shortcuts_config');

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const INTERRUPT_ENVELOPE_RE = /^\s*\[Request interrupted by user[^\]]*\]\s*/i;
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

// Resolve a shortcut key from user text. A shortcut is recognized when it is
// EITHER the whole message OR alone on the final line -- the latter is how a
// shortcut arrives when the host wraps mid-turn typing in an interrupt envelope
function _resolveShortcutKey(text) {
  const key = String(text || '').toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(SHORTCUTS, key)
    || Object.prototype.hasOwnProperty.call(TWO_STEP_SHORTCUTS, key)) {
    return key;
  }
  const tail = _SHORTCUT_TAIL_RE.exec(String(text || ''));
  return tail ? tail[3].toLowerCase() : '';
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
  TWO_STEP_SHORTCUTS,
  SHORTCUT_RE,

  onRequest({ payload, ctx }) {
    const { text, block, msg, isString } = _lastUserText(payload);
    if (!text || !msg) return;

    const key = _resolveShortcutKey(text);
    if (!key) return;
    const shortcut = SHORTCUTS[key];
    if (shortcut) {
      _setUserText({ msg, block, isString }, shortcut);
      if (ctx && typeof ctx.emit === 'function') ctx.emit({ event: 'shortcut_expanded', shortcut: key, replacement: shortcut });
      if (ctx && typeof ctx.markDirty === 'function') ctx.markDirty();
      return;
    }

    const twoStep = TWO_STEP_SHORTCUTS[key];
    if (twoStep) {
      _setUserText({ msg, block, isString }, twoStep.first);
      // Non-enumerable so JSON.stringify(payload) never serializes it onto the
      // wire (Anthropic 400s on unknown top-level fields); the response handler
      Object.defineProperty(payload, '__hme_followup', { value: twoStep.second, enumerable: false, configurable: true, writable: true });
      if (ctx && typeof ctx.emit === 'function') ctx.emit({ event: 'shortcut_expanded', shortcut: key, replacement: twoStep.first, followup: twoStep.second });
      if (ctx && typeof ctx.markDirty === 'function') ctx.markDirty();
    }
  },
};
