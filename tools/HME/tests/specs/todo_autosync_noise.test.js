'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function clearHmeRequireCache() {
  const roots = [path.join(repoRoot, 'tools', 'HME', 'proxy'), path.join(repoRoot, 'tools', 'HME', 'event_kernel')];
  for (const k of Object.keys(require.cache)) {
    if (roots.some((r) => k.startsWith(r))) delete require.cache[k];
  }
}

function withProject(fn) {
  const oldRoot = process.env.PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-todo-noise-'));
  process.env.PROJECT_ROOT = root;
  clearHmeRequireCache();
  try { return fn(root); }
  finally {
    if (oldRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = oldRoot;
    clearHmeRequireCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function ctx() {
  return {
    dirty: false,
    emitted: [],
    replaceResult(result, text) { result.content = text; },
    markDirty() { this.dirty = true; },
    emit(row) { this.emitted.push(row); },
  };
}

test('todo_status_filter suppresses only unified-todo git status dirtiness', () => withProject(() => {
  const mod = require('../../proxy/middleware/26_todo_status_filter');
  const toolUse = { name: 'Bash', input: { command: 'git status --short' } };
  const toolResult = { content: ' M doc/templates/TODO.md\n M tools/HME/KB/todos.json\n' };
  const c = ctx();
  mod.onToolResult({ toolUse, toolResult, ctx: c });
  assert.strictEqual(toolResult.content, '');
  assert.strictEqual(c.dirty, true);
  assert.strictEqual(c.emitted[0].event, 'todo_status_suppressed');
}));

test('todo_status_filter keeps real non-todo status output visible', () => withProject(() => {
  const mod = require('../../proxy/middleware/26_todo_status_filter');
  const toolUse = { name: 'Bash', input: { command: 'git status --short' } };
  const content = ' M doc/templates/TODO.md\n M src/main.js\n';
  const toolResult = { content };
  const c = ctx();
  mod.onToolResult({ toolUse, toolResult, ctx: c });
  assert.strictEqual(toolResult.content, content);
  assert.strictEqual(c.dirty, false);
}));

test('todo_status_filter keeps todo status visible when sync failed', () => withProject((root) => {
  fs.mkdirSync(path.join(root, 'runtime', 'hme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'hme', 'todo-sync.fail'), 'sync failed\n');
  const mod = require('../../proxy/middleware/26_todo_status_filter');
  const toolUse = { name: 'Bash', input: { command: 'git status --short' } };
  const content = ' M doc/templates/TODO.md\n';
  const toolResult = { content };
  const c = ctx();
  mod.onToolResult({ toolUse, toolResult, ctx: c });
  assert.strictEqual(toolResult.content, content);
  assert.strictEqual(c.dirty, false);
}));

function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve();
      } catch (err) { return reject(err); }
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('codex plan scanner is silent on sync success', async () => withProject(async (root) => {
  const script = path.join(root, 'sync_ok.py');
  fs.writeFileSync(script, 'import json; print(json.dumps({"ok": True}))\n');
  const events = [];
  const { createPlanScanner } = require('../../proxy/codex_plan_scanner');
  const scanner = createPlanScanner({
    loadConfig: () => ({ todo_sync: { enabled: true } }),
    record: (row) => events.push(row),
    nowIso: () => '2026-05-15T00:00:00.000Z',
    planSync: script,
    projectRoot: root,
  });
  scanner.scanObjectForPlan({ type: 'function_call', name: 'update_plan', call_id: 'ok1', arguments: JSON.stringify({ plan: [{ step: 'silent success', status: 'pending' }] }) }, {});
  await waitFor(() => fs.existsSync(path.join(root, 'runtime', 'hme', 'event-ipc')));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepStrictEqual(events, []);
  assert.strictEqual(fs.existsSync(path.join(root, 'runtime', 'hme', 'todo-sync.fail')), false);
}));

test('codex plan scanner records only sync failure', async () => withProject(async (root) => {
  const script = path.join(root, 'sync_fail.py');
  fs.writeFileSync(script, 'import sys; print("bad sync", file=sys.stderr); sys.exit(7)\n');
  const events = [];
  const { createPlanScanner } = require('../../proxy/codex_plan_scanner');
  const scanner = createPlanScanner({
    loadConfig: () => ({ todo_sync: { enabled: true } }),
    record: (row) => events.push(row),
    nowIso: () => '2026-05-15T00:00:00.000Z',
    planSync: script,
    projectRoot: root,
  });
  scanner.scanObjectForPlan({ type: 'function_call', name: 'update_plan', call_id: 'bad1', arguments: JSON.stringify({ plan: [{ step: 'loud failure', status: 'pending' }] }) }, {});
  await waitFor(() => events.some((e) => e.kind === 'todo-sync-failed'));
  const flag = fs.readFileSync(path.join(root, 'runtime', 'hme', 'todo-sync.fail'), 'utf8');
  assert.match(flag, /codex plan sync failed exit=7/);
  assert.strictEqual(events.length, 1);
}));
