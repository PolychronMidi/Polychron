'use strict';
/**
 * Stop-chain policy coverage contract.
 *
 * stop_chain/index.js hand-maintains three lists in source:
 *   - POLICY_NAMES        (ordered chain)
 *   - MANDATORY_POLICIES  (fail-closed on load/throw)
 *   - STRICT_ONLY_POLICIES(run only in strict mode)
 *
 * Unlike the middleware pipeline (validateManifest) and the event-kernel
 * dispatcher (dispatcher-routes.json contract), nothing previously guaranteed
 * that every name in those lists resolves to a real policies/<name>.js, nor
 * that MANDATORY/STRICT_ONLY are subsets of the executable chain. A typo would
 * silently drop a policy (POLICY_NAMES) or, worse, point a fail-closed
 * mandatory tag at a non-existent module. This contract closes that gap by
 * diffing the declared lists against the policies/ directory on disk.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.resolve(__dirname, '..', '..', 'proxy', 'stop_chain', 'index.js');
const POLICIES_DIR = path.resolve(__dirname, '..', '..', 'proxy', 'stop_chain', 'policies');

function _arrayLiteral(src, varName) {
  const re = new RegExp(`const ${varName} = \\[([^\\]]*)\\]`, 'm');
  const m = re.exec(src);
  assert.ok(m, `${varName} array literal not found in stop_chain/index.js`);
  return m[1]
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function _setLiteral(src, varName) {
  const re = new RegExp(`const ${varName} = new Set\\(\\[([^\\]]*)\\]\\)`, 'm');
  const m = re.exec(src);
  assert.ok(m, `${varName} Set literal not found in stop_chain/index.js`);
  return m[1]
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const SRC = fs.readFileSync(INDEX, 'utf8');
const POLICY_NAMES = _arrayLiteral(SRC, 'POLICY_NAMES');
const MANDATORY = _setLiteral(SRC, 'MANDATORY_POLICIES');
const STRICT_ONLY = _setLiteral(SRC, 'STRICT_ONLY_POLICIES');

test('every POLICY_NAMES entry resolves to a policies/<name>.js module', () => {
  const missing = POLICY_NAMES.filter((name) => !fs.existsSync(path.join(POLICIES_DIR, `${name}.js`)));
  assert.deepEqual(missing, [], `POLICY_NAMES references non-existent policy module(s): ${missing.join(', ')}`);
});

test('every POLICY_NAMES entry loads and exports a run(ctx) function (except _preamble side-effect modules)', () => {
  const bad = [];
  for (const name of POLICY_NAMES) {
    const mod = require(path.join(POLICIES_DIR, `${name}.js`));
    if (typeof mod.run !== 'function') bad.push(name);
  }
  assert.deepEqual(bad, [], `policy module(s) missing run(ctx): ${bad.join(', ')}`);
});

test('MANDATORY_POLICIES is a subset of POLICY_NAMES (fail-closed tags point at real chain steps)', () => {
  const orphan = MANDATORY.filter((name) => !POLICY_NAMES.includes(name));
  assert.deepEqual(orphan, [], `MANDATORY_POLICIES contains name(s) absent from POLICY_NAMES: ${orphan.join(', ')}`);
});

test('STRICT_ONLY_POLICIES is a subset of POLICY_NAMES', () => {
  const orphan = STRICT_ONLY.filter((name) => !POLICY_NAMES.includes(name));
  assert.deepEqual(orphan, [], `STRICT_ONLY_POLICIES contains name(s) absent from POLICY_NAMES: ${orphan.join(', ')}`);
});

test('POLICY_NAMES has no duplicate entries', () => {
  const seen = new Set();
  const dups = [];
  for (const name of POLICY_NAMES) {
    if (seen.has(name)) dups.push(name);
    seen.add(name);
  }
  assert.deepEqual(dups, [], `POLICY_NAMES has duplicate(s): ${dups.join(', ')}`);
});
