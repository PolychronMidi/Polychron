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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-post-write-'));
  const cleanup = () => {
    if (oldRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = oldRoot;
    if (oldMetrics === undefined) delete process.env.METRICS_DIR;
    else process.env.METRICS_DIR = oldMetrics;
    clearHmeRequireCache();
    fs.rmSync(root, { recursive: true, force: true });
  };
  process.env.PROJECT_ROOT = root;
  process.env.METRICS_DIR = path.join(root, 'src', 'output', 'metrics');
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
      toolUse: { name: 'Edit', input: { file_path: path.join(root, 'README.md'), new_string: 'x' } },
      toolResult,
      ctx: c,
    });
    assert.strictEqual(toolResult.content, 'edit ok');
    assert.deepStrictEqual(c.emitted, []);
    assert.deepStrictEqual(c.warnings, []);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], ['python3', ['tools/HME/scripts/pipeline/hme/build-dir-intent-index.py']]);
  } finally {
    childProcess.spawn = originalSpawn;
    clearHmeRequireCache();
  }
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
      toolUse: { name: 'Edit', input: { file_path: path.join(root, 'README.md'), new_string: 'x' } },
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
