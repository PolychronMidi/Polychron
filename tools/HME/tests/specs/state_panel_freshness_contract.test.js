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

test('state panel omits obsolete hot-reload metric under dual-slot live-live runtime', () => {
  assert.doesNotMatch(source, /last hot-reload/);
  assert.doesNotMatch(source, /loaded_head/);
});
