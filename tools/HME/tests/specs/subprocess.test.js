'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { run, runSync, captureSync } = require('../../proxy/infra/subprocess');

test('runSync captures stdout, stderr, exit code', () => {
  const r = runSync('node', ['-e', 'process.stderr.write("warn"); console.log("hi"); process.exit(0);']);
  assert.equal(r.exit, 0);
  assert.match(r.stdout, /hi/);
  assert.match(r.stderr, /warn/);
  assert.equal(r.timedOut, false);
});

test('runSync surfaces non-zero exit without throwing', () => {
  const r = runSync('node', ['-e', 'process.exit(7);']);
  assert.equal(r.exit, 7);
});

test('run resolves with stdout/stderr/exit', async () => {
  const r = await run('node', ['-e', 'console.log("ok"); process.exit(0);']);
  assert.equal(r.exit, 0);
  assert.match(r.stdout, /ok/);
});

test('captureSync throws on non-zero exit and attaches result', () => {
  assert.throws(
    () => captureSync('node', ['-e', 'process.exit(2);']),
    (err) => err && err.result && err.result.exit === 2,
  );
});

test('run honors timeoutMs and reports timedOut', async () => {
  const r = await run('node', ['-e', 'setTimeout(() => {}, 5000);'], { timeoutMs: 150 });
  assert.equal(r.timedOut, true);
  assert.notEqual(r.exit, 0);
});

test('runSync honors cwd', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subprocess-cwd-'));
  try {
    const r = runSync('node', ['-e', 'process.stdout.write(process.cwd());'], { cwd: dir });
    assert.equal(r.exit, 0);
    assert.equal(fs.realpathSync(r.stdout), fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
