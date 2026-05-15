'use strict';
// Regression: indexing-mode concurrent-request coalescing.
//
// History: a second reindex request landing while a first was still
// in-flight used to return `{"error": "indexing mode already in
// progress"}` -- surfaced to the agent as a "FAIL" with a scary
// `daemon refused indexing-mode` message and emitted a logger.warning
// at every layer it touched. But concurrent reindex requests are the
// design, not an aberration: the edit-watcher, scheduled refresh, and
// manual `i/hme admin action=index` all fire independently and
// regularly overlap. Coalescing is the correct behavior.
//
// This test exercises the in-process Python lock by importing the
// daemon's indexing module directly (no daemon running, no GPU). The
// _run_indexing_mode_locked is monkey-patched so the test doesn't try
// to actually reach the shim. Two calls run concurrently; the second
// must wait for the first and return its result tagged
// `coalesced: true`, with no "error" key.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

test('indexing-mode: concurrent calls coalesce instead of erroring', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const daemonModule = path.join(repoRoot, 'tools/HME/service/llamacpp_daemon/indexing.py');
  const result = spawnSync('python3', ['-c', `
import sys, threading, time
sys.path.insert(0, '${path.dirname(daemonModule)}')
sys.path.insert(0, '${path.join(repoRoot, 'tools/HME/service')}')
sys.path.insert(0, '${path.join(repoRoot, 'tools/HME/scripts')}')

# Stub the env + logger so the module imports clean without a real daemon.
class _StubENV:
    def optional_int(self, _k, default): return default
class _StubLogger:
    def info(self, *a, **kw): pass
    def warning(self, *a, **kw): pass
    def debug(self, *a, **kw): pass
    def error(self, *a, **kw): pass
import types
boot_mod = types.ModuleType('_boot')
boot_mod.ENV = _StubENV()
boot_mod.logger = _StubLogger()
sys.modules['_boot'] = boot_mod

# Inject as relative import target.
import importlib.util
spec = importlib.util.spec_from_file_location('indexing', '${daemonModule}')
mod = importlib.util.module_from_spec(spec)
# Make the relative \`from ._boot import ...\` resolve via package shim.
pkg = types.ModuleType('llamacpp_daemon')
pkg._boot = boot_mod
sys.modules['llamacpp_daemon'] = pkg
sys.modules['llamacpp_daemon._boot'] = boot_mod
mod.__package__ = 'llamacpp_daemon'
spec.loader.exec_module(mod)

# Replace the internal worker so we can synchronize without hitting a real shim.
gate = threading.Event()
done_first = threading.Event()
def _stub_run():
    gate.wait(timeout=5)
    return {"total_files": 100, "indexed": 100, "skipped_unchanged": 0,
            "chunks_created": 500, "symbols_indexed": 50}
mod._run_indexing_mode_locked = _stub_run

results = {}
def _call(label):
    results[label] = mod.run_indexing_mode()

t1 = threading.Thread(target=_call, args=('first',))
t1.start()
# Give t1 a moment to acquire the lock.
time.sleep(0.05)
t2 = threading.Thread(target=_call, args=('second',))
t2.start()
# Release the gate so t1 finishes.
gate.set()
t1.join(timeout=10)
t2.join(timeout=10)

import json
print(json.dumps({'first': results.get('first'), 'second': results.get('second')}))
`], { encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) {
    throw new Error(`python invocation failed: status=${result.status} stderr=${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  // First call gets the real result, no coalesced flag.
  assert.strictEqual(parsed.first.total_files, 100,
    `first call must return real result; got ${JSON.stringify(parsed.first)}`);
  assert.notStrictEqual(parsed.first.coalesced, true,
    'first (winning) call must NOT carry coalesced=true');
  assert.ok(!parsed.first.error,
    `first call must not have error; got ${JSON.stringify(parsed.first)}`);
  // Second call coalesces -- same result body, plus coalesced=true,
  // no "already in progress" error.
  assert.strictEqual(parsed.second.coalesced, true,
    `second call must carry coalesced=true; got ${JSON.stringify(parsed.second)}`);
  assert.ok(!parsed.second.error,
    `second call must NOT carry error key; got ${JSON.stringify(parsed.second)}`);
  assert.strictEqual(parsed.second.total_files, 100,
    'coalesced second call inherits the first call\'s result');
});
