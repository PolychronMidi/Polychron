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
import os
# claude-resume mode is what scans sid files; set explicitly for this test
os.environ["BUDDY_SYSTEM"] = "1"
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

test('dispatch-mode: HME_DISPATCH_MODE=synthesis registers virtual worker without buddy SID', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
import os
os.environ["HME_DISPATCH_MODE"] = "synthesis"
os.environ["BUDDY_SYSTEM"] = "0"
${_dispatcherImport()}
buddies = disp._list_buddies()
import json
print(json.dumps({
  "mode": disp._DISPATCH_MODE,
  "count": len(buddies),
  "synthesis_sentinel": buddies[0]["sid"] if buddies else None,
  "no_sid_file": buddies[0]["sid_file"] is None if buddies else None,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.mode, 'synthesis', 'env-driven mode resolves');
    assert.strictEqual(parsed.count, 1, 'synthesis mode produces 1 virtual worker');
    assert.strictEqual(parsed.synthesis_sentinel, 'synthesis', 'sentinel SID identifies the synthesis path');
    assert.strictEqual(parsed.no_sid_file, true, 'virtual worker has no SID file (no buddy session)');
  });
});

test('dispatch-mode: BUDDY_SYSTEM=0 + no override → mode=disabled, _list_buddies returns empty', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
import os
os.environ["HME_DISPATCH_MODE"] = ""
os.environ["BUDDY_SYSTEM"] = "0"
${_dispatcherImport()}
buddies = disp._list_buddies()
import json
print(json.dumps({
  "mode": disp._DISPATCH_MODE,
  "count": len(buddies),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.mode, 'disabled', 'BUDDY_SYSTEM=0 + no override = disabled');
    assert.strictEqual(parsed.count, 0, 'disabled mode returns 0 workers');
  });
});

