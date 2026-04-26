'use strict';
// Tests the manifest verifier's parsing + validation logic in isolation.
// The verifier itself does file-system walking; here we exercise the
// extraction helpers via spawn against synthetic fixture files.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const VERIFIER = path.resolve(__dirname, '../../../../scripts/pipeline/validators/check-module-manifests.js');
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function _runVerifier(env = {}) {
  // Run the verifier from the project root in a clean env. Returns
  // { code, stdout, stderr } even on non-zero exit.
  try {
    const out = execFileSync('node', [VERIFIER], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { code: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('check-module-manifests: clean tree passes', () => {
  // No manifests declared in the production tree yet (phase 1).
  const r = _runVerifier();
  assert.strictEqual(r.code, 0, `verifier exited ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /PASS/);
  assert.match(r.stdout, /0 manifest\(s\) validated/);
});

test('check-module-manifests: detects fixture with provides not in globals.d.ts', () => {
  // Drop a fixture file in src/ with a manifest whose provides is undeclared.
  // Pipeline-style verifiers walk src/ recursively, so any fixture we drop is
  // visible. We use a name guaranteed not to clash with real declarations.
  const fixtureName = '_test_manifest_fixture_undeclared.js';
  const fixturePath = path.join(PROJECT_ROOT, 'src', 'utils', fixtureName);
  fs.writeFileSync(fixturePath, `
'use strict';
// Test fixture: provides 'definitelyNotInGlobalsDtsXyz' which has no
// matching declare var in globals.d.ts.
moduleLifecycle.declare({
  name: 'definitelyNotInGlobalsDtsXyz',
  deps: [],
  provides: ['definitelyNotInGlobalsDtsXyz'],
  init: () => ({}),
});
`);
  try {
    const r = _runVerifier();
    assert.notStrictEqual(r.code, 0, 'verifier should fail on undeclared provides');
    assert.match(r.stderr + r.stdout, /declare var definitelyNotInGlobalsDtsXyz/);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('check-module-manifests: detects unknown subsystem', () => {
  const fixtureName = '_test_manifest_fixture_bad_subsystem.js';
  const fixturePath = path.join(PROJECT_ROOT, 'src', 'utils', fixtureName);
  // Use a real existing global name in `provides` so THAT check passes,
  // and only the subsystem check should fail.
  fs.writeFileSync(fixturePath, `
'use strict';
moduleLifecycle.declare({
  name: 'validator',
  deps: [],
  provides: ['validator'],
  subsystem: 'totally_made_up_subsystem',
  init: () => ({}),
});
`);
  try {
    const r = _runVerifier();
    assert.notStrictEqual(r.code, 0, 'verifier should fail on unknown subsystem');
    assert.match(r.stderr + r.stdout, /subsystem="totally_made_up_subsystem" not in known/);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('check-module-manifests: passes when manifest references real declared global', () => {
  // Use 'validator' which definitely has a declare var entry in globals.d.ts.
  // The fixture is structurally valid; the verifier should be silent on it.
  const fixtureName = '_test_manifest_fixture_valid.js';
  const fixturePath = path.join(PROJECT_ROOT, 'src', 'utils', fixtureName);
  fs.writeFileSync(fixturePath, `
'use strict';
moduleLifecycle.declare({
  name: 'validator',
  deps: [],
  provides: ['validator'],
  subsystem: 'utils',
  init: () => ({}),
});
`);
  try {
    const r = _runVerifier();
    assert.strictEqual(r.code, 0, `verifier should pass on valid fixture\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /1 manifest\(s\) validated/);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('check-module-manifests: skips moduleLifecycle.js itself', () => {
  // The registry impl file references `moduleLifecycle.declare(` in its own
  // comments and implementation. The verifier MUST skip it -- otherwise
  // every clean tree fails. Verify by counting manifests on the clean tree.
  const r = _runVerifier();
  // 0 manifests counted means the registry-impl skip is working AND no
  // production module has been migrated yet.
  assert.match(r.stdout, /0 manifest\(s\) validated/);
});

test('check-module-manifests: handles nested objects in manifest body', () => {
  // The brace-counting extraction must handle nested objects (e.g. compose:
  // { axis: 'parent' } in metaprofile-style manifests). Test fixture has
  // nested object inside the manifest -- verifier should still extract
  // the manifest as a whole and validate it.
  const fixtureName = '_test_manifest_fixture_nested.js';
  const fixturePath = path.join(PROJECT_ROOT, 'src', 'utils', fixtureName);
  fs.writeFileSync(fixturePath, `
'use strict';
moduleLifecycle.declare({
  name: 'validator',
  deps: [],
  provides: ['validator'],
  someNestedConfig: { foo: 'bar', deeper: { x: 1 } },
  init: () => ({}),
});
`);
  try {
    const r = _runVerifier();
    assert.strictEqual(r.code, 0, `verifier should pass on nested-object fixture\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /1 manifest\(s\) validated/);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});
