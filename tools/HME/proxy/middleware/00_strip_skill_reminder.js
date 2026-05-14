'use strict';

const SKILL_REMINDER_RE = /^<system-reminder>\nThe following skills are available for use with the Skill tool:[\s\S]*?\n<\/system-reminder>\n?$/;
const CONTEXT_TAIL_RE = /\n# userEmail\nThe user's email address is [^\n]*\.\n# currentDate\nToday's date is \d{4}-\d{2}-\d{2}\.\n\n\s*IMPORTANT: this context may or may not be relevant to your tasks\. You should not respond to this context unless it is highly relevant to your task\.\n(?=<\/system-reminder>\n?$)/;
const STOP_HOOK_RE = /^Stop hook feedback:\n\[bash [^\]]+_proxy_bridge\.sh Stop\]: [\s\S]*$/;
const STOP_HOOK_KEEP_RE = /MULTI-FLAG STOP|ADVISOR|SUMMARY_|LIVE-PROBE|VERIFICATION|PHASE GATE|CLAIM_WITHOUT_EVIDENCE/;
const STOP_HOOK_COMPACT = 'Stop hook feedback: repeated auto-completeness/exhaust gate compacted by hme-proxy.';
const STOP_HOOK_COMPACT_AUTO = 'Stop hook feedback: AUTO-COMPLETENESS CHECK compacted by hme-proxy.';
const STOP_HOOK_COMPACT_EXHAUST = 'Stop hook feedback: EXHAUST PROTOCOL VIOLATION compacted by hme-proxy.';

const RECENT_STOP_HOOKS = [];

function _compactRepeatedStopHook(text) {
  if (!STOP_HOOK_RE.test(text)) return null;
  const fp = text.replace(/\d{4}-\d{2}-\d{2}T\S+/g, '<ts>').slice(0, 240);
  const seen = RECENT_STOP_HOOKS.includes(fp);
  RECENT_STOP_HOOKS.push(fp);
  if (RECENT_STOP_HOOKS.length > 12) RECENT_STOP_HOOKS.shift();
  let compact = STOP_HOOK_COMPACT;
  if (text.includes('AUTO-COMPLETENESS CHECK')) compact = STOP_HOOK_COMPACT_AUTO;
  else if (text.includes('EXHAUST PROTOCOL VIOLATION')) compact = STOP_HOOK_COMPACT_EXHAUST;
  if (seen) return compact;
  if (!STOP_HOOK_KEEP_RE.test(text)) return compact;
  return null;
}

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
    const compactedStopHook = _compactRepeatedStopHook(block.text);
    if (compactedStopHook) {
      block.text = compactedStopHook;
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
