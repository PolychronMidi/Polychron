'use strict';
// Smoke tests for the canonical tool-invocation helper. Verifies the
// JSON config parses, the `i_form` shapes (default / primer / value=)
// each produce expected forms, and `action_form` covers the known
// hme-admin actions. Future renames of any wrapper should land in the
// JSON; the helper API is the contract everything else depends on.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function _py(snippet) {
  const r = spawnSync('python3', ['-c', snippet], {
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts'),
    },
    timeout: 10000,
  });
  if (r.status !== 0) {
    throw new Error(`python failed: ${r.stderr}`);
  }
  return r.stdout.trim();
}

test('i_form returns template form by default', () => {
  const out = _py(
    "from tool_invocations import i_form; print(i_form('status'))"
  );
  assert.match(out, /^i\/status mode=<MODE>$/);
});

test('i_form primer=True returns canonical example', () => {
  const out = _py(
    "from tool_invocations import i_form; print(i_form('status', primer=True))"
  );
  assert.match(out, /^i\/status mode=hme$/);
});

test('i_form value= substitutes the placeholder', () => {
  const out = _py(
    "from tool_invocations import i_form; print(i_form('status', value='signals'))"
  );
  assert.strictEqual(out, 'i/status mode=signals');
});

test('i_form value= on evolve substitutes <FOCUS>', () => {
  const out = _py(
    "from tool_invocations import i_form; print(i_form('evolve', value='design'))"
  );
  assert.strictEqual(out, 'i/evolve focus=design');
});

test('i_form value= on hme_admin substitutes <ACTION>', () => {
  const out = _py(
    "from tool_invocations import i_form; print(i_form('hme_admin', value='warm'))"
  );
  assert.strictEqual(out, 'i/hme-admin action=warm');
});

test('i_form unknown wrapper falls back gracefully', () => {
  const out = _py(
    "from tool_invocations import i_form; print(i_form('unknown_tool'))"
  );
  assert.strictEqual(out, 'i/unknown-tool');
});

test('i_form unknown wrapper with value= falls back to mode=', () => {
  const out = _py(
    "from tool_invocations import i_form; print(i_form('unknown_tool', value='x'))"
  );
  assert.strictEqual(out, 'i/unknown-tool mode=x');
});

test('action_form covers known hme-admin actions', () => {
  const out = _py(
    "from tool_invocations import action_form;"
    + " print(action_form('warm')); print(action_form('selftest'));"
    + " print(action_form('reload')); print(action_form('index'))"
  );
  const lines = out.split('\n');
  assert.strictEqual(lines[0], 'i/hme-admin action=warm');
  assert.strictEqual(lines[1], 'i/hme-admin action=selftest');
  assert.strictEqual(lines[2], 'i/hme-admin action=reload');
  assert.strictEqual(lines[3], 'i/hme-admin action=index');
});

test('action_form unknown action falls back consistently', () => {
  const out = _py(
    "from tool_invocations import action_form; print(action_form('made_up_action'))"
  );
  assert.strictEqual(out, 'i/hme-admin action=made_up_action');
});

test('all 8 wrappers covered by HardcodedToolInvocationVerifier have JSON entries', () => {
  // The verifier flags hardcoded `i/<wrapper> <key>=<value>` for these
  // 8 wrappers. Each must have a canonical entry so migrations can use
  // the helper instead of falling through to the default branch.
  const wrappers = ['hme_admin', 'status', 'evolve', 'review',
                    'why', 'learn', 'trace', 'read'];
  const out = _py(
    "from tool_invocations import _DATA;"
    + " import sys;"
    + " missing = [n for n in "
    + JSON.stringify(wrappers)
    + " if n not in _DATA.get('tools', {})];"
    + " print(','.join(missing) if missing else 'all-present')"
  );
  assert.strictEqual(out, 'all-present',
    `wrappers missing from tool-invocations.json: ${out}`);
});
