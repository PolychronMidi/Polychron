'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { REASONS } = require('./reasons');
const { _entryText } = require('./transcript');

function isStructuredTaskReminderLine(trimmed) {
  if (/^#\d+\.?\s*\[(?:in_progress|pending)\]/i.test(trimmed)) return true;
  if (/^(?:[-*]\s*)?id:\s*\S+\b.*\bstatus:\s*(?:in_progress|pending)\b/i.test(trimmed)) return true;
  if (/^(?:[-*]\s*)?status:\s*(?:in_progress|pending)\b.*\b(subject|description|content|activeForm):/i.test(trimmed)) return true;
  if (/^(?:[-*]\s*)?(subject|description|content|activeForm):\s*\S+\b.*\bstatus:\s*(?:in_progress|pending)\b/i.test(trimmed)) return true;
  return false;
}

function scanUnfinishedTaskReminder(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const hits = [];
  let inStopHookPayload = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(Stop hook feedback:|Stop hook blocking error from command:|STOP-CHAIN INTEGRITY FAILURE:|---)$/.test(trimmed)
      || /^--- \[\d+\/\d+\]/.test(trimmed)) {
      inStopHookPayload = true;
      continue;
    }
    if (inStopHookPayload) {
      if (/^\s*(Carried-over HME todos|Here are the existing tasks|TaskList|#\d+\.?\s*\[(?:in_progress|pending)\])/i.test(trimmed)) inStopHookPayload = false;
      else if (/UNFINISHED TASK-LIST VIOLATION|Open task evidence:|\{"decision":"block","reason":"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
      else if (/^\d+\.\s*\d+:\[\d{4}-\d{2}-\d{2}T.*\[proxy-supervisor\]/.test(trimmed)) continue;
    }
    if (/^\d+\s+\{"decision":"block","reason":"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
    if (/^stdout\s+\{"decision":"block","reason":"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
    if (/\{"decision":"block","reason":"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
    if (!/\b(in_progress|pending)\b/i.test(trimmed)) continue;
    if (!isStructuredTaskReminderLine(trimmed)) continue;
    hits.push(trimmed.slice(0, 240));
    if (hits.length >= 6) break;
  }
  return hits;
}

function unfinishedTaskDebtFromTranscript(transcriptPath) {
  if (!transcriptPath) return [];
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return []; }
  let debt = [];
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'user') continue;
    const text = _entryText(entry);
    if (!text) continue;
    const looksTaskReminder = /Here are the existing tasks|TaskList|task list|existing tasks/i.test(text);
    if (!looksTaskReminder && !/<system-reminder>[\s\S]*\b(in_progress|pending)\b/i.test(text)) continue;
    const hits = scanUnfinishedTaskReminder(text);
    if (hits.length) debt = hits;
  }
  return debt;
}

function _assistantToolUses(entry) {
  const content = (entry && entry.message && entry.message.content) || (entry && entry.content);
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && typeof b === 'object' && b.type === 'tool_use');
}

function _todoLine(todo, fallbackId) {
  const status = String(todo && todo.status || '').trim();
  if (status !== 'pending' && status !== 'in_progress') return '';
  const text = String(
    todo.content || todo.activeForm || todo.subject || todo.description || todo.text || `task ${fallbackId}`
  ).replace(/\s+/g, ' ').trim();
  return `[${status}] ${text}`.trim().slice(0, 240);
}

function unfinishedTaskDebtFromTodoWrite(transcriptPath) {
  if (!transcriptPath) return [];
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return []; }
  let latestTodos = null;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'assistant') continue;
    for (const block of _assistantToolUses(entry)) {
      if (block.name !== 'TodoWrite') continue;
      const todos = block.input && Array.isArray(block.input.todos) ? block.input.todos : null;
      if (todos) latestTodos = todos;
    }
  }
  if (!latestTodos) return [];
  const debt = [];
  latestTodos.forEach((todo, i) => {
    const line = _todoLine(todo, i + 1);
    if (line) debt.push(line);
  });
  return debt.slice(0, 6);
}

function sessionIdFromTranscriptPath(transcriptPath) {
  const base = path.basename(String(transcriptPath || ''));
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : '';
}

function _taskStoreRoots() {
  const roots = [];
  const home = process.env.HOME || os.homedir();
  if (home) roots.push(path.join(home, '.claude', 'tasks'));
  const config = process.env.CLAUDE_CONFIG_DIR;
  if (config) roots.push(path.join(config, 'tasks'));
  return [...new Set(roots.map((p) => path.resolve(p)))];
}

function unfinishedTaskDebtFromStore(transcriptPath) {
  const sessionId = sessionIdFromTranscriptPath(transcriptPath);
  if (!sessionId) return [];
  const debt = [];
  for (const root of _taskStoreRoots()) {
    const dir = path.join(root, sessionId);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { continue; }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
      let task;
      try { task = JSON.parse(fs.readFileSync(path.join(dir, ent.name), 'utf8')); }
      catch (_e) { continue; }
      const status = String(task && task.status || '').trim();
      if (status !== 'pending' && status !== 'in_progress') continue;
      const id = String(task.id || ent.name.replace(/\.json$/, '')).trim();
      const subject = String(task.subject || task.description || task.content || '').replace(/\s+/g, ' ').trim();
      debt.push(`#${id} [${status}] ${subject}`.trim().slice(0, 240));
      if (debt.length >= 6) return debt;
    }
  }
  return debt;
}

function unfinishedTaskDebt(transcriptPath) {
  const debt = unfinishedTaskDebtFromStore(transcriptPath).concat(
    unfinishedTaskDebtFromTranscript(transcriptPath),
    unfinishedTaskDebtFromTodoWrite(transcriptPath),
  );
  if (!debt.length) return null;
  return `${REASONS.UNFINISHED_TASKS}\n\nOpen task evidence:\n${debt.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
}


module.exports = { unfinishedTaskDebt };