test('enqueue-sentinel: posttooluse_bash skips enqueue when dispatch is disabled', () => {
  // The universal [enqueue: ...] sentinel must NOT create task files
  // when the dispatcher is disabled — without a drainer, queued tasks
  // pile up forever. The hook should observe-and-warn but not write.
  //
  // Test isolation: sandbox PROJECT_ROOT with a custom .env that sets
  // BUDDY_SYSTEM=0 + HME_DISPATCH_MODE=disabled. Inline env-vars don't
  // survive `_safety.sh`'s `source .env` because the latter uses
  // `set -a; source ...` which re-evaluates assignments. Sandboxing
  // PROJECT_ROOT lets us control .env contents independent of
  // production state (which may have HME_DISPATCH_MODE=synthesis set).
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-enqueue-gate-test-'));
  fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'config'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'CLAUDE.md'), '# sandbox\n');
  // Real .env redacted + our overrides
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  let env = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
  env = env.replace(/^PROJECT_ROOT=.*$/m, `PROJECT_ROOT=${sandbox}`);
  env = env.replace(/^BUDDY_SYSTEM=.*$/m, 'BUDDY_SYSTEM=0');
  env = env.replace(/^HME_DISPATCH_MODE=.*$/m, 'HME_DISPATCH_MODE=disabled');
  env = env.replace(/^([A-Z_]+_(?:TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL))=.*$/gm, '$1=REDACTED');
  fs.writeFileSync(path.join(sandbox, '.env'), env);
  // Symlink the helpers / posttooluse / and i/dispatch + i/buddy bins
  // into the sandbox so the hook can find them.
  fs.symlinkSync(
    path.join(repoRoot, 'tools', 'HME', 'hooks', 'helpers'),
    path.join(sandbox, 'tools', 'HME', 'hooks', 'helpers'),
  );
  fs.symlinkSync(
    path.join(repoRoot, 'tools', 'HME', 'hooks', 'posttooluse'),
    path.join(sandbox, 'tools', 'HME', 'hooks', 'posttooluse'),
  );
  fs.mkdirSync(path.join(sandbox, 'i'), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, 'i', 'dispatch'), path.join(sandbox, 'i', 'dispatch'));
  fs.symlinkSync(path.join(repoRoot, 'i', 'buddy'), path.join(sandbox, 'i', 'buddy'));
  try {
    const input = JSON.stringify({
      tool_input: { command: "i/whatever" },
      tool_response: "Done.\n[enqueue: tier=medium text=\"should be skipped\" source=\"test\"]",
    });
    const result = spawnSync('bash', ['-c',
      `PROJECT_ROOT="${sandbox}" \
       bash "${sandbox}/tools/HME/hooks/posttooluse/posttooluse_bash.sh" <<< '${input.replace(/'/g, "'\\''")}'`,
    ], { encoding: 'utf8' });
    // Must surface the seen-but-skipped warning on stderr.
    assert.ok(
      (result.stderr || '').includes('dispatch disabled') &&
      (result.stderr || '').includes('not queued'),
      `expected seen-but-skipped warning; stderr: ${result.stderr}`,
    );
    // Must NOT have created any task files in the sandbox queue.
    const queueDir = path.join(sandbox, 'tmp', 'hme-buddy-queue', 'pending');
    let pending = [];
    if (fs.existsSync(queueDir)) {
      pending = fs.readdirSync(queueDir).filter(f => f.endsWith('.json'));
    }
    assert.strictEqual(pending.length, 0, 'gate must NOT have created any task files');
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
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

test('dispatcher: chain YAML loader parses minimal subset without PyYAML', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.mkdirSync(path.join(sandbox, 'chains'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'chains', 'test-chain.yaml'),
      `name: test-chain\ndescription: a test chain definition for unit coverage\n` +
      `version: 1.0.0\nloop: 2\nloop-delay-random: [60, 120]\non-rate-limit: pause\nskills:\n` +
      `  - echo first\n  - echo second\n  - echo third\n`
    );
    const result = _runPython(sandbox, `
${_dispatcherImport()}
chain = disp._load_chain_yaml("test-chain")
err = disp._validate_chain(chain)
import json
print(json.dumps({
  "name": chain.get("name"),
  "version": chain.get("version"),
  "loop": chain.get("loop"),
  "loop-delay-random": chain.get("loop-delay-random"),
  "on-rate-limit": chain.get("on-rate-limit"),
  "skill_count": len(chain.get("skills", [])),
  "validation_error": err,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.name, 'test-chain');
    assert.strictEqual(parsed.version, '1.0.0');
    assert.strictEqual(parsed.loop, 2);
    assert.deepStrictEqual(parsed['loop-delay-random'], [60, 120]);
    assert.strictEqual(parsed['on-rate-limit'], 'pause');
    assert.strictEqual(parsed.skill_count, 3);
    assert.strictEqual(parsed.validation_error, '');
  });
});

test('dispatcher: cmd_chain runs a minimal echo chain end-to-end', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.mkdirSync(path.join(sandbox, 'chains'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'chains', 'smoke.yaml'),
      `name: smoke\ndescription: smoke test chain for unit coverage harness\n` +
      `version: 1.0.0\nloop: 1\nskills:\n  - echo step1\n  - echo step2\n`
    );
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import argparse, json, os
ns = argparse.Namespace(chain_name="smoke", loop=None, on_rate_limit=None)
rc = disp.cmd_chain(ns)
# Find the produced manifest under FANOUT_ROOT/chain-*/manifest.json
import glob
manifests = glob.glob(str(disp.FANOUT_ROOT / "chain-*" / "manifest.json"))
manifest = json.loads(open(manifests[0]).read()) if manifests else {}
print(json.dumps({
  "rc": rc,
  "manifest_count": len(manifests),
  "iterations_count": len(manifest.get("iterations", [])),
  "first_iter_skill_count": len(manifest.get("iterations", [{}])[0].get("skills", [])) if manifest.get("iterations") else 0,
  "all_skills_done": all(
    s.get("outcome") == "done" for it in manifest.get("iterations", []) for s in it.get("skills", [])
  ),
  "terminated_by": manifest.get("loop", {}).get("terminated_by"),
  "in_progress": manifest.get("in_progress"),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.rc, 0, 'chain must exit 0 when all skills succeed');
    assert.strictEqual(parsed.manifest_count, 1, 'one manifest per chain run');
    assert.strictEqual(parsed.iterations_count, 1, 'loop=1 produces one iteration');
    assert.strictEqual(parsed.first_iter_skill_count, 2, 'two skills ran');
    assert.strictEqual(parsed.all_skills_done, true, 'all skills succeeded');
    assert.strictEqual(parsed.terminated_by, 'loop_complete', 'terminated_by reflects natural completion');
    assert.strictEqual(parsed.in_progress, false, 'manifest finalized with in_progress=false');
  });
});

test('dispatcher: cmd_chain aborts iteration on first failing skill', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.mkdirSync(path.join(sandbox, 'chains'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'chains', 'fail-mid.yaml'),
      `name: fail-mid\ndescription: fail-fast chain for unit coverage harness\n` +
      `version: 1.0.0\nloop: 1\nskills:\n  - echo first\n  - false\n  - echo never-reached\n`
    );
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import argparse, json, glob
ns = argparse.Namespace(chain_name="fail-mid", loop=None, on_rate_limit="fail")
rc = disp.cmd_chain(ns)
manifests = glob.glob(str(disp.FANOUT_ROOT / "chain-*" / "manifest.json"))
manifest = json.loads(open(manifests[0]).read()) if manifests else {}
skills = manifest.get("iterations", [{}])[0].get("skills", [])
print(json.dumps({
  "rc": rc,
  "skills_run": len(skills),
  "outcomes": [s.get("outcome") for s in skills],
  "terminated_by": manifest.get("loop", {}).get("terminated_by"),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.rc, 1, 'chain must exit 1 when a skill fails');
    assert.strictEqual(parsed.skills_run, 2, 'only 2 of 3 skills ran (third skipped after failure)');
    assert.deepStrictEqual(parsed.outcomes, ['done', 'failed'], 'first done, second failed, third never reached');
    assert.ok(parsed.terminated_by.includes('failed'), 'terminated_by reflects skill failure');
  });
});

test('dispatcher: _strip_ansi removes CSI + OSC sequences, preserves text', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
# CSI (color, cursor) + OSC (window title) + plain mix
samples = [
  ("\\x1b[31mred\\x1b[0m text", "red text"),
  ("plain text", "plain text"),
  ("\\x1b[1;33;40mfg+bg\\x1b[m", "fg+bg"),
  ("\\x1b]0;title\\x07after-osc", "after-osc"),
  ("", ""),
]
out = []
for raw, expected in samples:
  stripped = disp._strip_ansi(raw)
  out.append({"in": raw, "out": stripped, "ok": stripped == expected})
print(json.dumps(out))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    for (const r of parsed) {
      assert.strictEqual(r.ok, true, `_strip_ansi("${r.in}") = "${r.out}"`);
    }
  });
});

test('dispatcher: render-error isolation — exception in dispatch produces failed verdict, not crash', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'fake-sid\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'medium\n');
    const result = _runPython(sandbox, `
import os
os.environ["BUDDY_SYSTEM"] = "1"
${_dispatcherImport()}
import argparse, json, os
disp._ensure_dirs()
# Drop a task to claim
(disp.QUEUE_PENDING / "poison.json").write_text(json.dumps({
  "id": "poison", "tier": "easy", "text": "trigger crash"
}))
# Monkey-patch _dispatch_to_buddy to raise mid-dispatch
def _boom(task, claimed_path, buddy, run_id):
  raise RuntimeError("synthetic dispatch crash")
disp._dispatch_to_buddy = _boom
# cmd_drain must NOT raise; should record render_error verdict + continue
ns = argparse.Namespace(loop=False, loop_delay=0)
rc = disp.cmd_drain(ns)
# Outcome: task moved to failed/ (render_error == not done), drain finished cleanly
failed = sorted(os.listdir(disp.QUEUE_FAILED)) if disp.QUEUE_FAILED.exists() else []
print(json.dumps({"rc": rc, "failed_files": failed}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.rc, 0, 'drain returns 0 even when individual task crashes');
    assert.ok(
      parsed.failed_files.some(f => f.startsWith('poison')),
      'crashed task ends up in failed/ (with verdict, not vanished)',
    );
  });
});

