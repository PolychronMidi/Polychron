'use strict';
// Hide transient unified-todo dirtiness from git-status tool results. If sync
// failed, leave the raw status visible so the failure remains actionable.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const TODO_STATE = new Set(['doc/templates/TODO.md', 'tools/HME/KB/todos.json']);
const FAIL_FLAGS = [
  path.join(PROJECT_ROOT, 'runtime', 'hme', 'todo-sync.fail'),
  path.join(PROJECT_ROOT, 'runtime', 'hme', 'autocommit.fail'),
];

function textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
}

function isPlainGitStatus(command) {
  const cmd = String(command || '').trim();
  if (!cmd || /[;&|`$()]/.test(cmd)) return false;
  if (!/^git(?:\s+-C\s+\S+)?\s+status\b/.test(cmd)) return false;
  return /(?:^|\s)(?:--short|-s|--porcelain(?:=\S+)?)(?:\s|$)/.test(cmd);
}

function statusPath(line) {
  if (!line.trim()) return '';
  if (!/^(?:[ MADRCU?!]{2}|\?\?)\s+/.test(line)) return null;
  let p = line.slice(3).trim();
  if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
  return p.replace(/^"|"$/g, '');
}

function onlyTodoState(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return false;
  const paths = lines.map(statusPath);
  return paths.every((p) => p && TODO_STATE.has(p));
}

function syncFailurePresent() {
  return FAIL_FLAGS.some((flag) => {
    try { return fs.existsSync(flag); } catch (_e) { return false; }
  });
}

module.exports = {
  name: 'todo_status_filter',
  onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || toolUse.name !== 'Bash') return;
    if (!isPlainGitStatus(toolUse.input && toolUse.input.command)) return;
    if (syncFailurePresent()) return;
    if (!onlyTodoState(textOf(toolResult))) return;
    ctx.replaceResult(toolResult, '');
    ctx.markDirty();
    ctx.emit({ event: 'todo_status_suppressed', files: TODO_STATE.size });
  },
};
