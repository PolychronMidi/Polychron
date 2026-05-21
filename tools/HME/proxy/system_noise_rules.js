const RE_SKILL = /^<system-reminder>\nThe following skills are available for use with the Skill tool:[\s\S]*?\n<\/system-reminder>\s*$/;
const RE_CONTEXT_FULL = /^<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# userEmail\nThe user's email address is [^\n]*\.\n# currentDate\nToday's date is \d{4}-\d{2}-\d{2}\.\n\n\s*IMPORTANT: this context may or may not be relevant to your tasks\. You should not respond to this context unless it is highly relevant to your task\.\n<\/system-reminder>\s*$/;
const RE_CONTEXT_TAIL = /\n# userEmail\nThe user's email address is [^\n]*\.\n# currentDate\nToday's date is \d{4}-\d{2}-\d{2}\.\n\n\s*IMPORTANT: this context may or may not be relevant to your tasks\. You should not respond to this context unless it is highly relevant to your task\.\n(?=<\/system-reminder>\s*$)/;
const RE_STOP_HOOK_PROXY = /^<system-reminder>\nHME Stop Hook Feedback \(proxy-injected\)\n[\s\S]*?\n<\/system-reminder>\s*$/;
const RE_STOP_HOOK = /^Stop hook feedback:\n\[node [^\]]+event_kernel\/claude_adapter\.js Stop\]: [\s\S]*$/;
const RE_STOP_HOOK_KEEP = /MULTI-FLAG STOP|ADVISOR|SUMMARY_|LIVE-PROBE|VERIFICATION|PHASE GATE|CLAIM_WITHOUT_EVIDENCE/;
const RE_AGENT_FEEDBACK = /^<system-reminder kind="[^"]+" source="[^"]+">\n[\s\S]*?\n<\/system-reminder>\s*$/;
const RE_LIFESAVER_BANNER = /\[lifesaver inject from proxy\]\n[\s\S]*$/;

const CLAUDE_STRIP_RULES = [
  { name: 'agent-feedback-canonical', re: RE_AGENT_FEEDBACK, action: 'remove-block' },
  { name: 'skill', re: RE_SKILL, action: 'remove-block' },
  { name: 'context-full', re: RE_CONTEXT_FULL, action: 'remove-block' },
  { name: 'stop-hook-proxy-echo', re: RE_STOP_HOOK_PROXY, action: 'remove-block' },
  { name: 'lifesaver-banner', re: RE_LIFESAVER_BANNER, action: 'remove-block' },
  { name: 'context-tail', re: RE_CONTEXT_TAIL, action: 'replace-with', replacement: '\n' },
];

const CODEX_WRAPPER_RULES = [
  { name: 'permissions_instructions', re: /^<permissions instructions>[\s\S]*<\/permissions instructions>\s*$/ },
  { name: 'collaboration_mode', re: /^<collaboration_mode>[\s\S]*<\/collaboration_mode>\s*$/ },
  { name: 'skills_instructions', re: /^<skills_instructions>[\s\S]*<\/skills_instructions>\s*$/ },
];

const CLAUDE_REMOVE_BLOCK_RULES = CLAUDE_STRIP_RULES.filter((rule) => rule.action === 'remove-block');
const TEXT_TYPES = new Set(['input_text', 'output_text', 'text']);

function itemText(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (!TEXT_TYPES.has(String(item.type || ''))) return null;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  return null;
}

function classifyRemoveBlockText(text, rules) {
  for (const rule of rules) {
    if (rule.re.test(text)) return rule.name;
  }
  return '';
}

module.exports = {
  CLAUDE_STRIP_RULES,
  CLAUDE_REMOVE_BLOCK_RULES,
  CODEX_WRAPPER_RULES,
  RE_STOP_HOOK,
  RE_STOP_HOOK_KEEP,
  TEXT_TYPES,
  itemText,
  classifyRemoveBlockText,
};
