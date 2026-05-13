'use strict';
// Regression: buddy_dispatcher.py Phase 2 logic -- orphan sweep, verdict
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
    PROJECT_ROOT: sandbox,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
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
# E2 item + E3 floor -> E3 (floor wins). Legacy easy/medium/hard accepted.
print(json.dumps({
  "e2_item_e3_floor": disp._effective_tier("E2", "E3"),
  "e4_item_e2_floor": disp._effective_tier("E4", "E2"),
  "e3_item_e3_floor": disp._effective_tier("E3", "E3"),
  "unknown_falls_back": disp._effective_tier("garbage", "E3"),
  "legacy_easy_medium": disp._effective_tier("easy", "medium"),
  "legacy_hard_easy":   disp._effective_tier("hard", "easy"),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.e2_item_e3_floor, 'E3', 'floor wins over lower item tier');
    assert.strictEqual(parsed.e4_item_e2_floor, 'E4', 'item wins over lower floor');
    assert.strictEqual(parsed.e3_item_e3_floor, 'E3', 'equal stays equal');
    assert.strictEqual(parsed.unknown_falls_back, 'E3', 'unknown tier defaults to E3');
    assert.strictEqual(parsed.legacy_easy_medium, 'E3', 'legacy easy/medium translates to E2/E3 max');
    assert.strictEqual(parsed.legacy_hard_easy, 'E4', 'legacy hard/easy translates to E4/E2 max');
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
    assert.ok(verdict.includes('# Buddy fanout verdict -- test-verdict-run'), 'verdict has run-id header');
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

test('dispatch-mode: BUDDY_SYSTEM=0 + no override -> mode=disabled, _list_buddies returns empty', () => {
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
  // when the dispatcher is disabled -- without a drainer, queued tasks
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

test('dispatcher: enqueue produces well-formed task file (legacy hard -> E4)', () => {
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
    assert.strictEqual(parsed.tier, 'E4', 'legacy "hard" should translate to E4 on enqueue');
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

test('dispatcher: render-error isolation -- exception in dispatch produces failed verdict, not crash', () => {
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
# Both axes resolve independently via max(item, floor). E1-E5 vocabulary.
print(json.dumps({
  # E2 item + E3 model-floor + high effort-floor -> E3 model, high effort
  "e2_item_mixed_floors": [
    disp._effective_tier("E2", "E3"),
    disp._effective_effort("E2", "high"),
  ],
  # E4 item + E2 model-floor + low effort-floor -> E4 model, high effort (item wins both)
  "e4_item_low_floors": [
    disp._effective_tier("E4", "E2"),
    disp._effective_effort("E4", "low"),
  ],
  # E2 item + low effort-floor -> low effort
  "e2_item_low_effort_floor": disp._effective_effort("E2", "low"),
  # bad effort-floor falls back to medium
  "bad_effort_falls_back": disp._effective_effort("E3", "garbage"),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(parsed.e2_item_mixed_floors, ['E3', 'high'], 'model + effort resolved independently');
    assert.deepStrictEqual(parsed.e4_item_low_floors, ['E4', 'high'], 'item wins both axes when above floors');
    assert.strictEqual(parsed.e2_item_low_effort_floor, 'low', 'E2 task on low-effort buddy stays low');
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
# "resets at 7:50pm (Asia/Tokyo)" -- TZ-aware form
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
# clean stderr -- no rate limit
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

test('dispatcher: _discover_buddy_sessions finds legacy single-buddy sid (legacy floor translates)', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'fake-sid-1\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'medium\n');
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
print(json.dumps(disp._discover_buddy_sessions(), default=str))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const sessions = JSON.parse(result.stdout.trim());
    assert.strictEqual(sessions.length, 1, 'one legacy buddy expected');
    assert.strictEqual(sessions[0].slot, 1);
    assert.strictEqual(sessions[0].sid, 'fake-sid-1');
    assert.strictEqual(sessions[0].floor, 'E3', 'legacy "medium" floor file translates to E3');
  });
});

test('dispatcher: _discover_buddy_sessions enumerates multi-buddy sids with E1-E5 floors (legacy translates)', () => {
  _withDispatcherSandbox((sandbox) => {
    const tmp = path.join(sandbox, 'tmp');
    // Plant 3 buddies; mix legacy (slot 1) and new (slots 2,3) to verify backward-compat.
    fs.writeFileSync(path.join(tmp, 'hme-buddy-1.sid'), 'sid-cheap\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-1.floor'), 'easy\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-2.sid'), 'sid-mid\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-2.floor'), 'E3\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-3.sid'), 'sid-deep\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-3.floor'), 'E4\n');
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
print(json.dumps(disp._discover_buddy_sessions(), default=str))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const sessions = JSON.parse(result.stdout.trim());
    assert.strictEqual(sessions.length, 3, 'three multi-buddy slots');
    assert.deepStrictEqual(sessions.map((s) => s.slot), [1, 2, 3]);
    assert.deepStrictEqual(sessions.map((s) => s.floor), ['E2', 'E3', 'E4'],
      'legacy easy translates to E2; E3/E4 pass through');
    assert.deepStrictEqual(sessions.map((s) => s.sid),
      ['sid-cheap', 'sid-mid', 'sid-deep']);
  });
});

test('dispatcher: _discover_buddy_sessions returns [] when no sid files', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
${_dispatcherImport()}
import json
print(json.dumps(disp._discover_buddy_sessions(), default=str))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    assert.deepStrictEqual(JSON.parse(result.stdout.trim()), []);
  });
});

test('dispatcher: _buddy_context_used reads usage from synthetic transcript', () => {
  _withDispatcherSandbox((sandbox) => {
    // Build a synthetic transcript at the path the helper expects.
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    const sid = 'test-sid-ctx';
    const transcript = path.join(projDir, `${sid}.jsonl`);
    // Two assistant events; the LATER usage with bigger numbers is the
    // one the helper should pick up (last assistant with usage wins).
    const ev1 = {
      type: 'assistant',
      message: { usage: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 0 } },
    };
    const ev2 = {
      type: 'assistant',
      message: { usage: { input_tokens: 50, cache_creation_input_tokens: 5000, cache_read_input_tokens: 100 } },
    };
    fs.writeFileSync(transcript, JSON.stringify(ev1) + '\n' + JSON.stringify(ev2) + '\n');
    const result = _runPython(sandbox, `
import os
os.environ['HOME'] = '${home}'
os.environ['HME_BUDDY_CTX_WINDOW'] = '10000'
${_dispatcherImport()}
import json
print(json.dumps(disp._buddy_context_used('${sid}'), default=str))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const ctx = JSON.parse(result.stdout.trim());
    assert.strictEqual(ctx.tokens, 50 + 5000 + 100, 'tokens = sum of last assistant usage');
    assert.strictEqual(ctx.ctx_window, 10000, 'window honors HME_BUDDY_CTX_WINDOW env');
    assert.ok(Math.abs(ctx.used_pct - 51.5) < 0.01,
      `used_pct expected ~51.5, got ${ctx.used_pct}`);
    assert.strictEqual(ctx.lines, 2);
  });
});

test('dispatcher: _buddy_context_used returns null when no transcript', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runPython(sandbox, `
import os
os.environ['HOME'] = '${path.join(sandbox, 'no-such-home')}'
${_dispatcherImport()}
import json
print(json.dumps(disp._buddy_context_used('nonexistent-sid'), default=str))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    assert.strictEqual(result.stdout.trim(), 'null');
  });
});

// ---- buddy_init.sh integration tests ----

function _runBuddyInit(sandbox, env) {
  // Run buddy_init.sh with a stubbed `claude` binary on PATH that prints
  // a fake init event and exits 0. The script disowns its subprocesses,
  // so we poll for the sid files for up to 5s after invocation.
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const stubBin = path.join(sandbox, 'stub-bin');
  fs.mkdirSync(stubBin, { recursive: true });
  // Each spawn gets a unique fake sid via $$ (the stub's pid).
  fs.writeFileSync(path.join(stubBin, 'claude'),
    '#!/bin/bash\n' +
    'cat <<EOF\n' +
    '[{"type":"system","subtype":"init","session_id":"fake-sid-$$"}]\n' +
    'EOF\n', { mode: 0o755 });
  const fullEnv = {
    ...env,
    HOME: process.env.HOME,
    PATH: `${stubBin}:${process.env.PATH}`,
    PROJECT_ROOT: sandbox,
    CLAUDE_PROJECT_DIR: sandbox,
  };
  return spawnSync('bash', [path.join(repoRoot, 'tools/HME/hooks/helpers/buddy_init.sh')],
    { env: fullEnv, encoding: 'utf8', timeout: 30000 });
}