test('dispatcher: chain validation enforces description min-length + semver + on-rate-limit enum', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
print(json.dumps({
  "short_desc": disp._validate_chain({"name": "x", "description": "too short", "version": "1.0.0", "skills": ["a"]}),
  "bad_version": disp._validate_chain({"name": "x", "description": "long enough description for routing", "version": "v1.0", "skills": ["a"]}),
  "bad_on_rate_limit": disp._validate_chain({"name": "x", "description": "long enough description for routing", "version": "1.0.0", "skills": ["a"], "on-rate-limit": "retry"}),
  "max_pause_without_cap_mode": disp._validate_chain({"name": "x", "description": "long enough description for routing", "version": "1.0.0", "skills": ["a"], "on-rate-limit": "pause", "max-rate-limit-pause-seconds": 300}),
  "all_valid": disp._validate_chain({"name": "x", "description": "long enough description for routing", "version": "1.0.0", "skills": ["a"], "on-rate-limit": "pause-with-cap", "max-rate-limit-pause-seconds": 300}),
  "semver_with_prerelease": disp._validate_chain({"name": "x", "description": "long enough description for routing", "version": "1.0.0-alpha.1", "skills": ["a"]}),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.ok(parsed.short_desc.includes('20 chars'), 'rejects <20 char description');
    assert.ok(parsed.bad_version.includes('semver'), 'rejects non-semver version');
    assert.ok(parsed.bad_on_rate_limit.includes('on-rate-limit must be'), 'rejects unknown on-rate-limit value');
    assert.ok(parsed.max_pause_without_cap_mode.includes('pause-with-cap'), 'enforces conditional-required: max-pause needs cap mode');
    assert.strictEqual(parsed.all_valid, '', 'fully-valid chain returns empty');
    assert.strictEqual(parsed.semver_with_prerelease, '', 'semver pre-release suffix accepted');
  });
});

