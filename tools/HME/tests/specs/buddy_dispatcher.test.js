'use strict';
// Regression: buddy_dispatcher.py Phase 2 logic — orphan sweep, verdict
// file, fast-path on clean. Tests exercise the pure-Python paths
// (filesystem ops + JSON state) without spawning real claude buddies.
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
    PYTHONPATH: '',
  };
  const result = spawnSync('python3', ['-c', body], { env, encoding: 'utf8' });
  return result;
}

function _withDispatcherSandbox(fn) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-dispatcher-test-'));
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  try {
    return fn(sandbox);
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
}

function _dispatcherImport() {
  // Import the dispatcher module by file path so it doesn't trigger the
  // hme_env validation chain (we don't need it for these unit tests).
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const dispPath = path.join(repoRoot, 'tools', 'HME', 'scripts', 'buddy_dispatcher.py');
  return `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("buddy_dispatcher", "${dispPath}")
disp = importlib.util.module_from_spec(spec)
sys.modules["buddy_dispatcher"] = disp
spec.loader.exec_module(disp)
`;
}

test('dispatcher: orphan sweep moves processing/<buddy>/<task>.json back to pending/', () => {
  _withDispatcherSandbox((sandbox) => {
    // Plant an orphan in processing/buddy-1/
    const orphan_dir = path.join(sandbox, 'tmp', 'hme-buddy-queue', 'processing', 'buddy-1');
    fs.mkdirSync(orphan_dir, { recursive: true });
    fs.writeFileSync(path.join(orphan_dir, 'abc123.json'), JSON.stringify({ id: 'abc123', tier: 'easy', text: 'orphan task' }));
    const result = _runPython(sandbox, `
${_dispatcherImport()}
disp._ensure_dirs()
swept = disp._sweep_orphans("test-run")
import json
print(json.dumps({"swept": swept}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.swept, 1, 'sweep must recover one orphan');
    // Verify the orphan landed back in pending/
    const pending = fs.readdirSync(path.join(sandbox, 'tmp', 'hme-buddy-queue', 'pending'));
    assert.strictEqual(pending.length, 1, 'pending/ should now have the recovered orphan');
    assert.strictEqual(pending[0], 'abc123.json', 'orphan filename preserved');
    // Original processing/<buddy>/<task> should be empty
    const remaining = fs.readdirSync(orphan_dir);
    assert.strictEqual(remaining.length, 0, 'processing/<buddy>/ should be empty after sweep');
  });
});

test('dispatcher: orphan sweep handles name collision with .recovered suffix', () => {
  _withDispatcherSandbox((sandbox) => {
    const queue_root = path.join(sandbox, 'tmp', 'hme-buddy-queue');
    const pending = path.join(queue_root, 'pending');
    const orphan_dir = path.join(queue_root, 'processing', 'buddy-1');
    fs.mkdirSync(pending, { recursive: true });
    fs.mkdirSync(orphan_dir, { recursive: true });
    // Same-name file already in pending (caller re-enqueued mid-flight)
    fs.writeFileSync(path.join(pending, 'dup.json'), JSON.stringify({ id: 'dup', text: 'already pending' }));
    fs.writeFileSync(path.join(orphan_dir, 'dup.json'), JSON.stringify({ id: 'dup', text: 'orphan version' }));
    const result = _runPython(sandbox, `
${_dispatcherImport()}
swept = disp._sweep_orphans("test-run")
import json, os
print(json.dumps({"swept": swept, "pending": sorted(os.listdir("${pending}"))}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.swept, 1, 'sweep must still recover despite collision');
    assert.deepStrictEqual(
      parsed.pending,
      ['dup.json', 'dup.recovered.json'],
      'collision-recovered file gets .recovered suffix',
    );
  });
});

test('dispatcher: fast-path-clean returns true when all signals green', () => {
  _withDispatcherSandbox((sandbox) => {
    // Plant a sid file so _list_buddies returns at least one buddy
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'fake-sid-for-test\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'medium\n');
    const result = _runPython(sandbox, `
${_dispatcherImport()}
disp._ensure_dirs()
buddies = disp._list_buddies()
clean = disp._fast_path_clean(buddies)
import json
print(json.dumps({"buddies": len(buddies), "fast_path_clean": clean}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.buddies, 1, 'sid file should register one buddy');
    assert.strictEqual(parsed.fast_path_clean, true, 'all signals green should yield fast-path-clean');
  });
});

test('dispatcher: fast-path-clean returns false when pending queue non-empty', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
disp._ensure_dirs()
# Drop a task into pending
import json
(disp.QUEUE_PENDING / "pending-task.json").write_text(json.dumps({"id": "x", "tier": "easy", "text": "blocker"}))
clean = disp._fast_path_clean([])
print(json.dumps({"fast_path_clean": clean}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.fast_path_clean, false, 'pending tasks block fast-path');
  });
});

test('dispatcher: floor-based escalation picks higher of (item, floor) per axis', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
# easy item + medium floor → effective = medium (floor wins)
# hard item + easy floor → effective = hard (item wins)
# medium item + medium floor → medium (equal)
print(json.dumps({
  "easy_item_medium_floor": disp._effective_tier("easy", "medium"),
  "hard_item_easy_floor": disp._effective_tier("hard", "easy"),
  "medium_item_medium_floor": disp._effective_tier("medium", "medium"),
  "unknown_falls_back": disp._effective_tier("garbage", "medium"),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.easy_item_medium_floor, 'medium', 'floor wins over lower item tier');
    assert.strictEqual(parsed.hard_item_easy_floor, 'hard', 'item wins over lower floor');
    assert.strictEqual(parsed.medium_item_medium_floor, 'medium', 'equal stays equal');
    assert.strictEqual(parsed.unknown_falls_back, 'medium', 'unknown tier defaults to medium');
  });
});

test('dispatcher: verdict file written with deferred block + outcome counts', () => {
  _withDispatcherSandbox((sandbox) => {
    // Plant a "claimed but not finished" file in processing/ to test [deferred]
    const orphan_dir = path.join(sandbox, 'tmp', 'hme-buddy-queue', 'processing', 'buddy-2');
    fs.mkdirSync(orphan_dir, { recursive: true });
    fs.writeFileSync(path.join(orphan_dir, 'still-claimed.json'), JSON.stringify({ id: 'still-claimed' }));
    const result = _runPython(sandbox, `
${_dispatcherImport()}
disp._ensure_dirs()
manifest = {
  "run_id": "test-verdict-run",
  "started_ts": 1000.0,
  "finished_ts": 2000.0,
  "buddies": [{"slot": 1, "floor": "medium"}, {"slot": 2, "floor": "hard"}],
  "iterations": [
    {"task_id": "t1", "outcome": "done", "elapsed_s": 5.2, "buddy_slot": 1},
    {"task_id": "t2", "outcome": "failed", "elapsed_s": 1.1, "buddy_slot": 2},
    {"task_id": "t3", "outcome": "timeout", "elapsed_s": 300.0, "buddy_slot": 1},
  ],
  "loop": {"terminated_by": "queue_empty"},
  "drained_count": 3,
}
verdict_path = disp._write_verdict("test-verdict-run", manifest)
print(verdict_path.read_text())
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const verdict = result.stdout;
    assert.ok(verdict.includes('# Buddy fanout verdict — test-verdict-run'), 'verdict has run-id header');
    assert.ok(verdict.includes('done: 1'), 'verdict counts done outcomes');
    assert.ok(verdict.includes('failed: 1'), 'verdict counts failed outcomes');
    assert.ok(verdict.includes('timeout: 1'), 'verdict counts timeout outcomes');
    assert.ok(verdict.includes('## [deferred]'), 'verdict includes deferred block when orphans present');
    assert.ok(verdict.includes('still-claimed.json'), 'deferred block names the orphan');
    assert.ok(verdict.includes('Failed / timed-out tasks'), 'verdict lists failures');
  });
});

test('dispatcher: enqueue produces well-formed task file', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import argparse, json
ns = argparse.Namespace(tier="hard", text="test enqueue", source="unit_test", id="fixed-id-001", context="")
disp.cmd_enqueue(ns)
task_path = disp.QUEUE_PENDING / "fixed-id-001.json"
task = json.loads(task_path.read_text())
print(json.dumps({
  "id": task["id"],
  "tier": task["tier"],
  "text": task["text"],
  "source": task["source"],
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.id, 'fixed-id-001');
    assert.strictEqual(parsed.tier, 'hard');
    assert.strictEqual(parsed.text, 'test enqueue');
    assert.strictEqual(parsed.source, 'unit_test');
  });
});

test('dispatcher: manager-guidance file is read when present', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(
      path.join(sandbox, 'tmp', 'hme-operator-guidance.md'),
      'Prefer review-discipline over speed this cycle.\n',
    );
    const result = _runPython(sandbox, `
${_dispatcherImport()}
guidance = disp._read_guidance()
import json
print(json.dumps({"guidance": guidance}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.ok(parsed.guidance.includes('review-discipline'), 'guidance content read correctly');
  });
});

test('dispatcher: manager-guidance file returns empty when absent', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
guidance = disp._read_guidance()
print(repr(guidance))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    assert.strictEqual(result.stdout.trim(), "''", 'absent guidance file returns empty string');
  });
});