function _waitForFiles(sandbox, names, timeoutMs = 5000) {
  const start = Date.now();
  const tmp = path.join(sandbox, 'tmp');
  while (Date.now() - start < timeoutMs) {
    const allPresent = names.every((n) => {
      const p = path.join(tmp, n);
      return fs.existsSync(p) && fs.readFileSync(p, 'utf8').trim().length > 0;
    });
    if (allPresent) return true;
    spawnSync('sleep', ['0.05']);
  }
  return false;
}

test('buddy_init.sh: BUDDY_COUNT=3 + BUDDY_MODEL_FLOORS=auto distributes E2/E3/E4', () => {
  _withDispatcherSandbox((sandbox) => {
    // Provide a minimal .env so the script's .env-fallback paths are happy.
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=3\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '3', BUDDY_MODEL_FLOORS: 'auto',
    });
    if (result.status !== 0) {
      throw new Error(`buddy_init.sh failed: status=${result.status} stderr=${result.stderr}`);
    }
    const sidFiles = ['hme-buddy-1.sid', 'hme-buddy-2.sid', 'hme-buddy-3.sid'];
    assert.ok(_waitForFiles(sandbox, sidFiles, 5000),
      'all 3 sid files should appear within 5s');
    const floors = ['hme-buddy-1.floor', 'hme-buddy-2.floor', 'hme-buddy-3.floor']
      .map((f) => fs.readFileSync(path.join(sandbox, 'tmp', f), 'utf8').trim());
    assert.deepStrictEqual(floors, ['E2', 'E3', 'E4'],
      `floors must be [E2, E3, E4], got [${floors.join(', ')}]`);
  });
});

test('buddy_init.sh: BUDDY_COUNT=1 with auto produces single E2 floor (fully dynamic)', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=1\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '1', BUDDY_MODEL_FLOORS: 'auto',
    });
    if (result.status !== 0) {
      throw new Error(`buddy_init.sh failed: status=${result.status} stderr=${result.stderr}`);
    }
    // count=1 uses legacy filename hme-buddy.sid (back-compat path).
    assert.ok(_waitForFiles(sandbox, ['hme-buddy.sid'], 5000),
      'legacy single-buddy sid file should appear');
    const floor = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'utf8').trim();
    // Floor=E2 lets the buddy handle any tier dynamically (effective = max(item_tier, E2) = item_tier when item_tier>=E2).
    assert.strictEqual(floor, 'E2',
      'count=1 + auto must default to E2 (fully dynamic per task)');
  });
});

test('buddy_init.sh: BUDDY_COUNT=2 with auto produces [E2, E2] (dynamic, no escalation)', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=2\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '2', BUDDY_MODEL_FLOORS: 'auto',
    });
    if (result.status !== 0) {
      throw new Error(`buddy_init.sh failed: status=${result.status} stderr=${result.stderr}`);
    }
    assert.ok(_waitForFiles(sandbox, ['hme-buddy-1.sid', 'hme-buddy-2.sid'], 5000));
    const floors = ['hme-buddy-1.floor', 'hme-buddy-2.floor']
      .map((f) => fs.readFileSync(path.join(sandbox, 'tmp', f), 'utf8').trim());
    assert.deepStrictEqual(floors, ['E2', 'E2'],
      'count<3 + auto must default both slots to E2 for dynamic per-task tier');
  });
});

test('buddy_init.sh: BUDDY_COUNT=4 with auto produces [E2, E3, E4, E2] (specialized + dynamic backfill)', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=4\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '4', BUDDY_MODEL_FLOORS: 'auto',
    });
    if (result.status !== 0) {
      throw new Error(`buddy_init.sh failed: status=${result.status} stderr=${result.stderr}`);
    }
    assert.ok(_waitForFiles(sandbox,
      ['hme-buddy-1.sid', 'hme-buddy-2.sid', 'hme-buddy-3.sid', 'hme-buddy-4.sid'], 5000));
    const floors = ['hme-buddy-1.floor', 'hme-buddy-2.floor', 'hme-buddy-3.floor', 'hme-buddy-4.floor']
      .map((f) => fs.readFileSync(path.join(sandbox, 'tmp', f), 'utf8').trim());
    assert.deepStrictEqual(floors, ['E2', 'E3', 'E4', 'E2'],
      'count>3 + auto: first 3 slots specialized, extras dynamic (E2)');
  });
});

test('buddy_init.sh: explicit BUDDY_MODEL_FLOORS list bypasses auto and translates legacy', () => {
  _withDispatcherSandbox((sandbox) => {
    // Mix legacy and E1-E5 to verify both translate consistently.
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=3\nBUDDY_MODEL_FLOORS=hard,E4,easy\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '3', BUDDY_MODEL_FLOORS: 'hard,E4,easy',
    });
    if (result.status !== 0) {
      throw new Error(`buddy_init.sh failed: status=${result.status} stderr=${result.stderr}`);
    }
    assert.ok(_waitForFiles(sandbox, ['hme-buddy-1.sid', 'hme-buddy-2.sid', 'hme-buddy-3.sid'], 5000));
    const floors = ['hme-buddy-1.floor', 'hme-buddy-2.floor', 'hme-buddy-3.floor']
      .map((f) => fs.readFileSync(path.join(sandbox, 'tmp', f), 'utf8').trim());
    assert.deepStrictEqual(floors, ['E4', 'E4', 'E2'],
      'explicit floor list honored; legacy hard->E4, easy->E2; E4 passes through');
  });
});

// ---- Hand-off paradigm: BUDDY_HANDOFF=1 ----

test('buddy_init.sh: HANDOFF=1 with primary.sid present adopts it (no fresh spawn)', () => {
  _withDispatcherSandbox((sandbox) => {
    const tmp = path.join(sandbox, 'tmp');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-primary.sid'), 'inherited-sid-123\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy-primary.effort_floor'), 'low\n');
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=1\nBUDDY_HANDOFF=1\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '1', BUDDY_HANDOFF: '1',
      BUDDY_MODEL_FLOORS: 'auto',
    });
    if (result.status !== 0) {
      throw new Error(`buddy_init.sh failed: status=${result.status} stderr=${result.stderr}`);
    }
    // No fresh claude spawn -- legacy sid should mirror primary.
    const legacySid = fs.readFileSync(path.join(tmp, 'hme-buddy.sid'), 'utf8').trim();
    assert.strictEqual(legacySid, 'inherited-sid-123',
      'HANDOFF=1 + primary.sid present: legacy sid mirrors the inherited primary, NOT a fresh spawn');
    const legacyFloor = fs.readFileSync(path.join(tmp, 'hme-buddy.floor'), 'utf8').trim();
    assert.strictEqual(legacyFloor, 'E2', 'legacy "easy" primary.floor translates to E2 in mirrored hme-buddy.floor');
  });
});

test('buddy_init.sh: HANDOFF=1 with no primary.sid spawns fresh + records as inaugural primary', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=1\nBUDDY_HANDOFF=1\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '1', BUDDY_HANDOFF: '1',
      BUDDY_MODEL_FLOORS: 'auto',
    });
    if (result.status !== 0) {
      throw new Error(`buddy_init.sh failed: status=${result.status} stderr=${result.stderr}`);
    }
    assert.ok(_waitForFiles(sandbox,
      ['hme-buddy.sid', 'hme-buddy-primary.sid'], 5000),
      'fresh spawn must record both legacy and primary sid files');
    const legacy = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'utf8').trim();
    const primary = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), 'utf8').trim();
    assert.strictEqual(primary, legacy,
      'inaugural primary.sid must equal the freshly-spawned legacy sid');
    // Symmetry rule: inaugural primary path MUST write the full trio
    // (sid + floor + effort_floor). Previously only sid + floor were
    // written, leaving _promote() and inaugural-spawn divergent --
    // _read_primary fell back to "low" effort, so functionally OK but
    // structurally violated the writer-symmetry invariant documented
    // in BUDDY_SYSTEM.md's wisdom section.
    assert.ok(fs.existsSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor')),
      'inaugural primary.floor written');
    assert.ok(fs.existsSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor')),
      'inaugural primary.effort_floor written (writer-symmetry with _promote)');
    const primaryFloor = fs.readFileSync(
      path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'utf8').trim();
    const primaryEffort = fs.readFileSync(
      path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'utf8').trim();
    assert.strictEqual(primaryFloor, 'E2', 'inaugural floor matches BUDDY_MODEL_FLOORS=auto for count=1');
    assert.strictEqual(primaryEffort, 'low', 'effort_floor follows canonical E2->low mapping');
  });
});