test('dispatcher: effort-floor axis is independent of model-floor', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
# Both axes resolve independently via max(item, floor)
print(json.dumps({
  # easy item + medium model-floor + high effort-floor → medium model, high effort
  "easy_item_mixed_floors": [
    disp._effective_tier("easy", "medium"),
    disp._effective_effort("easy", "high"),
  ],
  # hard item + easy model-floor + low effort-floor → hard model, high effort (item wins both)
  "hard_item_low_floors": [
    disp._effective_tier("hard", "easy"),
    disp._effective_effort("hard", "low"),
  ],
  # easy item + low effort-floor → low effort
  "easy_item_low_effort_floor": disp._effective_effort("easy", "low"),
  # bad effort-floor falls back to medium
  "bad_effort_falls_back": disp._effective_effort("medium", "garbage"),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(parsed.easy_item_mixed_floors, ['medium', 'high'], 'model + effort resolved independently');
    assert.deepStrictEqual(parsed.hard_item_low_floors, ['hard', 'high'], 'item wins both axes when above floors');
    assert.strictEqual(parsed.easy_item_low_effort_floor, 'low', 'easy task on low-effort buddy stays low');
    assert.strictEqual(parsed.bad_effort_falls_back, 'medium', 'unknown effort defaults to medium');
  });
});

