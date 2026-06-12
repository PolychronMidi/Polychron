'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

test('tracked HME runtime inventory doc is present', () => {
  const inventory = path.join(repoRoot, 'tools', 'HME', 'runtime', 'INVENTORY.md');
  assert.equal(fs.existsSync(inventory), true);
  const text = fs.readFileSync(inventory, 'utf8');
  assert.match(text, /durable inter-script state/);
  assert.match(text, /Genuinely-throwaway tmp/);
});