function _runHandoff(sandbox, args, env = {}) {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const fullEnv = {
    ...process.env, ...env, PROJECT_ROOT: sandbox, CLAUDE_PROJECT_DIR: sandbox,
  };
  return spawnSync('python3',
    [path.join(repoRoot, 'tools/HME/scripts/buddy_handoff.py'), ...args],
    { env: fullEnv, encoding: 'utf8', timeout: 10000 });
}

test('buddy_handoff.py: status reports primary + ctx % when transcript present', () => {
  _withDispatcherSandbox((sandbox) => {
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    const sid = 'handoff-primary-sid';
    fs.writeFileSync(path.join(projDir, `${sid}.jsonl`),
      JSON.stringify({ type: 'assistant',
        message: { usage: { input_tokens: 100, cache_creation_input_tokens: 9000, cache_read_input_tokens: 0 } } }) + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), sid + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    const result = _runHandoff(sandbox, ['status'], { HOME: home, HME_BUDDY_CTX_WINDOW: '20000' });
    assert.strictEqual(result.status, 0, `handoff status failed: ${result.stderr}`);
    assert.match(result.stdout, /primary: sid=handoff-primary-sid/);
    assert.match(result.stdout, /\[#####.....\]\s+45\.5%/, 'context bar reflects 9100/20000 = 45.5%');
  });
});

test('buddy_handoff.py: retire moves primary to seniors and clears primary pointers', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), 'about-to-retire\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'about-to-retire\n');
    const result = _runHandoff(sandbox, ['retire', '--reason=test_retirement']);
    assert.strictEqual(result.status, 0, `retire failed: ${result.stderr}`);
    // Primary pointers cleared.
    assert.ok(!fs.existsSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid')));
    assert.ok(!fs.existsSync(path.join(sandbox, 'tmp', 'hme-buddy.sid')));
    // Senior file written.
    const seniorFile = path.join(sandbox, 'tmp', 'hme-buddy-seniors', 'about-to-retire.json');
    assert.ok(fs.existsSync(seniorFile), 'senior metadata file must exist');
    const rec = JSON.parse(fs.readFileSync(seniorFile, 'utf8'));
    assert.strictEqual(rec.sid, 'about-to-retire');
    assert.strictEqual(rec.reason, 'test_retirement');
    // Index appended.
    const indexFile = path.join(sandbox, 'tmp', 'hme-buddy-seniors', '_index.jsonl');
    const indexLines = fs.readFileSync(indexFile, 'utf8').trim().split('\n');
    const lastEntry = JSON.parse(indexLines[indexLines.length - 1]);
    assert.strictEqual(lastEntry.sid, 'about-to-retire');
  });
});

test('buddy_handoff.py: auto_retire_check no-op below threshold', () => {
  _withDispatcherSandbox((sandbox) => {
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    const sid = 'low-ctx-sid';
    fs.writeFileSync(path.join(projDir, `${sid}.jsonl`),
      JSON.stringify({ type: 'assistant',
        message: { usage: { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 } } }) + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), sid + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    const result = _runHandoff(sandbox, ['auto_retire_check'],
      { HOME: home, HME_BUDDY_CTX_WINDOW: '20000', BUDDY_RETIRE_PCT: '90' });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /no action/);
    // Primary still present.
    assert.ok(fs.existsSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid')));
  });
});

test('buddy_handoff.py: auto_retire_check fires above threshold', () => {
  _withDispatcherSandbox((sandbox) => {
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    const sid = 'over-threshold-sid';
    fs.writeFileSync(path.join(projDir, `${sid}.jsonl`),
      JSON.stringify({ type: 'assistant',
        message: { usage: { input_tokens: 0, cache_creation_input_tokens: 19000, cache_read_input_tokens: 0 } } }) + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), sid + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), sid + '\n');
    const result = _runHandoff(sandbox, ['auto_retire_check'],
      { HOME: home, HME_BUDDY_CTX_WINDOW: '20000', BUDDY_RETIRE_PCT: '90' });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /AUTO-RETIRED/);
    // Primary must be cleared post-retire.
    assert.ok(!fs.existsSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid')));
    // Senior file written.
    assert.ok(fs.existsSync(path.join(sandbox, 'tmp', 'hme-buddy-seniors', `${sid}.json`)));
  });
});

test('buddy_handoff.py: promote --sid sets primary pointers', () => {
  _withDispatcherSandbox((sandbox) => {
    const result = _runHandoff(sandbox,
      ['promote', '--sid=manual-promo-sid', '--floor=medium', '--effort=low']);
    assert.strictEqual(result.status, 0);
    const primary = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), 'utf8').trim();
    const floor = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'utf8').trim();
    const effort = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'utf8').trim();
    assert.strictEqual(primary, 'manual-promo-sid');
    assert.strictEqual(floor, 'medium');
    assert.strictEqual(effort, 'low');
  });
});

test('buddy_handoff.py: promote mirrors to legacy pointer trio (dispatcher visibility)', () => {
  _withDispatcherSandbox((sandbox) => {
    // Plant a stale legacy pointer to simulate a pre-paradigm carry-over.
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'stale-from-prior-era\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'medium\n');
    const result = _runHandoff(sandbox,
      ['promote', '--sid=fresh-promo', '--floor=hard', '--effort=high']);
    assert.strictEqual(result.status, 0, `promote failed: ${result.stderr}`);
    // Legacy trio must mirror the new primary, not retain the stale value.
    // The dispatcher reads runtime/hme/buddy.sid; if mirroring is missing,
    // status will continue to display 'stale-from-prior-era' until the
    // next SessionStart re-runs buddy_init.sh's mirror.
    const legacySid = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'utf8').trim();
    const legacyFloor = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'utf8').trim();
    const legacyEffort = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy.effort_floor'), 'utf8').trim();
    assert.strictEqual(legacySid, 'fresh-promo',
      'promote must overwrite stale legacy sid so the dispatcher sees the new primary immediately');
    assert.strictEqual(legacyFloor, 'hard', 'legacy floor mirrors promoted floor');
    assert.strictEqual(legacyEffort, 'high', 'legacy effort_floor mirrors promoted effort');
  });
});

test('buddy_handoff.py: consult records call against senior metadata + status surfaces it', () => {
  _withDispatcherSandbox((sandbox) => {
    // Plant a retired senior with the schema _retire() produces.
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    const sid = 'consultable-senior';
    fs.writeFileSync(path.join(seniorsDir, `${sid}.json`), JSON.stringify({
      sid, floor: 'easy', effort_floor: 'low',
      retired_at: Date.now() / 1000,
      retired_at_iso: '2026-04-30T00:00:00Z',
      reason: 'manual', context_at_retire: { tokens: 850000 },
    }));
    // Stub `claude` on PATH so we don't actually spawn a subprocess.
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho "stub-response"\nexit 0\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=' + sid, '--question=is this thing on'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0, `consult failed: ${result.stderr}`);
    // Senior metadata must now carry the consult record.
    const rec = JSON.parse(fs.readFileSync(path.join(seniorsDir, `${sid}.json`), 'utf8'));
    assert.ok(Array.isArray(rec.consults), 'consults array recorded on senior file');
    assert.strictEqual(rec.consults.length, 1, 'one consult appended');
    assert.strictEqual(rec.consults[0].question_excerpt, 'is this thing on',
      'question excerpt captured (<=60 chars)');
    assert.ok(typeof rec.consults[0].ts === 'number', 'consult ts is a numeric epoch');
    // No primary.sid in sandbox -- caller_sid should be null (not crash).
    assert.strictEqual(rec.consults[0].caller_sid, null,
      'caller_sid is null when no primary recorded');
    // status output must surface the consults count + recency suffix.
    const statusResult = _runHandoff(sandbox, ['status']);
    assert.strictEqual(statusResult.status, 0);
    assert.match(statusResult.stdout, /consults=1 last=\d+[smhd]ago/,
      'status surfaces consults count + relative-time-ago for the senior');
  });
});

