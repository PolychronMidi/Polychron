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
  const oldMetrics = process.env.METRICS_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-todo-noise-'));
  const cleanup = () => {
    if (oldRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = oldRoot;
    if (oldMetrics === undefined) delete process.env.METRICS_DIR;
    else process.env.METRICS_DIR = oldMetrics;
    clearHmeRequireCache();
    fs.rmSync(root, { recursive: true, force: true });
  };
  process.env.PROJECT_ROOT = root;
  process.env.METRICS_DIR = path.join(root, 'output', 'metrics');
  clearHmeRequireCache();
  try {
    const result = fn(root);
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup();
    return result;
  } catch (err) {
    cleanup();
    throw err;
  }
}

function ctx() {
  return {
    dirty: false,
    emitted: [],
    warnings: [],
    replaceResult(result, text) { result.content = text; },
    appendToResult(result, text) { result.content = String(result.content || '') + text; },
    warn(message) { this.warnings.push(message); },
    markDirty() { this.dirty = true; },
    emit(row) { this.emitted.push(row); },
  };
}

test('todo_status_filter suppresses only unified-todo git status dirtiness', () => withProject(() => {
  const mod = require('../../proxy/middleware/25_todo_status_filter');
  const toolUse = { name: 'Bash', input: { command: 'git status --short' } };
  const toolResult = { content: ' M doc/templates/TODO.md\n M tools/HME/KB/todos.json\n' };
  const c = ctx();
  mod.onToolResult({ toolUse, toolResult, ctx: c });
  assert.strictEqual(toolResult.content, '');
  assert.strictEqual(c.dirty, true);
  assert.strictEqual(c.emitted[0].event, 'todo_status_suppressed');
}));

test('todo_status_filter keeps real non-todo status output visible', () => withProject(() => {
  const mod = require('../../proxy/middleware/25_todo_status_filter');
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
  const mod = require('../../proxy/middleware/25_todo_status_filter');
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
  fs.writeFileSync(script, 'import json, os; open(os.path.join(os.environ["PROJECT_ROOT"], "done"), "w").write("1"); print(json.dumps({"ok": True}))\n');
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
  await waitFor(() => fs.existsSync(path.join(root, 'done')));
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


test('post_write_side_effects keeps successful side effects model-silent', () => withProject((root) => {
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = (cmd, args) => {
    calls.push([cmd, args]);
    return { on() { return this; }, unref() {} };
  };
  try {
    clearHmeRequireCache();
    const mod = require('../../proxy/middleware/28_post_write_side_effects');
    const toolResult = { content: 'edit ok' };
    const c = ctx();
    mod.onToolResult({
      toolUse: { name: 'Edit', input: { file_path: path.join(root, 'doc/templates/TODO.md'), new_string: 'x' } },
      toolResult,
      ctx: c,
    });
    assert.strictEqual(toolResult.content, 'edit ok');
    assert.deepStrictEqual(c.emitted, []);
    assert.deepStrictEqual(c.warnings, []);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], ['python3', ['tools/HME/scripts/todo_autoflip.py']]);
  } finally {
    childProcess.spawn = originalSpawn;
    clearHmeRequireCache();
  }
}));

test('post_write_side_effects emits staleness-based write coherence events', () => withProject((root) => {
  fs.mkdirSync(path.join(root, 'output/metrics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'output/metrics/kb-staleness.json'), JSON.stringify({
    modules: [
      { module: 'freshMissing', status: 'MISSING' },
      { module: 'staleThing', status: 'STALE' },
    ],
  }));
  clearHmeRequireCache();
  const mod = require('../../proxy/middleware/28_post_write_side_effects');
  const c = ctx();
  mod.onToolResult({
    toolUse: { name: 'Edit', input: { file_path: path.join(root, 'src/freshMissing.js'), new_string: 'x' } },
    toolResult: { content: 'ok' },
    ctx: c,
  });
  mod.onToolResult({
    toolUse: { name: 'Edit', input: { file_path: path.join(root, 'src/staleThing.js'), new_string: 'x' } },
    toolResult: { content: 'ok' },
    ctx: c,
  });
  assert.deepStrictEqual(c.emitted.map((e) => e.event), ['productive_incoherence', 'coherence_violation']);
}));

test('post_write_side_effects surfaces side-effect spawn failures', () => withProject((root) => {
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = () => { throw new Error('spawn denied'); };
  try {
    clearHmeRequireCache();
    const mod = require('../../proxy/middleware/28_post_write_side_effects');
    const toolResult = { content: 'edit ok' };
    const c = ctx();
    mod.onToolResult({
      toolUse: { name: 'Edit', input: { file_path: path.join(root, 'doc/templates/TODO.md'), new_string: 'x' } },
      toolResult,
      ctx: c,
    });
    assert.match(toolResult.content, /post-write side effect failed/);
    assert.match(c.warnings[0], /spawn denied/);
    assert.strictEqual(c.emitted[0].event, 'post_write_side_effect_failed');
  } finally {
    childProcess.spawn = originalSpawn;
    clearHmeRequireCache();
  }
}));
