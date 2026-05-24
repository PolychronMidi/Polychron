'use strict';

const HOOK_SUCCESS_RE = /^\s*(SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Notification|Stop|SubagentStop|PreCompact|PostCompact|PermissionRequest) hook \((completed|skipped)\)\s*$/;
const WRAPPER_AUTOCORRECT_RE = /^\s*warning:\s*i\/ wrapper path auto-corrected -- rewritten to absolute path under PROJECT_ROOT\s*$/;
const DUP_STOP_RE = /^\s*STOP\. Re-read (?:(?:doc\/templates\/)?AGENTS|CLAUDE)\.md and the user prompt\./;
const STOP_HOOK_HEADER_RE = /^\s*(?:Stop hook feedback:|Stop hook blocking error from command:)/i;
const STOP_HOOK_REASON_RE = /\b(?:MULTI-FLAG STOP|EXHAUST PROTOCOL|SPIRALLING_PETULANCE|AUTO-COMPLETENESS|UNFINISHED TASK-LIST|PLAN-ABANDONMENT|STOP-WORK ANTIPATTERN|PSYCHOPATHIC-STOP|VERIFICATION DOCTRINE|SYSTEMATIC-DEBUGGING PHASE GATE)\b/i;
const STOP_HOOK_SECTION_RE = /^\s*---\s*\[\d+\/\d+\]\s+[A-Z_ -]+\s*---\s*$/;
const STOP_HOOK_RULE_TEXT_RE = /\b(?:Address all of them in this turn|Resume and implement|Do the concrete corrective action once|Subagents for KB work are the abandoning-plans antipattern)\b/i;

function recordStrip(stats, category, lines) {
  const dropped = Array.isArray(lines) ? lines : [lines];
  stats.stripped = (stats.stripped || 0) + dropped.length;
  stats.categories = stats.categories || {};
  stats.categories[category] = (stats.categories[category] || 0) + dropped.length;
  stats.removed_bytes = (stats.removed_bytes || 0)
    + dropped.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
}

function stripHookNoiseText(text, stats = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let sawStop = false;
  let inStopEcho = false;
  const stopEchoLines = [];
  function flushStopEcho() {
    if (!stopEchoLines.length) return;
    recordStrip(stats, 'stop_hook_host_echo', stopEchoLines);
    stopEchoLines.length = 0;
    inStopEcho = false;
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let category = '';
    if (STOP_HOOK_HEADER_RE.test(line) || (inStopEcho && (line.trim() === '' || STOP_HOOK_REASON_RE.test(line) || STOP_HOOK_SECTION_RE.test(line) || STOP_HOOK_RULE_TEXT_RE.test(line)))) {
      inStopEcho = true;
      stopEchoLines.push(line);
      continue;
    }
    if (inStopEcho) flushStopEcho();
    if (HOOK_SUCCESS_RE.test(line)) category = 'hook_success_lines';
    else if (WRAPPER_AUTOCORRECT_RE.test(line)) category = 'autocorrect_lines';
    else if (DUP_STOP_RE.test(line)) { category = sawStop ? 'duplicate_stop_blocks' : ''; sawStop = true; }
    if (category) {
      recordStrip(stats, category, line);
      continue;
    }
    kept.push(line);
  }
  if (inStopEcho) flushStopEcho();
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
