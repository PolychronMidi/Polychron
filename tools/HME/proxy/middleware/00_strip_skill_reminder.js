'use strict';

const SKILL_REMINDER_RE = /^<system-reminder>\nThe following skills are available for use with the Skill tool:[\s\S]*?\n<\/system-reminder>\n?$/;

function _stripFromContent(content) {
  if (!Array.isArray(content)) return 0;
  let stripped = 0;
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
    if (!SKILL_REMINDER_RE.test(block.text)) continue;
    content.splice(i, 1);
    stripped++;
  }
  return stripped;
}

module.exports = {
  name: 'strip_skill_reminder',
  onRequest({ payload, ctx }) {
    if (process.env.HME_PROXY_LEAN_MODE === '1') return;
    if (!payload || !Array.isArray(payload.messages)) return;
    let stripped = 0;
    for (const msg of payload.messages) stripped += _stripFromContent(msg && msg.content);
    if (stripped === 0) return;
    ctx.markDirty();
    try {
      ctx.emit({ event: 'skill_reminder_stripped', session: 'proxy', count: stripped });
    } catch (_e) { /* best-effort */ }
  },
};
