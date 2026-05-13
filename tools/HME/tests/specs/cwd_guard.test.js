'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { projectHasOwnHooks, shouldSkipForNestedHooks } = require('../../hooks/cwd_guard');

test('cwd_guard: skips nested project with own event hook', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-root-'));
  const nested = path.join(root, 'nested', 'app');
  fs.mkdirSync(path.join(nested, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(nested, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{}] } }));
  assert.equal(projectHasOwnHooks('PreToolUse', nested, root), true);
  assert.equal(shouldSkipForNestedHooks('PreToolUse', JSON.stringify({ cwd: nested }), root), true);
});

test('cwd_guard: does not skip project root hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-root-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{}] } }));
  assert.equal(projectHasOwnHooks('PreToolUse', root, root), false);
});