test('dispatcher: guidance file gets bounded-shaping at cap', () => {
  _withDispatcherSandbox((sandbox) => {
    const big = 'x'.repeat(3000);
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-operator-guidance.md'), big);
    const result = _runPython(sandbox, `
${_dispatcherImport()}
g = disp._read_guidance()
import json
print(json.dumps({
  "len_bytes": len(g.encode("utf-8")),
  "starts_with_trim_marker": g.startswith("[guidance trimmed from start"),
  "tail_intact": g.endswith("x" * 50),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.ok(parsed.len_bytes <= 1100, `guidance must be capped near 1KB; got ${parsed.len_bytes} bytes`);
    assert.strictEqual(parsed.starts_with_trim_marker, true, 'trim annotation present');
    assert.strictEqual(parsed.tail_intact, true, 'newest content (tail) preserved');
  });
});

test('dispatcher: chain validation rejects missing required fields', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
print(json.dumps({
  "missing_skills": disp._validate_chain({"name": "x", "description": "y" * 30, "version": "1.0.0"}),
  "empty_skills": disp._validate_chain({"name": "x", "description": "y" * 30, "version": "1.0.0", "skills": []}),
  "both_delays": disp._validate_chain({"name": "x", "description": "y" * 30, "version": "1.0.0",
    "skills": ["a"], "loop-delay": 60, "loop-delay-random": [10, 20]}),
  "valid": disp._validate_chain({"name": "x", "description": "y" * 30, "version": "1.0.0", "skills": ["a"]}),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.ok(parsed.missing_skills.includes('skills'), 'flags missing skills');
    assert.ok(parsed.empty_skills.includes('non-empty'), 'flags empty skills list');
    assert.ok(parsed.both_delays.includes('mutually exclusive'), 'flags both-delay conflict');
    assert.strictEqual(parsed.valid, '', 'valid chain returns empty error');
  });
});

test('dispatcher: rate-limit detection handles TZ-aware wall-clock form', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json, time
# "resets at 7:50pm (Asia/Tokyo)" — TZ-aware form
rl = disp._detect_rate_limit("rate limit hit. resets at 7:50pm (Asia/Tokyo)", "")
# Reset epoch should be set; specific time depends on now
print(json.dumps({
  "detected": rl is not None and rl["detected"],
  "has_reset": rl is not None and rl.get("reset_epoch") is not None,
  "reset_in_future": rl["reset_epoch"] > time.time() if rl and rl.get("reset_epoch") else False,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.detected, true, 'TZ-aware form must be detected');
    assert.strictEqual(parsed.has_reset, true, 'TZ-aware form must parse a reset epoch');
    assert.strictEqual(parsed.reset_in_future, true, 'reset epoch must be in future');
  });
});

test('dispatcher: _atomic_write produces target with no half-written intermediate', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json, os
disp._ensure_dirs()
target = disp.FANOUT_ROOT / "atomic-test.json"
disp._atomic_write(target, '{"a": 1, "b": 2}')
# The .tmp-<pid> intermediate must be gone after replace
tmp_files = [f for f in target.parent.iterdir() if ".tmp-" in f.name]
content = json.loads(target.read_text())
print(json.dumps({
  "target_exists": target.exists(),
  "tmp_files_remaining": len(tmp_files),
  "content": content,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.target_exists, true, 'target written');
    assert.strictEqual(parsed.tmp_files_remaining, 0, 'no .tmp- intermediates left behind');
    assert.deepStrictEqual(parsed.content, { a: 1, b: 2 }, 'content correct');
  });
});

test('dispatcher: _is_pid_alive correctly distinguishes live vs dead PIDs', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import os, json
my_pid = os.getpid()
print(json.dumps({
  "self_alive": disp._is_pid_alive(my_pid),
  "zero_pid": disp._is_pid_alive(0),
  "negative_pid": disp._is_pid_alive(-1),
  "implausible_pid": disp._is_pid_alive(2**30),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.self_alive, true, 'own PID is alive');
    assert.strictEqual(parsed.zero_pid, false, 'pid=0 is sentinel for "no pid", treat as dead');
    assert.strictEqual(parsed.negative_pid, false, 'negative pid is dead');
    assert.strictEqual(parsed.implausible_pid, false, 'implausible PID is dead');
  });
});

test('dispatcher: rate-limit detection parses reset_time when present', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
# stderr with rate-limit signal + reset-in-N-hours form
rl1 = disp._detect_rate_limit("you've hit your rate limit. resets in 2 hours.", "")
# stderr with reset_time=epoch form
rl2 = disp._detect_rate_limit('rate limit exceeded; "reset_time": 9999999999', "")
# clean stderr — no rate limit
rl3 = disp._detect_rate_limit("ImportError: foo", "")
print(json.dumps({
  "rl1_detected": rl1 is not None and rl1["detected"],
  "rl1_has_reset": rl1 is not None and rl1.get("reset_epoch") is not None,
  "rl2_detected": rl2 is not None and rl2["detected"],
  "rl2_reset": rl2["reset_epoch"] if rl2 else None,
  "rl3_no_match": rl3 is None,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.rl1_detected, true, 'detects "resets in 2 hours" pattern');
    assert.strictEqual(parsed.rl1_has_reset, true, 'parses reset epoch from "in N hours"');
    assert.strictEqual(parsed.rl2_detected, true, 'detects reset_time epoch form');
    assert.strictEqual(parsed.rl2_reset, 9999999999, 'extracts numeric reset epoch');
    assert.strictEqual(parsed.rl3_no_match, true, 'clean stderr returns None');
  });
});

test('dispatcher: retry-archive rotates prior attempt to .retry-N.json on collision', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json, os
disp._ensure_dirs()
# Drop a task to claim
task_path = disp.QUEUE_PENDING / "task-A.json"
task_path.write_text(json.dumps({"id": "task-A", "tier": "easy", "text": "first attempt"}))
# Simulate a first archive (failed)
buddy = {"slot": 1, "floor": "medium", "processing_dir": disp.QUEUE_PROCESSING / "buddy-1"}
buddy["processing_dir"].mkdir(parents=True, exist_ok=True)
import shutil
shutil.move(str(task_path), str(buddy["processing_dir"] / "task-A.json"))
disp._archive_task(buddy["processing_dir"] / "task-A.json", {"outcome": "failed", "rc": 1, "elapsed_s": 1.0, "stdout_tail": "", "stderr_tail": "", "sentinel_seen": False, "effective_tier": "easy", "buddy_slot": 1, "buddy_floor": "medium"})
# Second attempt: re-enqueue same id, claim, archive failed again
task_path.write_text(json.dumps({"id": "task-A", "tier": "easy", "text": "second attempt"}))
shutil.move(str(task_path), str(buddy["processing_dir"] / "task-A.json"))
disp._archive_task(buddy["processing_dir"] / "task-A.json", {"outcome": "failed", "rc": 1, "elapsed_s": 1.0, "stdout_tail": "", "stderr_tail": "", "sentinel_seen": False, "effective_tier": "easy", "buddy_slot": 1, "buddy_floor": "medium"})
failed = sorted(os.listdir(disp.QUEUE_FAILED))
print(json.dumps({"failed_files": failed}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(
      parsed.failed_files,
      ['task-A.json', 'task-A.retry-1.json'],
      'second attempt rotates first to .retry-1.json',
    );
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
