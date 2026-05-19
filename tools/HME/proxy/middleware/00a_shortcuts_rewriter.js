'use strict';

const SHORTCUTS = {
  'n': 'next suggestions?',
  'm': "what's missing?",
  'd': 'do all',
};

function _lastUserText(payload) {
  if (!payload || !Array.isArray(payload.messages)) return { text: '', block: null, msg: null };
  const userMsgs = payload.messages.filter(m => m && m.role === 'user');
  if (!userMsgs.length) return { text: '', block: null, msg: null };
  const last = userMsgs[userMsgs.length - 1];
  if (typeof last.content === 'string') {
    return { text: last.content.trim(), block: null, msg: last, isString: true };
  }
  if (Array.isArray(last.content)) {
    for (const block of last.content) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        return { text: block.text.trim(), block, msg: last };
      }
    }
  }
  return { text: '', block: null, msg: null };
}

function _setUserText({ msg, block, isString }, value) {
  if (block) {
    block.text = value;
  } else if (isString && msg) {
    msg.content = value;
  }
}

module.exports = {
  name: 'shortcuts_rewriter',

  onRequest({ payload, ctx }) {
    const { text, block, msg, isString } = _lastUserText(payload);
    if (!text || !msg) return;

    const shortcut = SHORTCUTS[text];
    if (shortcut) {
      _setUserText({ msg, block, isString }, shortcut);
      ctx.markDirty();
      return;
    }

    if (text === 'cc') {
      payload.__shortcut_compact = true;
      _setUserText({ msg, block, isString }, '/compact');
      ctx.markDirty();
    }
  },
};
