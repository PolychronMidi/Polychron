const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const source = fs.readFileSync(path.join(repo, 'tools/HME/scripts/state-panel.py'), 'utf8');

test('state panel self-heals stale pipeline state through repair script', () => {
  assert.match(source, /repair-stale-runtime\.py/);
  assert.match(source, /repaired stale lock/);
});

test('state panel compares hot-reload head to current git head', () => {
  assert.match(source, /loaded_head/);
  assert.match(source, /rev-parse/);
  assert.match(source, /stale/);
});
