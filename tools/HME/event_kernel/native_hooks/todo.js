'use strict';

const {
  PROJECT_ROOT,
  allow,
  httpGetOk,
  httpPostJson,
  path,
  runPython,
  toolInput,
} = require('./common');

async function pretoolTodoWrite(stdinJson) {
  const helper = path.join(PROJECT_ROOT, 'tools', 'HME', 'hooks', 'helpers', '_todo_merge.py');
  const r = runPython([helper], stdinJson, 30_000, 'todowrite-merge');
  let todos = [];
  try { todos = JSON.parse((r.stdout || '').trim() || '[]'); } catch (_e) { todos = []; }
  if (!Array.isArray(todos) || todos.length === 0) {
    todos = toolInput(stdinJson).todos || [];
  }
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
