'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

test('UserPromptSubmit hook has no inline Python bodies', () => {
  const script = path.join(repoRoot, 'tools', 'HME', 'hooks', 'lifecycle', 'userpromptsubmit.sh');
  const text = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(text, /python3\s+-c\b/);
  assert.doesNotMatch(text, /python3\s+-\b/);
  assert.doesNotMatch(text, /<<'PY/);
  assert.match(text, /userpromptsubmit_helper\.py/);
});

test('UserPromptSubmit surfaces pre-existing autocommit fail flag before retry can clear it', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-autocommit-lifesaver-'));
  try {
    fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'doc', 'templates'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'hooks'), { recursive: true });
    fs.symlinkSync(
      path.join(repoRoot, 'tools', 'HME', 'hooks', 'helpers'),
      path.join(sandbox, 'tools', 'HME', 'hooks', 'helpers'),
    );
    fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'KB'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'tools', 'HME', 'scripts', 'service_registry.py'),
      [
        '#!/usr/bin/env python3',
        'import sys',
        'cmd = sys.argv[1] if len(sys.argv) > 1 else ""',
        'if cmd == "port": print("3210")',
        'elif cmd == "url": print("http://127.0.0.1:3210")',
        'else: print("")',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(sandbox, 'tools', 'HME', 'KB', 'todos.json'),
      JSON.stringify([{ id: 0, _meta: { max_id: 0, updated_ts: 0 } }]),
    );
    fs.writeFileSync(path.join(sandbox, 'doc', 'templates', 'TODO.md'), '# TODO\n');
    fs.writeFileSync(path.join(sandbox, 'src', 'seed.txt'), 'seed\n');
    git(['init', '--quiet'], sandbox);
    git(['config', 'user.email', 'test@example.invalid'], sandbox);
    git(['config', 'user.name', 'HME Test'], sandbox);
    git(['add', 'src/seed.txt'], sandbox);
    git(['commit', '--quiet', '-m', 'initial'], sandbox);
    fs.writeFileSync(
      path.join(sandbox, 'tools', 'HME', 'runtime', 'autocommit.fail'),
      '[2026-05-15T00:00:00Z] [test] synthetic failure\n',
    );

    const script = path.join(repoRoot, 'tools', 'HME', 'hooks', 'lifecycle', 'userpromptsubmit.sh');
    const result = spawnSync('bash', [script], {
      cwd: repoRoot,
      input: JSON.stringify({ user_prompt: 'test prompt' }),
      encoding: 'utf8',
      env: {
        ...process.env,
        PROJECT_ROOT: sandbox,
        HME_METRICS_DIR: path.join(sandbox, 'tools', 'HME', 'runtime', 'metrics'),
        HME_CURL_STREAK_WARN: '3',
        PYTHONPATH: path.join(repoRoot, 'tools', 'HME', 'service'),
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /LIFESAVER - AUTOCOMMIT FAILED/);
    assert.match(result.stdout, /synthetic failure/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('autocommit entrypoints enqueue through the shared single-owner helper', () => {
  const helper = fs.readFileSync(path.join(repoRoot, 'tools/HME/hooks/helpers/_autocommit.sh'), 'utf8');
  const stop = fs.readFileSync(path.join(repoRoot, 'tools/HME/hooks/lifecycle/stop/autocommit.sh'), 'utf8');
  const direct = fs.readFileSync(path.join(repoRoot, 'tools/HME/hooks/direct/autocommit-direct.sh'), 'utf8');
  const middleware = fs.readFileSync(path.join(repoRoot, 'tools/HME/proxy/middleware/21_proxy_autocommit.js'), 'utf8');
  assert.match(helper, /_ac_queue_request\(\)/);
  assert.match(helper, /_ac_run_owner_once\(\)/);
  assert.match(stop, /_ac_enqueue_commit stop\.sh/);
  assert.doesNotMatch(stop, /_ac_do_commit stop\.sh/);
  assert.match(direct, /_ac_enqueue_commit "direct-\$\{1:-unknown\}"/);
  assert.doesNotMatch(direct, /_ac_do_commit "direct-/);
  assert.match(middleware, /_enqueueViaHelper/);
  assert.doesNotMatch(middleware, /function _attemptCommit/);
  assert.doesNotMatch(middleware, /spawnSync\('flock'/);
});

test('autocommit queue drains multiple callers through one owner pass', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-autocommit-queue-'));
  try {
    fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, '.git'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'bin'), { recursive: true });
    const fakeGit = path.join(sandbox, 'bin', 'git');
    fs.writeFileSync(fakeGit, [
      '#!/usr/bin/env bash',
      'if [ "$1" = "-C" ]; then shift 2; fi',
      'case "$1" in',
      '  add|commit|diff|status) exit 0 ;;',
      '  write-tree) echo 1111111111111111111111111111111111111111; exit 0 ;;',
      '  rev-parse) echo testtree; exit 0 ;;',
      '  *) exit 0 ;;',
      'esac',
      '',
    ].join('\n'));
    fs.chmodSync(fakeGit, 0o755);
    const helper = path.join(repoRoot, 'tools', 'HME', 'hooks', 'helpers', '_autocommit.sh');
    const script = [
      `source ${JSON.stringify(helper)}`,
      '_ac_queue_request stop.sh',
      '_ac_queue_request onRequest',
      '_ac_run_owner_once',
      'state="$PROJECT_ROOT/tools/HME/runtime"',
      'printf "counter=%s\\n" "$(cat "$state/autocommit.counter")"',
      'find "$state/autocommit.queue.d" -type f -name "*.req" -print -quit 2>/dev/null | grep -q . && echo queue_has_items=yes || echo queue_has_items=no',
      '[ -s "$state/autocommit.last-success" ] && echo last_success=yes || echo last_success=no',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], {
      cwd: sandbox,
      encoding: 'utf8',
      env: { ...process.env, PROJECT_ROOT: sandbox, PATH: `${path.join(sandbox, 'bin')}${path.delimiter}${process.env.PATH || ''}` },
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /counter=0/);
    assert.match(result.stdout, /queue_exists=no/);
    assert.match(result.stdout, /last_success=yes/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('_isBenignRace classifies concurrent-caller lock contention as benign (no LIFESAVER)', () => {
  const { _isBenignRace } = require(path.join(repoRoot, 'tools/HME/proxy/middleware/21_proxy_autocommit.js'));
  assert.equal(typeof _isBenignRace, 'function');
  // index.lock contention from a concurrent autocommit caller -- benign.
  assert.equal(_isBenignRace("fatal: Unable to create '/r/.git/index.lock': File exists."), true);
  assert.equal(_isBenignRace('Another git process seems to be running in this repository'), true);
  assert.equal(_isBenignRace('nothing to commit, working tree clean'), true);
  // A real failure (e.g. precommit rejection) is NOT benign -- must surface.
  assert.equal(_isBenignRace('ERROR: pre-commit validation blocked this commit'), false);
  assert.equal(_isBenignRace('error: failed to push some refs'), false);
  assert.equal(_isBenignRace(''), false);
});

test('proxy autocommit only logs helper-path failures; git failures belong to the helper owner', () => {
  const middleware = fs.readFileSync(path.join(repoRoot, 'tools/HME/proxy/middleware/21_proxy_autocommit.js'), 'utf8');
  assert.match(middleware, /_recordHelperFailure/);
  assert.match(middleware, /helper missing/);
  assert.doesNotMatch(middleware, /git status/);
  assert.doesNotMatch(middleware, /git commit/);
  assert.doesNotMatch(middleware, /git add/);
});

