'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require('../../policies/config');

// Tests use a sandboxed PROJECT_ROOT under /tmp so they don't touch the
// real .hme/ directory. Each test resets module-level cache afterwards.

function _withSandbox(fn) {
  return async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-config-test-'));
    const originalRoot = process.env.PROJECT_ROOT;
    const originalHome = os.homedir();
    process.env.PROJECT_ROOT = sandbox;
    // os.homedir is hard to stub; for this test we accept that the global
    // scope file may exist and just don't write to it. Tests focus on the
    // project + local scopes, which we control fully.
    try {
      delete require.cache[require.resolve('../../policies/config')];
      const cfg = require('../../policies/config');
      await fn(sandbox, cfg);
    } finally {
      // process.env.PROJECT_ROOT = undefined sets the literal string
      // 'undefined' — corrupts any later test that uses `||` fallback.
      // Delete the key when original was unset.
      if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalRoot;
      delete require.cache[require.resolve('../../policies/config')];
      try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    }
  };
}

function _writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

test('config: empty config defaults to defaultEnabled', _withSandbox(async (sandbox, cfg) => {
  cfg.reset();
  assert.strictEqual(cfg.isEnabled('foo', true), true);
  assert.strictEqual(cfg.isEnabled('foo', false), false);
}));

test('config: project file enables a policy', _withSandbox(async (sandbox, cfg) => {
  _writeJson(path.join(sandbox, '.hme', 'policies.json'), { enabled: ['foo'] });
  cfg.reset();
  assert.strictEqual(cfg.isEnabled('foo', false), true, 'enable list overrides defaultEnabled=false');
}));

test('config: project file disables a policy', _withSandbox(async (sandbox, cfg) => {
  _writeJson(path.join(sandbox, '.hme', 'policies.json'), { disabled: ['foo'] });
  cfg.reset();
  assert.strictEqual(cfg.isEnabled('foo', true), false, 'disable list overrides defaultEnabled=true');
}));

test('config: disable wins over enable when same name in both lists', _withSandbox(async (sandbox, cfg) => {
  _writeJson(path.join(sandbox, '.hme', 'policies.json'), { enabled: ['foo'], disabled: ['foo'] });
  cfg.reset();
  assert.strictEqual(cfg.isEnabled('foo', true), false, 'disable wins (defensive default for ambiguity)');
}));

test('config: local file overrides project file', _withSandbox(async (sandbox, cfg) => {
  _writeJson(path.join(sandbox, '.hme', 'policies.json'),       { enabled: ['shared'] });
  _writeJson(path.join(sandbox, '.hme', 'policies.local.json'), { disabled: ['shared'] });
  cfg.reset();
  // Both files merge by union; disable wins → effectively disabled.
  assert.strictEqual(cfg.isEnabled('shared', true), false);
}));

test('config: params first-defined-wins (project before local? local before project?)', _withSandbox(async (sandbox, cfg) => {
  // Lookup order: local → project → global. First-defined-wins.
  _writeJson(path.join(sandbox, '.hme', 'policies.local.json'), { params: { foo: { x: 'local-value' } } });
  _writeJson(path.join(sandbox, '.hme', 'policies.json'),       { params: { foo: { x: 'project-value' } } });
  cfg.reset();
  const p = cfg.paramsFor('foo', { x: 'default' });
  assert.strictEqual(p.x, 'local-value', 'local scope wins over project');
}));

test('config: params merge with defaults', _withSandbox(async (sandbox, cfg) => {
  _writeJson(path.join(sandbox, '.hme', 'policies.json'), { params: { foo: { override: 'set' } } });
  cfg.reset();
  const p = cfg.paramsFor('foo', { defaultKey: 'kept', override: 'default' });
  assert.strictEqual(p.defaultKey, 'kept');
  assert.strictEqual(p.override, 'set');
}));

test('config: malformed JSON in one file does not crash; other scopes still merge', _withSandbox(async (sandbox, cfg) => {
  fs.mkdirSync(path.join(sandbox, '.hme'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, '.hme', 'policies.json'), '{ not valid json');
  _writeJson(path.join(sandbox, '.hme', 'policies.local.json'), { enabled: ['foo'] });
  cfg.reset();
  // Malformed file is logged and skipped; local scope still applies.
  assert.strictEqual(cfg.isEnabled('foo', false), true);
}));

test('config: customPoliciesPath first-defined-wins', _withSandbox(async (sandbox, cfg) => {
  _writeJson(path.join(sandbox, '.hme', 'policies.local.json'), { customPoliciesPath: 'local/path' });
  _writeJson(path.join(sandbox, '.hme', 'policies.json'),       { customPoliciesPath: 'project/path' });
  cfg.reset();
  const c = cfg.get();
  assert.strictEqual(c.customPoliciesPath, 'local/path');
}));
