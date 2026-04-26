'use strict';
// Regression: register_todo_from_lifesaver must collapse memory-variant
// errors via _normalize_error_for_dedup so a runaway monitor loop firing
// "GPU has 17342 MB free" / "16826 MB free" / "12828 MB free" doesn't
// create N distinct entries. Before this fix, 35 zombie entries from a
// single recurring failure piled up in tools/HME/KB/todos.json, which
// the user reported as "absolutely riddled with spam."
//
// Tests via Python subprocess since the todo store is implemented in
// Python (server.tools_analysis.todo). Spawns a sandboxed PROJECT_ROOT
// to avoid touching the production store.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function _runPython(sandbox, body) {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const env = {
    ...process.env,
    PROJECT_ROOT: sandbox,
    PYTHONPATH: path.join(repoRoot, 'tools', 'HME', 'service'),
  };
  const result = spawnSync('python3', ['-c', body], { env, encoding: 'utf8' });
  return result;
}

function _withSandboxedTodoStore(fn) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-todo-test-'));
  fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'KB'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'output', 'metrics'), { recursive: true });
  // hme_env requires a .env file in PROJECT_ROOT and a CLAUDE.md sibling
  // to resolve project root. The synthesis import chain validates many
  // model-alias keys at import time, so a minimal stub doesn't suffice
  // — copy the production .env (which has every key) and rewrite
  // PROJECT_ROOT to point at the sandbox. This isolates the todo store
  // (sandbox <PROJECT_ROOT>/tools/HME/KB/todos.json) without breaking
  // the env-validation chain that runs at module load.
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const prodEnv = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
  const sandboxEnv = prodEnv.replace(
    /^PROJECT_ROOT=.*$/m,
    `PROJECT_ROOT=${sandbox}`,
  );
  fs.writeFileSync(path.join(sandbox, '.env'), sandboxEnv);
  fs.writeFileSync(path.join(sandbox, 'CLAUDE.md'), '# sandbox\n');
  // Seed an empty store with the legacy meta-header sentinel shape.
  fs.writeFileSync(
    path.join(sandbox, 'tools', 'HME', 'KB', 'todos.json'),
    JSON.stringify([{ id: 0, _meta: { max_id: 0, updated_ts: 0 } }]),
  );
  try {
    return fn(sandbox);
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
}

test('lifesaver-todo dedup: memory-variant errors collapse to one entry', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import register_todo_from_lifesaver, _load_todos
import json
# Three near-duplicate errors that differ only in memory numbers.
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 17342 MB free, coder needs ~22049 MB", "CRITICAL")
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 16826 MB free, coder needs ~22049 MB", "CRITICAL")
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 12828 MB free, coder needs ~22049 MB", "CRITICAL")
meta, todos = _load_todos()
ls_open = [t for t in todos if t.get("source") == "lifesaver" and not t.get("done")]
print(json.dumps({
  "open_count": len(ls_open),
  "recurrence": ls_open[0].get("recurrence_count") if ls_open else 0,
}))
`);
    if (result.status !== 0) {
      throw new Error(`python failed: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.open_count, 1, 'three memory-variant errors must collapse to ONE entry');
    assert.strictEqual(parsed.recurrence, 3, 'recurrence_count must reflect all three firings');
  });
});

test('lifesaver-todo dedup: structurally-different errors stay distinct', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import register_todo_from_lifesaver, _load_todos
import json
# Different ERROR CLASSES — must NOT collapse.
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 17342 MB free, coder needs ~22049 MB", "CRITICAL")
register_todo_from_lifesaver("llamacpp_offload_invariant", "model crash: segfault in attention layer", "CRITICAL")
register_todo_from_lifesaver("rag_proxy", "shim connection refused", "WARNING")
meta, todos = _load_todos()
ls_open = [t for t in todos if t.get("source") == "lifesaver" and not t.get("done")]
print(json.dumps({"open_count": len(ls_open)}))
`);
    if (result.status !== 0) {
      throw new Error(`python failed: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.open_count, 3, 'structurally-different errors must remain distinct entries');
  });
});

test('lifesaver-todo store-protection: TTL sweep auto-resolves stale entries', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
import os
os.environ["HME_LIFESAVER_TODO_TTL_SEC"] = "1"  # 1-second TTL for test
from server.tools_analysis.todo import register_todo_from_lifesaver, _load_todos, _enforce_lifesaver_caps, _todo_lock, _save_todos
import json, time
register_todo_from_lifesaver("monitor_a", "transient failure A", "CRITICAL")
time.sleep(2)  # entry now older than TTL
# Trigger sweep via a fresh registration.
register_todo_from_lifesaver("monitor_b", "fresh failure B", "CRITICAL")
meta, todos = _load_todos()
ls = [t for t in todos if t.get("source") == "lifesaver"]
ls_open = [t for t in ls if not t.get("done")]
ttl_resolved = [t for t in ls if t.get("resolved_reason") == "stale-ttl"]
print(json.dumps({
  "total": len(ls),
  "open": len(ls_open),
  "ttl_resolved": len(ttl_resolved),
}))
`);
    if (result.status !== 0) {
      throw new Error(`python failed: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.ttl_resolved, 1, 'stale entry must be auto-resolved by TTL sweep');
    assert.strictEqual(parsed.open, 1, 'only the fresh entry stays open');
  });
});
