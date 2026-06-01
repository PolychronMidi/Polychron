'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const helper = path.join(repoRoot, 'tools/HME/hooks/helpers/lifesaver_crying_wolf.py');

function sandbox(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-crying-wolf-'));
  fs.mkdirSync(path.join(root, 'log'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools/HME/runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'log/hme-errors.log'), `${lines.join('\n')}\n`);
  for (const file of ['errors-lastread', 'errors-turnstart']) {
    fs.writeFileSync(path.join(root, 'tools/HME/runtime', file), '0\n');
  }
  fs.writeFileSync(path.join(root, 'tmp/hme-errors.inline-watermark'), '0\n');
  return root;
}

function run(root, mode) {
  const result = spawnSync('python3', [helper, '--project-root', root, '--mode', mode, '--reason', 'test'], {
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

function marks(root) {
  return {
    lastread: fs.readFileSync(path.join(root, 'tools/HME/runtime/errors-lastread'), 'utf8').trim(),
    turnstart: fs.readFileSync(path.join(root, 'tools/HME/runtime/errors-turnstart'), 'utf8').trim(),
    inline: fs.readFileSync(path.join(root, 'tmp/hme-errors.inline-watermark'), 'utf8').trim(),
  };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('crying_wolf: self-only mode advances stale self-health observations', () => {
  const root = sandbox(['[2026-05-18T01:00:00Z] [universal_pulse] WARN doctor_health stale']);
  try {
    const out = run(root, 'self-only');
    assert.strictEqual(out.advanced, true);
    assert.deepStrictEqual(marks(root), { lastread: '1', turnstart: '1', inline: '1' });
    assert.ok(fs.existsSync(path.join(root, 'tools/HME/runtime/crying-wolf-reconciled.json')));
  } finally {
    cleanup(root);
  }
});

test('crying_wolf: self-only mode refuses agent-actionable lines', () => {
  const root = sandbox(['[2026-05-18T01:00:00Z] [foo] ImportError: missing dependency']);
  try {
    const out = run(root, 'self-only');
    assert.strictEqual(out.advanced, false);
    assert.strictEqual(out.unknown, 1);
    assert.deepStrictEqual(marks(root), { lastread: '0', turnstart: '0', inline: '0' });
  } finally {
    cleanup(root);
  }
});

test('crying_wolf: proxy restart mode advances known recovered upstream errors', () => {
  const root = sandbox([
    '[2026-05-18T01-41-15-579Z] UPSTREAM_400_INTERACTIVE: omniroute 400 invalid_request_error [interactive]: [400]: adaptive thinking is not supported on this model',
    '[2026-05-18T01:42:00Z] [universal_pulse] WARN hook latency cleared after restart',
  ]);
  try {
    const out = run(root, 'proxy-restart-success');
    assert.strictEqual(out.advanced, true);
    assert.strictEqual(out.pending, 2);
    assert.deepStrictEqual(marks(root), { lastread: '2', turnstart: '2', inline: '2' });
  } finally {
    cleanup(root);
  }
});

test('crying_wolf: proxy restart mode does not hide unrelated provider errors', () => {
  const root = sandbox([
    '[2026-05-18T01-14-26-329Z] UPSTREAM_400_INTERACTIVE: omniroute 400 invalid_request_error [interactive]: No credentials for provider: openrouter',
  ]);
  try {
    const out = run(root, 'proxy-restart-success');
    assert.strictEqual(out.advanced, false);
    assert.strictEqual(out.unknown, 1);
    assert.deepStrictEqual(marks(root), { lastread: '0', turnstart: '0', inline: '0' });
  } finally {
    cleanup(root);
  }
});
