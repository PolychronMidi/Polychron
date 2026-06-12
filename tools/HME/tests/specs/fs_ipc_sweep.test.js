'use strict';
// Regression: fs_ipc per-invocation cleanup() only runs on graceful child
// close, so a SIGKILLed/restarted parent leaks its detached child's IPC dir.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ipc = require('../../event_kernel/fs_ipc');

function _mkdir(prefix) {
  fs.mkdirSync(ipc.IPC_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(ipc.IPC_ROOT, prefix));
}

test('sweepStaleInvocations removes dirs older than the TTL, keeps fresh ones', () => {
  const stale = _mkdir('TESTSWEEP-stale-');
  const fresh = _mkdir('TESTSWEEP-fresh-');
  try {
    const old = Date.now() - 2 * 3600 * 1000; // 2h old (default TTL 1h)
    fs.utimesSync(stale, new Date(old), new Date(old));
    const removed = ipc.sweepStaleInvocations();
    assert.ok(removed >= 1, 'at least the stale dir is swept');
    assert.ok(!fs.existsSync(stale), 'stale dir is removed');
    assert.ok(fs.existsSync(fresh), 'fresh dir is preserved');
  } finally {
    fs.rmSync(stale, { recursive: true, force: true });
    fs.rmSync(fresh, { recursive: true, force: true });
  }
});

test('sweepStaleInvocations is a no-op when IPC_ROOT is absent', () => {
  // A non-existent root must not throw -- nothing to sweep.
  const removed = ipc.sweepStaleInvocations.call(null, Date.now());
  assert.strictEqual(typeof removed, 'number');
});

test('graceful spawn still cleans its own dir (fast path intact)', () => {
  const before = new Set(fs.existsSync(ipc.IPC_ROOT) ? fs.readdirSync(ipc.IPC_ROOT) : []);
  const r = ipc.spawnFileInputSync('node', ['-e', 'process.stdin.on("data",()=>{}); console.log("ok")'], {
    input: '{}',
    label: 'TESTSWEEP-graceful',
    timeoutMs: 5000,
  });
  assert.match(r.stdout, /ok/);
  const after = fs.existsSync(ipc.IPC_ROOT) ? fs.readdirSync(ipc.IPC_ROOT) : [];
  const leaked = after.filter((d) => d.startsWith('TESTSWEEP-graceful') && !before.has(d));
  assert.deepStrictEqual(leaked, [], 'graceful spawn leaves no TESTSWEEP-graceful dir behind');
});
