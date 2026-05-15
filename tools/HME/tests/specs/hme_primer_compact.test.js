'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const primer = path.join(repoRoot, 'tools', 'HME', 'hooks', 'pretooluse', 'pretooluse_hme_primer.sh');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-primer-test-'));
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools', 'HME'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

function runPrimer(root) {
  return spawnSync('bash', [primer], {
    cwd: repoRoot,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: './i/status' } }),
    env: { ...process.env, PROJECT_ROOT: root, HME_PRIMER_REPEAT_WINDOW_SEC: '43200' },
    encoding: 'utf8',
  });
}

test('HME primer hook emits compact context and suppresses restart duplicates', () => {
  const root = sandbox();
  try {
    fs.writeFileSync(path.join(root, 'tmp', 'hme-primer-needed.flag'), '');
    const first = runPrimer(root);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.notStrictEqual(first.stdout, '', `empty primer stdout; stderr=${first.stderr}`);
    assert.ok(first.stdout.length < 900, `primer output too large: ${first.stdout.length}`);
    const payload = JSON.parse(first.stdout);
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.match(ctx, /HME PRIMER \(compact\)/);
    assert.match(ctx, /doc\/templates\/ONBOARDING\.md/);
    assert.doesNotMatch(ctx, /# Agent Primer|How the walkthrough works|Phase 1-6 HME infrastructure/);
    assert.strictEqual(Object.hasOwn(payload, 'systemMessage'), false);

    fs.writeFileSync(path.join(root, 'tmp', 'hme-primer-needed.flag'), '');
    const second = runPrimer(root);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(second.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
