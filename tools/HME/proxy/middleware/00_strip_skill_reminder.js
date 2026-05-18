'use strict';

// Table-driven strip rules for <system-reminder> wrappers and stale stop-hook
// echoes. Each rule is {name, re, action}; new shapes are a one-line addition.

const RE_SKILL = /^<system-reminder>\nThe following skills are available for use with the Skill tool:[\s\S]*?\n<\/system-reminder>\s*$/;
const RE_CONTEXT_FULL = /^<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# userEmail\nThe user's email address is [^\n]*\.\n# currentDate\nToday's date is \d{4}-\d{2}-\d{2}\.\n\n\s*IMPORTANT: this context may or may not be relevant to your tasks\. You should not respond to this context unless it is highly relevant to your task\.\n<\/system-reminder>\s*$/;
const RE_CONTEXT_TAIL = /\n# userEmail\nThe user's email address is [^\n]*\.\n# currentDate\nToday's date is \d{4}-\d{2}-\d{2}\.\n\n\s*IMPORTANT: this context may or may not be relevant to your tasks\. You should not respond to this context unless it is highly relevant to your task\.\n(?=<\/system-reminder>\s*$)/;
const RE_STOP_HOOK_PROXY = /^<system-reminder>\nHME Stop Hook Feedback \(proxy-injected\)\n[\s\S]*?\n<\/system-reminder>\s*$/;
const RE_STOP_HOOK = /^Stop hook feedback:\n\[node [^\]]+event_kernel\/claude_adapter\.js Stop\]: [\s\S]*$/;
const RE_STOP_HOOK_KEEP = /MULTI-FLAG STOP|ADVISOR|SUMMARY_|LIVE-PROBE|VERIFICATION|PHASE GATE|CLAIM_WITHOUT_EVIDENCE/;

const STOP_HOOK_COMPACT = 'Stop hook feedback: repeated auto-completeness/exhaust gate compacted by hme-proxy.';
const STOP_HOOK_COMPACT_AUTO = 'Stop hook feedback: AUTO-COMPLETENESS CHECK compacted by hme-proxy.';
const STOP_HOOK_COMPACT_EXHAUST = 'Stop hook feedback: EXHAUST PROTOCOL VIOLATION compacted by hme-proxy.';
const STOP_HOOK_COMPACTS = [STOP_HOOK_COMPACT, STOP_HOOK_COMPACT_AUTO, STOP_HOOK_COMPACT_EXHAUST];

// full-block strips remove the entire content block; tail strips
// rewrite the text in place; the stop-hook entry is delegated to its compactor.
const STRIP_RULES = [
  { name: 'skill', re: RE_SKILL, action: 'remove-block' },
  { name: 'context-full', re: RE_CONTEXT_FULL, action: 'remove-block' },
  { name: 'stop-hook-proxy-echo', re: RE_STOP_HOOK_PROXY, action: 'remove-block' },
  { name: 'context-tail', re: RE_CONTEXT_TAIL, action: 'replace-with', replacement: '\n' },
];

const RECENT_STOP_HOOKS = [];

function _compactRepeatedStopHook(text) {
  if (STOP_HOOK_COMPACTS.includes((text || '').trim())) return '';
  if (!RE_STOP_HOOK.test(text)) return null;
  const fp = text.replace(/\d{4}-\d{2}-\d{2}T\S+/g, '<ts>').slice(0, 240);
  const seen = RECENT_STOP_HOOKS.includes(fp);
  RECENT_STOP_HOOKS.push(fp);
  if (RECENT_STOP_HOOKS.length > 12) RECENT_STOP_HOOKS.shift();
  let compact = STOP_HOOK_COMPACT;
  if (text.includes('AUTO-COMPLETENESS CHECK')) compact = STOP_HOOK_COMPACT_AUTO;
  else if (text.includes('EXHAUST PROTOCOL VIOLATION')) compact = STOP_HOOK_COMPACT_EXHAUST;
  if (seen) return compact;
  if (!RE_STOP_HOOK_KEEP.test(text)) return compact;
  return null;
}

function _applyRule(block, rule) {
  if (rule.action === 'remove-block') {
    return rule.re.test(block.text) ? { remove: true } : null;
  }
  if (rule.action === 'replace-with') {
    const cleaned = block.text.replace(rule.re, rule.replacement);
    if (cleaned === block.text) return null;
    block.text = cleaned;
    return { changed: true };
  }
  return null;
}

function _stripFromContent(content) {
  if (!Array.isArray(content)) return 0;
  let stripped = 0;
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
    let removed = false;
    for (const rule of STRIP_RULES) {
      const result = _applyRule(block, rule);
      if (!result) continue;
      stripped++;
      if (result.remove) { content.splice(i, 1); removed = true; break; }
    }
    if (removed) continue;
    const compacted = _compactRepeatedStopHook(block.text);
    if (compacted !== null) {
      if (compacted) block.text = compacted;
      else content.splice(i, 1);
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
  // STRIP_RULES exported so a future detector can audit coverage.
  STRIP_RULES,
};
