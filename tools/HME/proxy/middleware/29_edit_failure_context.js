'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');
const { recordFailure } = require('../turn_failure_state');
const sessionState = require('../session_state');

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit']);
const FAIL_RE = /\b(old_string not found|old_string is not unique|File has not been read yet\. Read it first before writing to it)\b/;

function textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
}

function relPath(file, root) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel : file;
}

function removeTurnEdit(root, file) {
  const base = path.basename(String(file || '')).replace(/\.[^.]*$/, '');
  if (!base) return;
  const state = path.join(root, 'tmp', 'hme-turn-edits.txt');
  try {
    const kept = fs.readFileSync(state, 'utf8').split(/\r?\n/).filter((line) => line && line !== base);
    if (kept.length) fs.writeFileSync(state, `${kept.join('\n')}\n`);
    else fs.rmSync(state, { force: true });
  } catch (_err) { /* no state yet */ }
}

function contextWindow(root, file, oldString = '', newString = '', reason = 'edit failed') {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return `\n[READ current context unavailable: ${relPath(file, root)} is not a readable file]`;
  }
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const anchors = [...String(oldString).split(/\r?\n/), ...String(newString).split(/\r?\n/)]
    .map((s) => s.trim()).filter((s) => s.length >= 6);
  let hit = 0;
  for (const anchor of anchors) {
    const idx = lines.findIndex((line) => line.includes(anchor));
    if (idx >= 0) { hit = idx; break; }
  }
  const start = Math.max(0, hit - 20);
  const end = Math.min(lines.length, hit + 21);
  const body = lines.slice(start, end).map((line, i) => `${String(start + i + 1).padStart(5, ' ')} ${line}`).join('\n');
  return `\n[READ current context ${relPath(file, root)}:${start + 1}-${end}]\n${body}`;
}

module.exports = {
  name: 'edit_failure_context',
  onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || !EDIT_TOOLS.has(toolUse.name)) return;
    const input = toolUse.input || {};
    const file = input.file_path || input.path || '';
    if (!file) return;
    const text = textOf(toolResult);
    const failed = toolResult.is_error === true || FAIL_RE.test(text);
    if (!failed) return;
    const root = ctx.PROJECT_ROOT || PROJECT_ROOT;
    const reason = (text.match(FAIL_RE) || [])[0] || 'edit failed';
    removeTurnEdit(root, file);
    recordFailure(root, { tool: toolUse.name, reason, file });
    if (text.includes('[READ current context')) return;
    try {
      ctx.appendToResult(toolResult, contextWindow(root, file, input.old_string || '', input.new_string || '', reason));
      ctx.markDirty();
      ctx.emit({ event: 'edit_failure_context_appended', tool: toolUse.name, file: relPath(file, root), reason });
    } catch (err) {
      ctx.warn(`edit failure context unavailable: ${err.message}`);
    }
  },
};