test('buddy_handoff.py: consult prints role-correct label (primary vs senior vs buddy)', () => {
  // Lock the role-detection logic: primary takes precedence (the active
  // primary is NOT a senior even if a stale senior file with the same sid
  // somehow co-existed); seniors detected via pool membership; unknown
  // sids fall back to neutral "buddy" rather than misleading "primary".
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'a-real-senior.json'),
      JSON.stringify({ sid: 'a-real-senior' }));
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'),
      'the-active-primary\n');
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho ok\nexit 0\n', { mode: 0o755 });
    // Case 1: target IS the active primary -> "consulting primary"
    let r = _runHandoff(sandbox,
      ['consult', '--sid=the-active-primary', '--question=hi'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.match(r.stderr, /consulting primary sid=the-active-primary/,
      'primary role labeled correctly');
    // Case 2: target is in seniors pool -> "consulting senior"
    r = _runHandoff(sandbox,
      ['consult', '--sid=a-real-senior', '--question=hi'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.match(r.stderr, /consulting senior sid=a-real-senior/,
      'senior role labeled correctly');
    // Case 3: unknown sid (neither primary nor in pool) -> "consulting buddy"
    r = _runHandoff(sandbox,
      ['consult', '--sid=who-knows', '--question=hi'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.match(r.stderr, /consulting buddy sid=who-knows/,
      'unknown sid uses neutral "buddy" fallback, not misleading "primary"');
  });
});

test('buddy_handoff.py: consult captures caller_sid from active primary (cross-session forensics)', () => {
  // Forensics-lock: the primary at consult time is recorded as the
  // caller_sid on the senior's record, so 'who's been hammering this
  // senior' is answerable across sessions.
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'target-senior.json'), JSON.stringify({
      sid: 'target-senior', floor: 'easy', effort_floor: 'low',
    }));
    // Active primary in the sandbox -- the caller identity.
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'),
      'caller-primary-sid\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho ok\nexit 0\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=target-senior', '--question=identify yourself'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0, `consult failed: ${result.stderr}`);
    const rec = JSON.parse(fs.readFileSync(path.join(seniorsDir, 'target-senior.json'), 'utf8'));
    assert.strictEqual(rec.consults[0].caller_sid, 'caller-primary-sid',
      'caller_sid is the active primary at consult time');
    // No debug warning expected when caller resolves cleanly.
    assert.doesNotMatch(result.stderr, /caller_sid resolved to None/,
      'no debug warning when primary is recorded');
  });
});

test('buddy_handoff.py: consult emits caller_sid=None debug warning when no primary recorded', () => {
  // Visible-by-default debug surfaces the gap rather than silently
  // recording caller_sid=null. Otherwise consults from cron / manual
  // shells / pre-paradigm sessions would record null without the
  // operator knowing why.
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'orphan-target.json'), JSON.stringify({
      sid: 'orphan-target', floor: 'easy', effort_floor: 'low',
    }));
    // No primary.sid in sandbox -> caller_sid will resolve to None.
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho ok\nexit 0\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=orphan-target', '--question=hi'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0);
    assert.match(result.stderr, /caller_sid resolved to None/,
      'debug line visible when no primary recorded');
  });
});

test('buddy_handoff.py: status shows ctx=missing for primary with purged transcript (Q2 stale signal)', () => {
  // Q2 resolution: _buddy_context_used returns None ONLY when the
  // transcript file is gone. The "transcript exists with no usage"
  // case naturally returns 0-tokens (post-spawn pre-first-turn), so
  // that's already distinguishable as ctx=0.0% via the bar; no
  // separate sentinel needed. The new state to lock is the genuine
  // staleness signal.
  _withDispatcherSandbox((sandbox) => {
    const home = path.join(sandbox, 'fake-home');
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'),
      'no-transcript-sid\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    const r = _runHandoff(sandbox, ['status'], { HOME: home });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /ctx=missing\s+\(transcript purged/,
      'no-transcript-file case shows ctx=missing with stale label');
    assert.doesNotMatch(r.stdout, /ctx=\?/,
      'should not use the old "ctx=?" sentinel -- purged is now distinct');
  });
});

test('buddy_handoff.py: consult to senior over 80% emits loud WARNING; cooldown drops to debug', () => {
  // Q9 resolution: warn-and-proceed at >=80%, with 1h cooldown so
  // repeated consults don't train the operator to ignore the signal.
  _withDispatcherSandbox((sandbox) => {
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    // Synthesize a transcript with usage at 85% of a 20k window.
    const sid = 'over-floor-senior';
    fs.writeFileSync(path.join(projDir, `${sid}.jsonl`),
      JSON.stringify({ type: 'assistant',
        message: { usage: { input_tokens: 0, cache_creation_input_tokens: 17000, cache_read_input_tokens: 0 } } }) + '\n');
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, `${sid}.json`), JSON.stringify({
      sid, floor: 'easy', effort_floor: 'low',
    }));
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho ok\nexit 0\n', { mode: 0o755 });
    // First consult: loud WARNING.
    let r = _runHandoff(sandbox,
      ['consult', '--sid=' + sid, '--question=first'],
      { PATH: `${stubBin}:${process.env.PATH}`,
        HOME: home, HME_BUDDY_CTX_WINDOW: '20000' });
    assert.strictEqual(r.status, 0, `consult failed: ${r.stderr}`);
    assert.match(r.stderr, /WARNING:.*past the pre-compaction floor/,
      'first consult past floor emits loud WARNING');
    // Second consult within cooldown: drops to [debug].
    r = _runHandoff(sandbox,
      ['consult', '--sid=' + sid, '--question=second'],
      { PATH: `${stubBin}:${process.env.PATH}`,
        HOME: home, HME_BUDDY_CTX_WINDOW: '20000' });
    assert.strictEqual(r.status, 0);
    assert.doesNotMatch(r.stderr, /^# WARNING:/m,
      'second consult within cooldown does NOT repeat loud WARNING');
    assert.match(r.stderr, /\[debug\].*past the pre-compaction floor/,
      'second consult drops to [debug] level');
  });
});

test('buddy_handoff.py: archive subcommand moves senior to _archive/ (still callable via consult)', () => {
  // Q8a: archive hides from default status pool but keeps the senior
  // callable via i/consult (which now searches both locations).
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    const sid = 'aging-senior';
    fs.writeFileSync(path.join(seniorsDir, `${sid}.json`), JSON.stringify({
      sid, floor: 'easy', effort_floor: 'low',
      consults: [{ ts: 1, question_excerpt: 'old' }],
    }));
    const result = _runHandoff(sandbox, ['archive', '--sid=' + sid]);
    assert.strictEqual(result.status, 0, `archive failed: ${result.stderr}`);
    // Active pool is empty.
    assert.ok(!fs.existsSync(path.join(seniorsDir, `${sid}.json`)));
    // Archive has the file with full record preserved.
    const archivePath = path.join(seniorsDir, '_archive', `${sid}.json`);
    assert.ok(fs.existsSync(archivePath));
    const rec = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    assert.strictEqual(rec.consults[0].question_excerpt, 'old',
      'historical record retained');
    // Calling archive on a sid not in active pool returns nonzero.
    const missResult = _runHandoff(sandbox, ['archive', '--sid=not-here']);
    assert.notStrictEqual(missResult.status, 0,
      'archive must fail loudly when sid is not in active pool');
  });
});

