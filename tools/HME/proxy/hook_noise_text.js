'use strict';

const HOOK_SUCCESS_RE = /^\s*(SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Notification|Stop|SubagentStop|PreCompact|PostCompact|PermissionRequest) hook \((completed|skipped)\)\s*$/;
const WRAPPER_AUTOCORRECT_RE = /^\s*warning:\s*i\/ wrapper path auto-corrected -- rewritten to absolute path under PROJECT_ROOT\s*$/;
const DUP_STOP_RE = /^\s*STOP\. Re-read (?:AGENTS|CLAUDE)\.md and the user prompt\./;
const DUP_CHANNEL_RE = /^\s*(warning|feedback):\s*(BLOCKED: Raw tool streak[\s\S]*)$/;

function stripHookNoiseText(text, stats = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let sawStop = false;
  let lastRawBlock = '';
  for (const line of lines) {
    let category = '';
    if (HOOK_SUCCESS_RE.test(line)) category = 'hook_success_lines';
    else if (WRAPPER_AUTOCORRECT_RE.test(line)) category = 'autocorrect_lines';
    else if (DUP_STOP_RE.test(line)) { category = sawStop ? 'duplicate_stop_blocks' : ''; sawStop = true; }
    const m = line.match(DUP_CHANNEL_RE);
    if (!category && m) {
      const payload = m[2];
      category = payload === lastRawBlock ? 'duplicate_raw_tool_blocks' : '';
      lastRawBlock = payload;
    }
    if (category) {
      stats.stripped = (stats.stripped || 0) + 1;
      stats.removed_bytes = (stats.removed_bytes || 0) + Buffer.byteLength(line) + 1;
      stats.categories = stats.categories || {};
      stats.categories[category] = (stats.categories[category] || 0) + 1;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function stripHookNoiseInValue(value, stats = {}) {
  if (typeof value === 'string') return stripHookNoiseText(value, stats);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripHookNoiseInValue(item, stats));
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = stripHookNoiseInValue(child, stats);
  return out;
}

module.exports = { stripHookNoiseText, stripHookNoiseInValue };
