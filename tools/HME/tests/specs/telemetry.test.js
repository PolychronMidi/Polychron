'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Sandbox PROJECT_ROOT so emissions don't pollute the real log/ dir.
function _withSandbox(fn) {
  return async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-telemetry-test-'));
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = sandbox;
    try {
      delete require.cache[require.resolve('../../telemetry')];
      const t = require('../../telemetry');
      await fn(sandbox, t);
    } finally {
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
      delete require.cache[require.resolve('../../telemetry')];
      try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    }
  };
}

test('telemetry: exports the six channels + record', _withSandbox(async (_sb, t) => {
  for (const fn of ['record', 'info', 'error', 'metric', 'audit', 'debug']) {
    assert.strictEqual(typeof t[fn], 'function', `expected ${fn} to be a function`);
  }
  assert.ok(t.PATHS && typeof t.PATHS === 'object');
}));

test('telemetry: info → JSONL append to hme-activity.jsonl', _withSandbox(async (sb, t) => {
  t.info('test_info_event', { foo: 'bar', n: 1 });
  const file = path.join(sb, 'output', 'metrics', 'hme-activity.jsonl');
  assert.ok(fs.existsSync(file), 'info channel must create the activity log');
  const line = fs.readFileSync(file, 'utf8').trim().split('\n').pop();
  const parsed = JSON.parse(line);
  assert.strictEqual(parsed.event, 'test_info_event');
  assert.strictEqual(parsed.foo, 'bar');
  assert.strictEqual(parsed.n, 1);
  assert.ok(typeof parsed.ts === 'number');
}));

test('telemetry: error → human-readable line + JSON tail in hme-errors.log', _withSandbox(async (sb, t) => {
  t.error('test_error_event', { reason: 'something broke', context: 'in unit test' });
  const file = path.join(sb, 'log', 'hme-errors.log');
  assert.ok(fs.existsSync(file), 'error channel must create hme-errors.log');
  const line = fs.readFileSync(file, 'utf8').trim();
  // Format: [ts] [event] reason  {json}
  assert.match(line, /\[test_error_event\]/);
  assert.match(line, /something broke/);
  assert.match(line, /\{"event":"test_error_event"/);
}));

test('telemetry: metric → JSONL append to hme-hook-latency.jsonl', _withSandbox(async (sb, t) => {
  t.metric('hook_latency_test', { hook: 'stop', duration_ms: 117 });
  const file = path.join(sb, 'log', 'hme-hook-latency.jsonl');
  assert.ok(fs.existsSync(file));
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.strictEqual(parsed.event, 'hook_latency_test');
  assert.strictEqual(parsed.hook, 'stop');
  assert.strictEqual(parsed.duration_ms, 117);
}));

test('telemetry: audit → JSONL append to hme-audit.jsonl', _withSandbox(async (sb, t) => {
  t.audit('audit_test', { caller: 'test', action: 'verify' });
  const file = path.join(sb, 'log', 'hme-audit.jsonl');
  assert.ok(fs.existsSync(file));
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.strictEqual(parsed.event, 'audit_test');
  assert.strictEqual(parsed.caller, 'test');
}));

test('telemetry: debug is silent unless TELEMETRY_DEBUG=1', _withSandbox(async (_sb, t) => {
  // No env var set: debug should not write to stderr (we can't easily
  // observe stderr from the test process, but at minimum it should not
  // throw and should not create any file).
  t.debug('debug_event', { x: 1 });
  // No file path for debug — verified by the absence of a debug file.
  assert.ok(!t.PATHS.debug, 'debug channel has no file destination');
}));

test('telemetry: HME_TELEMETRY_DISABLE suppresses listed categories', _withSandbox(async (sb, _t) => {
  const originalDisable = process.env.HME_TELEMETRY_DISABLE;
  process.env.HME_TELEMETRY_DISABLE = 'info,metric';
  try {
    delete require.cache[require.resolve('../../telemetry')];
    const t2 = require('../../telemetry');
    t2.info('should_not_appear', {});
    t2.metric('should_not_appear', {});
    t2.error('should_appear', { reason: 'x' });
    const infoFile = path.join(sb, 'output', 'metrics', 'hme-activity.jsonl');
    const errorFile = path.join(sb, 'log', 'hme-errors.log');
    const metricFile = path.join(sb, 'log', 'hme-hook-latency.jsonl');
    assert.ok(!fs.existsSync(infoFile), 'info channel must be suppressed');
    assert.ok(!fs.existsSync(metricFile), 'metric channel must be suppressed');
    assert.ok(fs.existsSync(errorFile), 'error channel must NOT be suppressed');
  } finally {
    if (originalDisable === undefined) delete process.env.HME_TELEMETRY_DISABLE;
    else process.env.HME_TELEMETRY_DISABLE = originalDisable;
    delete require.cache[require.resolve('../../telemetry')];
  }
}));

test('telemetry: ts auto-stamped if not provided in fields', _withSandbox(async (sb, t) => {
  t.info('auto_ts', { foo: 'bar' });
  const file = path.join(sb, 'output', 'metrics', 'hme-activity.jsonl');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.ok(typeof parsed.ts === 'number');
  assert.ok(parsed.ts > 1700000000000, 'ts should be an epoch ms timestamp');
}));