test('buddy_handoff.py: cmd_consult records to archived senior file (Q8a callable-after-archive)', () => {
  _withDispatcherSandbox((sandbox) => {
    const archiveDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors', '_archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const sid = 'archived-but-callable';
    fs.writeFileSync(path.join(archiveDir, `${sid}.json`), JSON.stringify({
      sid, floor: 'easy', effort_floor: 'low',
    }));
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho ok\nexit 0\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=' + sid, '--question=can you still help'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0,
      `consult to archived senior must succeed: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /not in the senior pool/,
      'consult must NOT warn that an archived senior is unknown');
    // Consult record must accrue to the archived file.
    const rec = JSON.parse(fs.readFileSync(path.join(archiveDir, `${sid}.json`), 'utf8'));
    assert.strictEqual(rec.consults.length, 1,
      'consult logged on archived senior file');
  });
});

test('buddy_handoff.py: cmd_consult lockfile prevents concurrent invocation, expires after 1h', () => {
  // Q7: per-sid lockfile prevents racing claude --resume on same session.
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    const sid = 'busy-target';
    fs.writeFileSync(path.join(seniorsDir, `${sid}.json`), JSON.stringify({
      sid, floor: 'easy', effort_floor: 'low',
    }));
    // Plant a fresh lockfile to simulate an in-flight consult.
    const lockDir = path.join(sandbox, 'tmp', 'hme-consult-lock');
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, `${sid}.lock`), '99999\n');
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho should-not-run\nexit 0\n', { mode: 0o755 });
    let r = _runHandoff(sandbox,
      ['consult', '--sid=' + sid, '--question=hi'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(r.status, 3,
      'consult must refuse with code 3 when fresh lockfile present');
    assert.match(r.stderr, /consult locked/, 'lock-refusal message visible');
    // Make the lock 2 hours stale; consult should reclaim and proceed.
    const staleMtime = (Date.now() / 1000) - 7200;
    fs.utimesSync(path.join(lockDir, `${sid}.lock`), staleMtime, staleMtime);
    r = _runHandoff(sandbox,
      ['consult', '--sid=' + sid, '--question=retry after stale'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(r.status, 0, 'stale lock reclaimed; consult proceeded');
    // Lock file released after successful consult.
    assert.ok(!fs.existsSync(path.join(lockDir, `${sid}.lock`)),
      'lock released after successful consult');
  });
});

test('buddy_handoff.py: promote of a sid in senior pool archives the senior file (no double-existence)', () => {
  // Q6 resolution: _promote() must not leave the same sid as both
  // primary AND senior. Archive instead of refusing keeps workflow
  // unblocked (e.g. operator manually promoting a senior back into
  // service after compaction recovery).
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    const sid = 'returning-buddy';
    fs.writeFileSync(path.join(seniorsDir, `${sid}.json`), JSON.stringify({
      sid, floor: 'easy', effort_floor: 'low', reason: 'test_retire',
      consults: [{ ts: 12345, ts_iso: 'old', question_excerpt: 'historical' }],
    }));
    const result = _runHandoff(sandbox,
      ['promote', '--sid=' + sid, '--floor=easy', '--effort=low']);
    assert.strictEqual(result.status, 0, `promote failed: ${result.stderr}`);
    // Original senior file must be gone.
    assert.ok(!fs.existsSync(path.join(seniorsDir, `${sid}.json`)),
      'senior file moved out of pool root');
    // Archive must contain the historical record (consults preserved).
    const archivePath = path.join(seniorsDir, '_archive', `${sid}.json`);
    assert.ok(fs.existsSync(archivePath), 'archived senior metadata preserved');
    const archived = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    assert.strictEqual(archived.consults[0].question_excerpt, 'historical',
      'consults history retained in archive');
    // Primary trio established.
    const primary = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), 'utf8').trim();
    assert.strictEqual(primary, sid);
  });
});

test('buddy_handoff.py: ensure_primary is idempotent when primary already alive', () => {
  // Option D from BUDDY_SYSTEM.md Q1: lazy-spawn helper. The "already
  // alive" path must short-circuit without invoking buddy_init.sh --
  // calling it from the dispatcher's pre-task path means it fires on
  // every drain; unnecessary spawn-attempts there would be wasteful.
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'),
      'already-alive\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    const result = _runHandoff(sandbox, ['ensure_primary']);
    assert.strictEqual(result.status, 0, `ensure_primary failed: ${result.stderr}`);
    assert.match(result.stdout, /primary already alive: sid=already-alive/,
      'idempotent: existing primary is reported, not respawned');
  });
});

test('buddy_handoff.py: ensure_primary spawns and records new primary when none exists', () => {
  // The "no primary" path: ensure_primary invokes buddy_init.sh which
  // (under HANDOFF=1 fall-through) spawns fresh and records the new sid
  // as the inaugural primary. Polls primary.sid up to --wait seconds.
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=1\nBUDDY_HANDOFF=1\nBUDDY_MODEL_FLOORS=auto\n');
    // Stub claude on PATH so the spawn appears to succeed quickly.
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\n' +
      'cat <<EOF\n' +
      '[{"type":"system","subtype":"init","session_id":"lazy-spawned-$$"}]\n' +
      'EOF\n', { mode: 0o755 });
    const result = _runHandoff(sandbox, ['ensure_primary'],
      { PATH: `${stubBin}:${process.env.PATH}`,
        BUDDY_SYSTEM: '1', BUDDY_HANDOFF: '1', BUDDY_COUNT: '1',
        BUDDY_MODEL_FLOORS: 'auto' });
    assert.strictEqual(result.status, 0,
      `ensure_primary failed: stderr=${result.stderr} stdout=${result.stdout}`);
    assert.match(result.stdout, /spawned primary: sid=lazy-spawned-\d+/,
      'fresh sid recorded as the inaugural primary');
    // Primary pointers must be present after the spawn.
    const primary = fs.readFileSync(
      path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), 'utf8').trim();
    assert.match(primary, /^lazy-spawned-\d+$/);
  });
});

test('buddy_handoff.py: status flags senior as [stale] when transcript JSONL is missing', () => {
  // Claude Code rotates / purges old session transcripts. Without
  // detection, _list_seniors returns dead seniors as if alive and
  // i/consult fails opaquely. Status must surface the stale state.
  _withDispatcherSandbox((sandbox) => {
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    // Senior A has a live transcript; Senior B does not.
    fs.writeFileSync(path.join(projDir, 'live-senior.jsonl'),
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100 } } }) + '\n');
    fs.writeFileSync(path.join(seniorsDir, 'live-senior.json'), JSON.stringify({
      sid: 'live-senior', floor: 'easy', effort_floor: 'low',
      retired_at_iso: '2026-04-30T00:00:00Z', reason: 'test',
    }));
    fs.writeFileSync(path.join(seniorsDir, 'purged-senior.json'), JSON.stringify({
      sid: 'purged-senior', floor: 'easy', effort_floor: 'low',
      retired_at_iso: '2026-04-30T00:00:00Z', reason: 'test',
    }));
    const result = _runHandoff(sandbox, ['status'], { HOME: home });
    assert.strictEqual(result.status, 0);
    // Live senior must NOT be marked stale.
    const liveLine = result.stdout.split('\n').find((l) => l.includes('live-senior'));
    assert.ok(liveLine, 'live senior appears in status');
    assert.doesNotMatch(liveLine, /\[stale/,
      'live senior must not be flagged stale');
    // Purged senior MUST be marked stale.
    const purgedLine = result.stdout.split('\n').find((l) => l.includes('purged-senior'));
    assert.ok(purgedLine, 'purged senior appears in status');
    assert.match(purgedLine, /\[stale: transcript missing\]/,
      'senior with no transcript JSONL flagged as stale');
  });
});

test('buddy_handoff.py: status omits consults suffix for a senior with no consult history', () => {
  // Inverse-case lock: prevents drift where _format_consults starts
  // emitting `consults=0 last=...ago` for never-consulted seniors. The
  // suffix must only appear when there's real activity to surface.
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'never-called-senior.json'), JSON.stringify({
      sid: 'never-called-senior', floor: 'easy', effort_floor: 'low',
      retired_at_iso: '2026-04-30T00:00:00Z', reason: 'manual',
      context_at_retire: { tokens: 700000 },
      // No `consults` key -- matches the schema before the field existed.
    }));
    const result = _runHandoff(sandbox, ['status']);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /sid=never-called-sen/,
      'senior must appear in status listing');
    assert.doesNotMatch(result.stdout, /consults=/,
      'status must NOT show consults= suffix for a senior with no recorded consults');
  });
});

test('buddy_handoff.py: consult to unknown sid does not create a metadata file (no spurious record)', () => {
  _withDispatcherSandbox((sandbox) => {
    // No senior file exists. Consult should warn, invoke claude, and skip
    // the metadata write (we don't fabricate a senior record).
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho "stub-response"\nexit 0\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=nobody-knows-this-sid', '--question=hi'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0);
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    if (fs.existsSync(seniorsDir)) {
      const files = fs.readdirSync(seniorsDir).filter((f) => f.endsWith('.json'));
      assert.deepStrictEqual(files, [],
        'no senior metadata file created for unknown sid');
    }
  });
});

test('buddy_handoff.py: consult history is capped at 50 entries (bounded growth)', () => {
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    const sid = 'busy-senior';
    // Pre-populate with 50 prior consults so the next call should rotate
    // the oldest off rather than grow to 51.
    const prior = [];
    for (let i = 0; i < 50; i += 1) {
      prior.push({ ts: 1000 + i, ts_iso: 'old', question_excerpt: `q${i}` });
    }
    fs.writeFileSync(path.join(seniorsDir, `${sid}.json`), JSON.stringify({
      sid, floor: 'easy', effort_floor: 'low', consults: prior,
    }));
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho ok\nexit 0\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=' + sid, '--question=will this push past the cap'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0);
    const rec = JSON.parse(fs.readFileSync(path.join(seniorsDir, `${sid}.json`), 'utf8'));
    assert.strictEqual(rec.consults.length, 50, 'consults array capped at 50');
    // Oldest entry must have rotated off -- q0 is gone, q1 is now first.
    assert.strictEqual(rec.consults[0].question_excerpt, 'q1',
      'oldest consult rotated off when cap reached');
    assert.strictEqual(rec.consults[49].question_excerpt, 'will this push past the cap',
      'newest consult appended at end');
  });
});

test('buddy_init.sh: HANDOFF=1 + no primary.sid + stale legacy.sid spawns fresh anyway', () => {
  // Regression: previously, a stale runtime/hme/buddy.sid from a pre-paradigm
  // session wedged the inaugural spawn -- _spawn_buddy short-circuited on
  // the existing legacy file (line 159 guard), so no fresh buddy was
  // spawned and no primary.sid was recorded. State stayed wedged across
  // SessionStarts. The fall-through path now clears stale legacy pointers
  // before invoking _spawn_buddy when HANDOFF=1 + no primary.sid.
  _withDispatcherSandbox((sandbox) => {
    const tmp = path.join(sandbox, 'tmp');
    // Stale legacy from before the paradigm shipped -- would short-circuit
    // _spawn_buddy under the buggy code path.
    fs.writeFileSync(path.join(tmp, 'hme-buddy.sid'), 'stale-pre-paradigm-buddy\n');
    fs.writeFileSync(path.join(tmp, 'hme-buddy.floor'), 'medium\n');
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=1\nBUDDY_HANDOFF=1\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '1', BUDDY_HANDOFF: '1',
      BUDDY_MODEL_FLOORS: 'auto',
    });
    assert.strictEqual(result.status, 0, `buddy_init.sh failed: ${result.stderr}`);
    // Wait for the disowned spawn to land its sid file. The new sid must
    // overwrite the stale one -- match `fake-sid-<pid>` from the stub.
    assert.ok(_waitForFiles(sandbox, ['hme-buddy.sid', 'hme-buddy-primary.sid'], 5000),
      'fresh inaugural spawn must record both legacy and primary sid files');
    const legacy = fs.readFileSync(path.join(tmp, 'hme-buddy.sid'), 'utf8').trim();
    const primary = fs.readFileSync(path.join(tmp, 'hme-buddy-primary.sid'), 'utf8').trim();
    assert.notStrictEqual(legacy, 'stale-pre-paradigm-buddy',
      'stale legacy sid must NOT survive the fall-through spawn');
    assert.match(legacy, /^fake-sid-\d+$/, 'legacy sid is the freshly-spawned stub sid');
    assert.strictEqual(primary, legacy,
      'inaugural primary.sid equals the freshly-spawned legacy sid');
  });
});

test('buddy_init.sh: BUDDY_COUNT=3 + HANDOFF=1 forces count=1 (multi-buddy mutually exclusive with handoff)', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=3\nBUDDY_HANDOFF=1\nBUDDY_MODEL_FLOORS=auto\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '3', BUDDY_HANDOFF: '1',
      BUDDY_MODEL_FLOORS: 'auto',
    });
    assert.strictEqual(result.status, 0,
      `buddy_init.sh failed: stderr=${result.stderr}`);
    // No primary present + handoff=1 -> fall through to spawn ONE fresh,
    // not three. The hme-buddy-1.sid / -2.sid / -3.sid multi-buddy paths
    // must NOT be created.
    assert.ok(_waitForFiles(sandbox, ['hme-buddy.sid'], 5000),
      'inaugural primary spawned in single-buddy back-compat path');
    const tmp = path.join(sandbox, 'tmp');
    const multiSlots = fs.readdirSync(tmp)
      .filter((f) => /^hme-buddy-\d+\.sid$/.test(f));
    assert.deepStrictEqual(multiSlots, [],
      `HANDOFF=1 must force count=1; got multi-buddy slots: ${multiSlots.join(', ')}`);
  });
});

test('buddy_handoff.py: consult auto-extracts [[KB-CRYSTALLIZE]] blocks and calls i/learn', () => {
  // Heavy version of KB crystallization (per 0e7fbf4d's Section B).
  // The directive is prepended to every consult prompt; if the senior
  // emits structured [[KB-CRYSTALLIZE]] blocks, cmd_consult extracts
  // them and calls i/learn add for each. Stub i/learn under the
  // sandbox PROJECT_ROOT so we can verify the invocation args without
  // touching the real KB.
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'crystal-senior.json'), JSON.stringify({
      sid: 'crystal-senior', floor: 'easy', effort_floor: 'low',
    }));
    // Plant a shim at <sandbox>/i/learn that records its argv.
    const iDir = path.join(sandbox, 'i');
    fs.mkdirSync(iDir, { recursive: true });
    const learnShim = path.join(iDir, 'learn');
    fs.writeFileSync(learnShim,
      '#!/usr/bin/env bash\n' +
      'log="$PROJECT_ROOT/tmp/test-learn-log.txt"\n' +
      'printf "%s\\n" "$*" >> "$log"\n' +
      'exit 0\n',
      { mode: 0o755 });
    // Stub claude that emits a structured crystallize block + main reply.
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\n' +
      'cat <<\'EOF\'\n' +
      'Main answer: looks fine.\n' +
      '\n' +
      '[[KB-CRYSTALLIZE]]\n' +
      'title: Buddy paradigm KB crystallization heavy version\n' +
      'category: architectural\n' +
      'content: Consult responses can emit structured blocks that the parent auto-extracts and persists via i/learn, converting fragile transcript wisdom into durable KB.\n' +
      '[[/KB-CRYSTALLIZE]]\n' +
      'EOF\n',
      { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=crystal-senior', '--question=audit'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0, `consult failed: ${result.stderr}`);
    // The shim should have been invoked once with the extracted block's args.
    const learnLog = path.join(sandbox, 'tmp', 'test-learn-log.txt');
    assert.ok(fs.existsSync(learnLog),
      'i/learn shim should have been invoked with the extracted block');
    const logContent = fs.readFileSync(learnLog, 'utf8');
    assert.match(logContent, /title=Buddy paradigm KB crystallization heavy version/,
      'i/learn called with the title from the extracted block');
    assert.match(logContent, /category=architectural/,
      'i/learn called with the category from the extracted block');
    assert.match(logContent, /content=Consult responses can emit structured blocks/,
      'i/learn called with the content from the extracted block');
    // Stderr should announce the crystallization.
    assert.match(result.stderr, /# crystallized: \[architectural\]/,
      'stderr surfaces the crystallization with category prefix');
    // When heavy crystallization fired, the legacy nudge should NOT
    // also fire (avoids double-prompting the operator).
    assert.doesNotMatch(result.stderr, /finding-shaped marker/,
      'legacy light-nudge skipped when heavy crystallization succeeded');
  });
});

test('buddy_handoff.py: consult prepends KB-CRYSTALLIZE directive to the question', () => {
  // The directive must arrive at the senior so they know to emit
  // structured blocks. Stub claude to echo back its prompt arg; the
  // test then asserts the directive prefix is present in what the
  // senior received.
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'echo-target.json'), JSON.stringify({
      sid: 'echo-target', floor: 'easy', effort_floor: 'low',
    }));
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\n' +
      '# Find the -p arg and echo it back so the test can grep for the directive.\n' +
      'while [ "$#" -gt 0 ]; do\n' +
      '  if [ "$1" = "-p" ]; then echo "$2"; break; fi\n' +
      '  shift\n' +
      'done\n',
      { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=echo-target', '--question=this-is-the-real-question'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /FRAMEWORK DIRECTIVE -- KB CRYSTALLIZATION/,
      'directive prefix present in the prompt sent to senior');
    assert.match(result.stdout, /\[\[KB-CRYSTALLIZE\]\]/,
      'directive includes the canonical block markers');
    assert.match(result.stdout, /this-is-the-real-question/,
      'original question still present after the directive prefix');
  });
});

test('buddy_handoff.py: consult response with finding-markers triggers KB-crystallization nudge', () => {
  // Section B from 0e7fbf4d's deep architectural review: senior wisdom
  // is fragile (transcript compaction wipes it); HME's KB is durable.
  // The light-version integration emits a stderr nudge when consult
  // responses contain finding-shaped vocabulary (tier-1, bug,
  // should-fix, architectural, blocker, RESOLVED).
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'finder-senior.json'), JSON.stringify({
      sid: 'finder-senior', floor: 'easy', effort_floor: 'low',
    }));
    // Stub claude that emits a finding-shaped response.
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\n' +
      'cat <<EOF\n' +
      'tier-1: race condition in _spawn_buddy short-circuit\n' +
      'should-fix: lockfile path resolution edge case\n' +
      'EOF\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=finder-senior', '--question=audit'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0, `consult failed: ${result.stderr}`);
    assert.match(result.stderr, /finding-shaped marker\(s\)/,
      'nudge fires when response contains finding markers');
    assert.match(result.stderr, /tier-1.*should-fix|should-fix.*tier-1/,
      'nudge enumerates which marker types matched');
    assert.match(result.stderr, /i\/learn/,
      'nudge points at the i/learn entry point');
  });
});

test('buddy_handoff.py: consult response without finding-markers stays silent (no nudge noise)', () => {
  // Inverse-case lock: routine consults without findings must NOT
  // emit a nudge. Otherwise the nudge becomes Goodhart-bait -- the
  // detector training the agent that consult-noise satisfies it.
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'quiet-senior.json'), JSON.stringify({
      sid: 'quiet-senior', floor: 'easy', effort_floor: 'low',
    }));
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho "Yeah, that approach makes sense to me."\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=quiet-senior', '--question=ratify'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /finding-shaped marker/,
      'no nudge for routine acknowledgment-shaped responses');
  });
});

test('buddy_handoff.py: consult emits buddy_consult activity event (HME integration)', () => {
  // The consult cadence needs to be visible to the activity bridge so
  // analytics, alerting, and cross-session forensics can see usage
  // patterns. Without this emit, consults are invisible to the rest of
  // HME and only surface in the senior's metadata file (which a
  // future archive or compaction can hide).
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'event-target.json'), JSON.stringify({
      sid: 'event-target', floor: 'easy', effort_floor: 'low',
    }));
    // Stub emit.py to log every invocation.
    const shimDir = path.join(sandbox, 'tools/HME/activity');
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(path.join(shimDir, 'emit.py'),
      '#!/usr/bin/env python3\nimport sys, os, json\n' +
      'log = os.path.join(os.environ.get("PROJECT_ROOT", "."), "tmp", "test-emit-log.jsonl")\n' +
      'with open(log, "a") as f: f.write(json.dumps({"argv": sys.argv[1:]}) + "\\n")\n',
      { mode: 0o755 });
    // Stub claude on PATH so the consult itself "succeeds".
    const stubBin = path.join(sandbox, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'),
      '#!/bin/bash\necho ok\nexit 0\n', { mode: 0o755 });
    const result = _runHandoff(sandbox,
      ['consult', '--sid=event-target', '--question=ping'],
      { PATH: `${stubBin}:${process.env.PATH}` });
    assert.strictEqual(result.status, 0, `consult failed: ${result.stderr}`);
    const logFile = path.join(sandbox, 'tmp', 'test-emit-log.jsonl');
    assert.ok(fs.existsSync(logFile),
      'activity emit shim should have logged the consult event');
    const entries = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const consultEvent = entries.find((e) => e.argv.some((a) => a === '--event=buddy_consult'));
    assert.ok(consultEvent,
      `expected buddy_consult event; got entries=${JSON.stringify(entries)}`);
    assert.ok(consultEvent.argv.some((a) => a === '--sid=event-target'),
      'consult event must include the target sid');
    assert.ok(consultEvent.argv.some((a) => a === '--role=senior'),
      'consult event must include the role label');
    assert.ok(consultEvent.argv.some((a) => a === '--rc=0'),
      'consult event must include the subprocess exit code');
  });
});

test('buddy_handoff.py: retire emits buddy_handoff_retire activity event', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), 'event-test-sid\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    // Stub the activity emit script so the test doesn't depend on
    // running infrastructure. Replace tools/HME/activity/emit.py with a
    // shim that records its argv to tmp/test-emit-log.
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const realEmit = path.join(repoRoot, 'tools/HME/activity/emit.py');
    if (fs.existsSync(realEmit)) {
      // Drop a shim INTO the sandbox layout so the script's
      // PROJECT_ROOT/tools path resolves to the shim.
      const shimDir = path.join(sandbox, 'tools/HME/activity');
      fs.mkdirSync(shimDir, { recursive: true });
      const shim = path.join(shimDir, 'emit.py');
      fs.writeFileSync(shim,
        '#!/usr/bin/env python3\nimport sys, os, json, time\n' +
        'log = os.path.join(os.environ.get("PROJECT_ROOT", "."), "tmp", "test-emit-log.jsonl")\n' +
        'with open(log, "a") as f: f.write(json.dumps({"argv": sys.argv[1:]}) + "\\n")\n',
        { mode: 0o755 });
    }
    const result = _runHandoff(sandbox, ['retire', '--reason=test_evt']);
    assert.strictEqual(result.status, 0);
    const logFile = path.join(sandbox, 'tmp', 'test-emit-log.jsonl');
    assert.ok(fs.existsSync(logFile), 'activity emit shim should have logged the retire event');
    const entries = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const retireEvent = entries.find((e) => e.argv.some((a) => a === '--event=buddy_handoff_retire'));
    assert.ok(retireEvent, `expected buddy_handoff_retire event; got entries=${JSON.stringify(entries)}`);
    assert.ok(retireEvent.argv.some((a) => a === '--sid=event-test-sid'),
      'event must include the retired sid');
    assert.ok(retireEvent.argv.some((a) => a === '--reason=test_evt'),
      'event must include the reason');
    // The context_at_retire payload is a dict; _emit_activity must
    // JSON-encode it (not Python-repr it) so it round-trips through
    // emit.py's --key=value scalar parser as parseable JSON later.
    const ctxArg = retireEvent.argv.find((a) => a.startsWith('--context_at_retire='));
    if (ctxArg !== undefined) {
      const ctxValue = ctxArg.slice('--context_at_retire='.length);
      // Either valid JSON (dict serialized correctly) OR empty (transcript
      // not present in the sandbox so ctx is null and the field was skipped).
      assert.doesNotThrow(() => JSON.parse(ctxValue),
        `context_at_retire must be valid JSON, got: ${ctxValue}`);
    }
  });
});

test('buddy_init.sh: SessionStart auto-retires over-threshold primary then spawns fresh', () => {
  _withDispatcherSandbox((sandbox) => {
    // Plant a primary whose transcript is over 90%.
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    const oldSid = 'incumbent-over-threshold';
    fs.writeFileSync(path.join(projDir, `${oldSid}.jsonl`),
      JSON.stringify({ type: 'assistant',
        message: { usage: { input_tokens: 0, cache_creation_input_tokens: 950000, cache_read_input_tokens: 0 } } }) + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), oldSid + '\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.floor'), 'easy\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.effort_floor'), 'low\n');
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=1\nBUDDY_COUNT=1\nBUDDY_HANDOFF=1\nBUDDY_RETIRE_PCT=90\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '1', BUDDY_COUNT: '1', BUDDY_HANDOFF: '1',
      BUDDY_RETIRE_PCT: '90', HOME: home,
    });
    assert.strictEqual(result.status, 0,
      `buddy_init.sh failed: stderr=${result.stderr}`);
    // Auto-retire fires synchronously inside buddy_init.sh, so the
    // senior file should already be present by the time the script
    // returns. The fresh spawn happens async (disowned), so we wait.
    const seniorFile = path.join(sandbox, 'tmp', 'hme-buddy-seniors',
      `${oldSid}.json`);
    assert.ok(fs.existsSync(seniorFile),
      `auto_retire should have moved ${oldSid} to seniors/ before fresh spawn`);
    const rec = JSON.parse(fs.readFileSync(seniorFile, 'utf8'));
    assert.strictEqual(rec.sid, oldSid);
    assert.match(rec.reason, /^auto_retire_at_/);
    // Fresh primary must replace the retired one within 5s.
    assert.ok(_waitForFiles(sandbox, ['hme-buddy.sid', 'hme-buddy-primary.sid'], 5000),
      'fresh primary must spawn and record itself after auto-retire');
    const newSid = fs.readFileSync(path.join(sandbox, 'tmp', 'hme-buddy-primary.sid'), 'utf8').trim();
    assert.notStrictEqual(newSid, oldSid,
      'new primary sid must differ from the retired sid');
  });
});

test('dispatcher: HME_DISPATCH_SYNTHESIS_TIERS=easy routes easy tasks to synthesis pseudo', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'real-buddy-sid\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'easy\n');
    const result = _runPython(sandbox, `
import os
os.environ['BUDDY_SYSTEM'] = '1'
os.environ['HME_DISPATCH_MODE'] = 'claude-resume'
os.environ['HME_DISPATCH_SYNTHESIS_TIERS'] = 'easy'
${_dispatcherImport()}
import json
buddies = disp._list_buddies()
easy_pick = disp._pick_buddy_for_task({'tier': 'easy'}, buddies, set())
medium_pick = disp._pick_buddy_for_task({'tier': 'medium'}, buddies, set())
hard_pick = disp._pick_buddy_for_task({'tier': 'hard'}, buddies, set())
print(json.dumps({
  'has_synthesis_in_buddies': any(b.get('sid') == 'synthesis' for b in buddies),
  'easy': easy_pick.get('sid') if easy_pick else None,
  'medium': medium_pick.get('sid') if medium_pick else None,
  'hard': hard_pick.get('sid') if hard_pick else None,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.has_synthesis_in_buddies, true,
      'with TIERS=easy set, synthesis pseudo must be in the buddy list alongside real buddy');
    assert.strictEqual(parsed.easy, 'synthesis',
      'easy task must route to synthesis when easy is in TIERS');
    assert.strictEqual(parsed.medium, 'real-buddy-sid',
      'medium task must route to real buddy (NOT synthesis)');
    assert.strictEqual(parsed.hard, 'real-buddy-sid',
      'hard task must route to real buddy (NOT synthesis)');
  });
});

test('dispatcher: empty HME_DISPATCH_SYNTHESIS_TIERS = synthesis pseudo absent', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'real-buddy-sid\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'easy\n');
    const result = _runPython(sandbox, `
import os
os.environ['BUDDY_SYSTEM'] = '1'
os.environ['HME_DISPATCH_MODE'] = 'claude-resume'
os.environ['HME_DISPATCH_SYNTHESIS_TIERS'] = ''
${_dispatcherImport()}
import json
buddies = disp._list_buddies()
print(json.dumps({
  'count': len(buddies),
  'has_synthesis': any(b.get('sid') == 'synthesis' for b in buddies),
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.has_synthesis, false,
      'no per-tier override = synthesis pseudo absent (legacy behavior preserved)');
    assert.strictEqual(parsed.count, 1, 'only the real buddy is registered');
  });
});

test('dispatcher: HME_DISPATCH_MODE=synthesis still routes everything through synthesis (back-compat)', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'real-buddy-sid\n');
    const result = _runPython(sandbox, `
import os
os.environ['BUDDY_SYSTEM'] = '1'
os.environ['HME_DISPATCH_MODE'] = 'synthesis'
${_dispatcherImport()}
import json
buddies = disp._list_buddies()
hard_pick = disp._pick_buddy_for_task({'tier': 'hard'}, buddies, set())
print(json.dumps({
  'count': len(buddies),
  'hard': hard_pick.get('sid') if hard_pick else None,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.count, 1, 'pure-synthesis mode lists only synthesis pseudo');
    assert.strictEqual(parsed.hard, 'synthesis',
      'pure-synthesis mode routes hard tasks through synthesis (back-compat)');
  });
});

test('dispatcher: synthesis-tier task falls back to real buddy when synthesis is busy', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.sid'), 'real-buddy-sid\n');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-buddy.floor'), 'easy\n');
    const result = _runPython(sandbox, `
import os
os.environ['BUDDY_SYSTEM'] = '1'
os.environ['HME_DISPATCH_MODE'] = 'claude-resume'
os.environ['HME_DISPATCH_SYNTHESIS_TIERS'] = 'easy'
${_dispatcherImport()}
import json
buddies = disp._list_buddies()
# Mark synthesis (slot=0) busy.
busy = {0}
pick = disp._pick_buddy_for_task({'tier': 'easy'}, buddies, busy)
print(json.dumps({'pick': pick.get('sid') if pick else None}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.pick, 'real-buddy-sid',
      'when synthesis is busy, easy task falls back to the real buddy');
  });
});

test('dispatcher: status surfaces senior pool when BUDDY_HANDOFF=1', () => {
  _withDispatcherSandbox((sandbox) => {
    const seniorsDir = path.join(sandbox, 'tmp', 'hme-buddy-seniors');
    fs.mkdirSync(seniorsDir, { recursive: true });
    fs.writeFileSync(path.join(seniorsDir, 'retired-1.json'), JSON.stringify({
      sid: 'retired-1', retired_at: 1000, retired_at_iso: '2026-04-30T12:00:00Z',
      reason: 'auto_retire_at_91.0%',
      context_at_retire: { tokens: 910000, ctx_window: 1000000, used_pct: 91.0 },
    }, null, 2));
    fs.writeFileSync(path.join(seniorsDir, 'retired-2.json'), JSON.stringify({
      sid: 'retired-2', retired_at: 2000, retired_at_iso: '2026-04-30T13:00:00Z',
      reason: 'manual',
      context_at_retire: { tokens: 850000, ctx_window: 1000000, used_pct: 85.0 },
    }, null, 2));
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const result = spawnSync('python3',
      [path.join(repoRoot, 'tools/HME/scripts/buddy_dispatcher.py'), 'status'],
      { env: { ...process.env, PROJECT_ROOT: sandbox, BUDDY_HANDOFF: '1' },
        encoding: 'utf8', timeout: 10000 });
    assert.strictEqual(result.status, 0, `status failed: ${result.stderr}`);
    assert.match(result.stdout, /seniors \(hand-off\): 2 retired/);
    assert.match(result.stdout, /senior sid=retired-1\.\.\. retired=2026-04-30T12:00:00Z/);
    assert.match(result.stdout, /senior sid=retired-2\.\.\. retired=2026-04-30T13:00:00Z/);
  });
});

test('buddy_init.sh: BUDDY_SYSTEM=0 is a no-op (no sid files, no claude invocation)', () => {
  _withDispatcherSandbox((sandbox) => {
    fs.writeFileSync(path.join(sandbox, '.env'),
      'BUDDY_SYSTEM=0\nBUDDY_COUNT=3\n');
    const result = _runBuddyInit(sandbox, {
      BUDDY_SYSTEM: '0', BUDDY_COUNT: '3',
    });
    assert.strictEqual(result.status, 0, 'should exit 0 cleanly');
    // Give any disowned process time to settle (none should fire).
    spawnSync('sleep', ['0.5']);
    const sidFiles = fs.readdirSync(path.join(sandbox, 'tmp'))
      .filter((f) => f.startsWith('hme-buddy') && f.endsWith('.sid'));
    assert.deepStrictEqual(sidFiles, [], 'no buddy sid files when BUDDY_SYSTEM=0');
  });
});

test('dispatcher: _buddy_context_used handles transcript with no usage events', () => {
  _withDispatcherSandbox((sandbox) => {
    const home = path.join(sandbox, 'fake-home');
    const cwdSlug = '-' + sandbox.replace(/^\//, '').replace(/\//g, '-');
    const projDir = path.join(home, '.claude', 'projects', cwdSlug);
    fs.mkdirSync(projDir, { recursive: true });
    const sid = 'no-usage-sid';
    const transcript = path.join(projDir, `${sid}.jsonl`);
    // Assistant event with no usage block.
    fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: {} }) + '\n');
    const result = _runPython(sandbox, `
import os
os.environ['HOME'] = '${home}'
${_dispatcherImport()}
import json
print(json.dumps(disp._buddy_context_used('${sid}'), default=str))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const ctx = JSON.parse(result.stdout.trim());
    assert.strictEqual(ctx.tokens, 0, 'tokens = 0 when no usage data found');
    assert.strictEqual(ctx.used_pct, 0.0);
  });
});
