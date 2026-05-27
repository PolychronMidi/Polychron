'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const primer = path.join(repoRoot, 'tools', 'HME', 'hooks', 'pretooluse', 'pretooluse_hme_primer.sh');

function runPrimer() {
  return spawnSync('bash', [primer], {
    cwd: repoRoot,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: './tools/HME/i/status' } }),
    env: { ...process.env, PROJECT_ROOT: repoRoot, HME_PRIMER_REPEAT_WINDOW_SEC: '43200' },
    encoding: 'utf8',
  });
}

function save(file) {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function restore(file, value) {
  if (value === null) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, value);
}

test('HME primer hook emits compact context and suppresses restart duplicates', () => {
  const flag = path.join(repoRoot, 'tmp', 'hme-primer-needed.flag');
  const sent = path.join(repoRoot, 'tmp', 'hme-primer-emitted.ts');
  const oldFlag = save(flag);
  const oldSent = save(sent);
  try {
    fs.writeFileSync(flag, '');
    fs.rmSync(sent, { force: true });
    const first = runPrimer();
    assert.strictEqual(first.status, 0, first.stderr);
    assert.notStrictEqual(first.stdout, '', `empty primer stdout; stderr=${first.stderr}`);
    assert.ok(first.stdout.length < 900, `primer output too large: ${first.stdout.length}`);
    const payload = JSON.parse(first.stdout);
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.match(ctx, /HME PRIMER \(compact\)/);
    assert.match(ctx, /doc\/templates\/ONBOARDING\.md/);
    assert.doesNotMatch(ctx, /# Agent Primer|How the walkthrough works|Phase 1-6 HME infrastructure/);
    assert.strictEqual(Object.hasOwn(payload, 'systemMessage'), false);

    fs.writeFileSync(flag, '');
    const second = runPrimer();
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(second.stdout, '');
  } finally {
    restore(flag, oldFlag);
    restore(sent, oldSent);
  }
});
