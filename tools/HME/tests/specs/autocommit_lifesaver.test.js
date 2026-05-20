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
