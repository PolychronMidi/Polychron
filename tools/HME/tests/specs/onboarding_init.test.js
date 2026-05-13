'use strict';
// Regression: _onb_init re-arms each session; preserves only in-progress states.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ONB_HELPER = path.join(PROJECT_ROOT, 'tools', 'HME', 'hooks', 'helpers', '_onboarding.sh');

function _runInit(stateBefore) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-onb-'));
  const stateFile = path.join(tmpDir, 'tmp', 'hme-onboarding.state');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  if (stateBefore !== null) {
    fs.writeFileSync(stateFile, stateBefore);
  }
  const r = spawnSync('bash', [
    '-c',
    `source "${ONB_HELPER}"; _onb_init; cat "${stateFile}"`,
  ], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, PROJECT_ROOT: tmpDir },
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { stdout: r.stdout.trim(), stderr: r.stderr, status: r.status };
}

test('_onb_init: missing file writes boot', () => {
  const r = _runInit(null);
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.strictEqual(r.stdout, 'boot');
});

test('_onb_init: "graduated" file preserved (once graduated, stays graduated)', () => {
  const r = _runInit('graduated');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.strictEqual(r.stdout, 'graduated');
});

test('_onb_init: in-progress state "targeted" preserved', () => {
  const r = _runInit('targeted');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.strictEqual(r.stdout, 'targeted');
});

test('_onb_init: in-progress state "verified" preserved', () => {
  const r = _runInit('verified');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.strictEqual(r.stdout, 'verified');
});

test('_onb_init: unknown state resets to boot', () => {
  const r = _runInit('garbage_value');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.strictEqual(r.stdout, 'boot');
});
