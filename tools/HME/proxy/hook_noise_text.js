'use strict';

const HOOK_SUCCESS_RE = /^\s*(SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Notification|Stop|SubagentStop|PreCompact|PostCompact|PermissionRequest) hook \((completed|skipped)\)\s*$/;
const WRAPPER_AUTOCORRECT_RE = /^\s*warning:\s*i\/ wrapper path auto-corrected -- rewritten to absolute path under PROJECT_ROOT\s*$/;
const DUP_STOP_RE = /^\s*STOP\. Re-read (?:(?:doc\/templates\/)?AGENTS|CLAUDE)\.md and the user prompt\./;
const RAW_CHANNEL_RE = /^\s*(warning|feedback):\s*(BLOCKED: Raw tool streak.*)$/;
const RAW_CONTINUATION_RE = /^\s*(TodoWrite\b|i\/[A-Za-z_-]+\b|or stop\b|Preferred exits\b|Do not loop\b|use native\b|run a different\b|native Read\/Edit\b|Read\/Edit\/?)/;

function recordStrip(stats, category, lines) {
  const dropped = Array.isArray(lines) ? lines : [lines];
  stats.stripped = (stats.stripped || 0) + dropped.length;
  stats.categories = stats.categories || {};
  stats.categories[category] = (stats.categories[category] || 0) + dropped.length;
  stats.removed_bytes = (stats.removed_bytes || 0)
    + dropped.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
}

function rawBlock(lines, idx) {
  const m = lines[idx].match(RAW_CHANNEL_RE);
  if (!m) return null;
  const payload = [m[2].trim()];
  let end = idx + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (!line.trim()) break;
    if (HOOK_SUCCESS_RE.test(line) || WRAPPER_AUTOCORRECT_RE.test(line) || DUP_STOP_RE.test(line) || RAW_CHANNEL_RE.test(line)) break;
    if (!/^\s+/.test(line) && !RAW_CONTINUATION_RE.test(line)) break;
    payload.push(line.trim());
    end += 1;
  }
  return { end, payload: payload.join('\n') };
}

function stripHookNoiseText(text, stats = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let sawStop = false;
  let lastRawBlock = '';
  for (let i = 0; i < lines.length; i += 1) {
    const block = rawBlock(lines, i);
    if (block) {
      if (block.payload === lastRawBlock) {
        recordStrip(stats, 'duplicate_raw_tool_blocks', lines.slice(i, block.end));
        i = block.end - 1;
        continue;
      }
      lastRawBlock = block.payload;
      kept.push(...lines.slice(i, block.end));
      i = block.end - 1;
      continue;
    }
    let category = '';
    if (HOOK_SUCCESS_RE.test(lines[i])) category = 'hook_success_lines';
    else if (WRAPPER_AUTOCORRECT_RE.test(lines[i])) category = 'autocorrect_lines';
    else if (DUP_STOP_RE.test(lines[i])) { category = sawStop ? 'duplicate_stop_blocks' : ''; sawStop = true; }
    if (category) {
      recordStrip(stats, category, lines[i]);
      continue;
    }
    kept.push(lines[i]);
  }
  return kept.join('\n');
}

function stripHookNoiseInValue(value, stats = {}, protectedUserText = false) {
  if (typeof value === 'string') return protectedUserText ? value : stripHookNoiseText(value, stats);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripHookNoiseInValue(item, stats, protectedUserText));
  const childProtected = protectedUserText || value.role === 'user';
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = stripHookNoiseInValue(child, stats, childProtected);
  return out;
}

module.exports = { stripHookNoiseText, stripHookNoiseInValue };
