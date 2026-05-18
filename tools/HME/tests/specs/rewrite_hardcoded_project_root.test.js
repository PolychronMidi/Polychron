'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const registry = require('../../policies/registry');

const REPO_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
process.env.PROJECT_ROOT = REPO_ROOT;
delete require.cache[require.resolve('../../policies/builtin/rewrite-hardcoded-project-root')];
const policy = require('../../policies/builtin/rewrite-hardcoded-project-root');

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow, rewrite: registry.rewrite,
    ...overrides,
  };
}

test('rewrite-hardcoded-project-root: substitutes literal root in Write content', async () => {
  const content = `const ROOT = "${REPO_ROOT}/src/foo.js";\n`;
  const r = await policy.fn(_ctx({ toolInput: { file_path: `${REPO_ROOT}/src/x.js`, content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.equal(r.updatedInput.content, 'const ROOT = "$PROJECT_ROOT/src/foo.js";\n');
  assert.match(r.message, /DDoC stripped: hardcoded project root/);
});

test('rewrite-hardcoded-project-root: substitutes in Edit new_string', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { file_path: `${REPO_ROOT}/src/x.js`, old_string: 'a', new_string: `path = "${REPO_ROOT}/bin"` },
  }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.equal(r.updatedInput.new_string, 'path = "$PROJECT_ROOT/bin"');
});

test('rewrite-hardcoded-project-root: allows clean content', async () => {
  const r = await policy.fn(_ctx({ toolInput: { file_path: `${REPO_ROOT}/src/x.js`, content: 'const x = 1;\n' } }));
  assert.strictEqual(r.decision, 'allow');
});

test('rewrite-hardcoded-project-root: allows JSON config with PROJECT_ROOT field literal', async () => {
  const content = `{"PROJECT_ROOT": "${REPO_ROOT}"}`;
  const r = await policy.fn(_ctx({ toolInput: { file_path: `${REPO_ROOT}/config.json`, content } }));
  assert.strictEqual(r.decision, 'allow');
});

test('rewrite-hardcoded-project-root: exempts README.md', async () => {
  const r = await policy.fn(_ctx({
    toolInput: { file_path: `${REPO_ROOT}/README.md`, content: `path: ${REPO_ROOT}/foo` },
  }));
  assert.strictEqual(r.decision, 'allow');
});
