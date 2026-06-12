'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../policies/registry');
const consoleWarnPolicy = require('../../policies/builtin/rewrite-console-warn-prefix');
const exceptPassPolicy = require('../../policies/builtin/rewrite-except-pass-silent-ok');

function _ctx(overrides = {}) {
  return {
    toolInput: {},
    deny: registry.deny, instruct: registry.instruct, allow: registry.allow, rewrite: registry.rewrite,
    ...overrides,
  };
}

test('rewrite-console-warn-prefix: prepends "Acceptable warning:" to bare console.warn', async () => {
  const content = "console.warn('something broke');\n";
  const r = await consoleWarnPolicy.fn(_ctx({ toolInput: { file_path: '/x.js', content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.updatedInput.content, /console\.warn\('Acceptable warning: something broke'\)/);
  assert.match(r.message, /DDoC stripped: console\.warn auto-prefixed/);
});

test('rewrite-console-warn-prefix: leaves already-prefixed warns alone', async () => {
  const content = "console.warn('Acceptable warning: known issue');\n";
  const r = await consoleWarnPolicy.fn(_ctx({ toolInput: { file_path: '/x.js', content } }));
  assert.strictEqual(r.decision, 'allow');
});

test('rewrite-console-warn-prefix: handles multiple bare warns', async () => {
  const content = "console.warn('a');\nconsole.warn('b');\n";
  const r = await consoleWarnPolicy.fn(_ctx({ toolInput: { file_path: '/x.js', content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.updatedInput.content, /Acceptable warning: a/);
  assert.match(r.updatedInput.content, /Acceptable warning: b/);
  assert.match(r.message, /2 calls/);
});

test('rewrite-console-warn-prefix: rewrites Edit new_string', async () => {
  const r = await consoleWarnPolicy.fn(_ctx({
    toolInput: { file_path: '/x.js', old_string: 'a', new_string: "console.warn('xyz');" },
  }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.updatedInput.new_string, /Acceptable warning: xyz/);
});

test('rewrite-console-warn-prefix: skips non-JS files', async () => {
  const r = await consoleWarnPolicy.fn(_ctx({
    toolInput: { file_path: '/x.md', content: "console.warn('text in markdown');" },
  }));
  assert.strictEqual(r.decision, 'allow');
});

test('rewrite-except-pass-silent-ok: appends silent-ok marker to naked except: pass', async () => {
  const content = "try:\n    x()\nexcept Exception:\n    pass\n";
  const r = await exceptPassPolicy.fn(_ctx({ toolInput: { file_path: '/x.py', content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.updatedInput.content, /pass\s+# silent-ok: pending review/);
  assert.match(r.message, /DDoC stripped: except\/pass auto-annotated/);
});

test('rewrite-except-pass-silent-ok: leaves already-annotated except alone', async () => {
  const content = "try:\n    x()\nexcept Exception:\n    pass  # silent-ok: legacy probe\n";
  const r = await exceptPassPolicy.fn(_ctx({ toolInput: { file_path: '/x.py', content } }));
  assert.strictEqual(r.decision, 'allow');
});

test('rewrite-except-pass-silent-ok: handles multiple blocks', async () => {
  const content = "try:\n    a()\nexcept:\n    pass\ntry:\n    b()\nexcept:\n    pass\n";
  const r = await exceptPassPolicy.fn(_ctx({ toolInput: { file_path: '/x.py', content } }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.message, /2 blocks/);
});

test('rewrite-except-pass-silent-ok: skips non-Python files', async () => {
  const r = await exceptPassPolicy.fn(_ctx({
    toolInput: { file_path: '/x.js', content: "try {} catch {}" },
  }));
  assert.strictEqual(r.decision, 'allow');
});

test('rewrite-except-pass-silent-ok: rewrites MultiEdit edits[]', async () => {
  const r = await exceptPassPolicy.fn(_ctx({
    toolInput: { file_path: '/x.py', edits: [{ old_string: 'a', new_string: 'except:\n    pass' }] },
  }));
  assert.strictEqual(r.decision, 'rewrite');
  assert.match(r.updatedInput.edits[0].new_string, /silent-ok: pending review/);
});
