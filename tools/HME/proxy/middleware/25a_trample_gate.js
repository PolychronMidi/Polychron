'use strict';
// Immediate-fire trample gate: detect interrupt-marker in incoming user
// content; force ack-prefix on next text. Stop-hook detector fires too late.

const _INTERRUPT_MARKER = '<system-reminder>\nThe user sent a new message while you were working';

const _ACK_INSTRUCTION = [
  '',
  '',
  '[trample-gate -- proxy-injected]',
  'A user-interrupt arrived during your prior tool call. Your VERY NEXT TEXT (before any tool use) MUST begin with one of:',
  '  Acknowledged <one-word> input',
  '  Wrapping up this quickly first.',
  'Then either address the new input immediately, OR if current work is non-conflicting, finish coherently. Failing to acknowledge first is the IGNORE-AND-TRAMPLE antipattern.',
].join('\n');

function _userTextContains(payload, needle) {
  if (!payload || !Array.isArray(payload.messages)) return false;
  for (let i = payload.messages.length - 1; i >= 0; i--) {
    const m = payload.messages[i];
    if (!m || m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c.includes(needle);
    if (Array.isArray(c)) {
      for (const b of c) {
        if (!b) continue;
        if (typeof b.text === 'string' && b.text.includes(needle)) return true;
        if (typeof b.content === 'string' && b.content.includes(needle)) return true;
        if (Array.isArray(b.content)) {
          for (const ib of b.content) {
            if (ib && typeof ib.text === 'string' && ib.text.includes(needle)) return true;
          }
        }
      }
      return false;
    }
    return false;
  }
  return false;
}

module.exports = {
  name: 'trample_gate',
  onRequest({ payload, ctx }) {
    if (!payload) return;
    if (!_userTextContains(payload, _INTERRUPT_MARKER)) return;
    if (!Array.isArray(payload.system)) {
      payload.system = typeof payload.system === 'string' && payload.system
        ? [{ type: 'text', text: payload.system }]
        : [];
    }
    const last = payload.system[payload.system.length - 1];
    if (last && typeof last.text === 'string' && last.text.includes('[trample-gate -- proxy-injected]')) return;
    payload.system.push({ type: 'text', text: _ACK_INSTRUCTION });
    ctx.markDirty();
  },
};
