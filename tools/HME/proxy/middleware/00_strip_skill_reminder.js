'use strict';

const SKILL_REMINDER_RE = /^<system-reminder>\nThe following skills are available for use with the Skill tool:[\s\S]*?\n<\/system-reminder>\n?$/;
const CONTEXT_TAIL_RE = /\n# userEmail\nThe user's email address is [^\n]*\.\n# currentDate\nToday's date is \d{4}-\d{2}-\d{2}\.\n\n\s*IMPORTANT: this context may or may not be relevant to your tasks\. You should not respond to this context unless it is highly relevant to your task\.\n(?=<\/system-reminder>\n?$)/;
const STOP_HOOK_RE = /^Stop hook feedback:\n\[bash [^\]]+_proxy_bridge\.sh Stop\]: [\s\S]*$/;
const STOP_HOOK_KEEP_RE = /MULTI-FLAG STOP|ADVISOR|SUMMARY_|LIVE-PROBE|VERIFICATION|PHASE GATE|CLAIM_WITHOUT_EVIDENCE/;
const STOP_HOOK_COMPACT = 'Stop hook feedback: repeated auto-completeness/exhaust gate compacted by hme-proxy.';

function _stripFromContent(content) {
  if (!Array.isArray(content)) return 0;
  let stripped = 0;
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
    if (SKILL_REMINDER_RE.test(block.text)) {
      content.splice(i, 1);
      stripped++;
      continue;
    }
    if (STOP_HOOK_RE.test(block.text) && !STOP_HOOK_KEEP_RE.test(block.text)) {
      block.text = STOP_HOOK_COMPACT;
      stripped++;
      continue;
    }
    const cleaned = block.text.replace(CONTEXT_TAIL_RE, '\n');
    if (cleaned !== block.text) {
      block.text = cleaned;
      stripped++;
    }
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
