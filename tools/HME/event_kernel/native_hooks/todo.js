'use strict';

const fs = require('fs');

const {
  PROJECT_ROOT,
  allow,
  httpGetOk,
  httpPostJson,
  path,
  runPython,
  toolInput,
} = require('./common');

const crypto = require('crypto');

const STATE_FILE = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'todo-state-guard.json');
const REPEAT_WINDOW_MS = 90_000;

function canonicalTodos(todos) {
  return JSON.stringify((Array.isArray(todos) ? todos : []).map((todo) => ({
    content: String(todo?.content || ''),
    status: String(todo?.status || ''),
    priority: String(todo?.priority || ''),
  })).sort((a, b) => a.content.localeCompare(b.content)));
}

function digestTodos(todos) {
  return crypto.createHash('sha256').update(canonicalTodos(todos)).digest('hex').slice(0, 16);
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_e) { return {}; }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function logRepeat(row) {
  const file = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'todo-repeat-guard.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
}

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

function repeatedTodoDecision(todos) {
  const digest = digestTodos(todos);
  const now = Date.now();
  const state = readState();
  const prev = state.last_todowrite || {};
  const allDone = Array.isArray(todos) && todos.length > 0
    && todos.every((todo) => ['completed', 'cancelled'].includes(String(todo?.status || '')));
  const repeated = prev.digest === digest && (now - Number(prev.ts_ms || 0)) < REPEAT_WINDOW_MS;
  const repeatedAfterAllDone = repeated && allDone && prev.all_done === true;
  state.last_todowrite = {
    digest,
    ts_ms: now,
    count: repeated ? Number(prev.count || 1) + 1 : 1,
    all_done: allDone,
  };
  writeState(state);
  if (!repeatedAfterAllDone && !repeated) return null;
  const reason = repeatedAfterAllDone
    ? 'TODO COMPLETE: all TodoWrite items are completed/cancelled. Stop calling TodoWrite now; answer the user.'
    : 'TODO LOOP BLOCKED: repeated TodoWrite state with no task-list change. Stop calling TodoWrite now; answer the user or do non-Todo work. This is loop visibility, not a request to retry.';
  logRepeat({ decision: 'block', digest, count: state.last_todowrite.count, all_done: allDone, reason });
  return deny(reason);
}

async function pretoolTodoWrite(stdinJson) {
  const helper = path.join(PROJECT_ROOT, 'tools', 'HME', 'hooks', 'helpers', '_todo_merge.py');
  const r = runPython([helper], stdinJson, 30_000, 'todowrite-merge');
  let todos = [];
  try { todos = JSON.parse((r.stdout || '').trim() || '[]'); } catch (_e) { todos = []; }
  if (!Array.isArray(todos) || todos.length === 0) {
    todos = toolInput(stdinJson).todos || [];
  }
  const repeat = repeatedTodoDecision(todos);
  if (repeat) return allow(JSON.stringify(repeat));
  return allow(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { todos },
    },
  }));
}

async function posttoolTodoWrite(stdinJson) {
  const todos = toolInput(stdinJson).todos || [];
  if (!Array.isArray(todos) || todos.length === 0) return allow();
  const high = todos.filter((t) => t && t.priority === 'high' && t.status !== 'completed');
  if (high.length === 0) return allow();
  const { servicePort } = require('../../proxy/service_registry');
  const port = servicePort('worker');
  if (!(await httpGetOk(port, '/health'))) return allow();
  await httpPostJson(port, '/hme/todo', { action: 'sync_native', todos: high });
  return allow();
}

module.exports = { pretoolTodoWrite, posttoolTodoWrite };
