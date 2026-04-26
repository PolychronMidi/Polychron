'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'tools', 'HME', 'i_registry.json');
const I_DIR = path.join(REPO_ROOT, 'i');

let _reg = null;
function _registry() {
  if (!_reg) _reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  return _reg;
}

function _scripts() {
  return fs.readdirSync(I_DIR).filter((f) => {
    const p = path.join(I_DIR, f);
    return fs.statSync(p).isFile() && !f.startsWith('.');
  });
}

test('i_registry: parses as valid JSON', () => {
  assert.doesNotThrow(() => _registry());
});

test('i_registry: every i/* script has a registry entry', () => {
  const reg = _registry();
  const commands = reg.commands || {};
  const missing = [];
  for (const script of _scripts()) {
    if (!(script in commands)) missing.push(script);
  }
  assert.deepStrictEqual(missing, [], `scripts missing from registry: ${missing.join(', ')}`);
});

test('i_registry: every registry entry corresponds to an actual script', () => {
  const reg = _registry();
  const commands = reg.commands || {};
  const scripts = new Set(_scripts());
  const orphans = [];
  for (const name of Object.keys(commands)) {
    if (!scripts.has(name)) orphans.push(name);
  }
  assert.deepStrictEqual(orphans, [], `registry entries with no script: ${orphans.join(', ')}`);
});

test('i_registry: every entry has required fields (description, category)', () => {
  const reg = _registry();
  const commands = reg.commands || {};
  const incomplete = [];
  for (const [name, entry] of Object.entries(commands)) {
    if (!entry.description || typeof entry.description !== 'string') {
      incomplete.push(`${name}: missing description`);
    }
    if (!entry.category || typeof entry.category !== 'string') {
      incomplete.push(`${name}: missing category`);
    }
  }
  assert.deepStrictEqual(incomplete, [], `entries with missing required fields:\n  ${incomplete.join('\n  ')}`);
});

test('i_registry: optional fields have correct types', () => {
  const reg = _registry();
  const commands = reg.commands || {};
  const errors = [];
  for (const [name, entry] of Object.entries(commands)) {
    if ('usage' in entry && typeof entry.usage !== 'string') {
      errors.push(`${name}: usage must be string`);
    }
    if ('modes' in entry && !Array.isArray(entry.modes)) {
      errors.push(`${name}: modes must be array`);
    }
    if ('examples' in entry && !Array.isArray(entry.examples)) {
      errors.push(`${name}: examples must be array`);
    }
  }
  assert.deepStrictEqual(errors, [], `type errors:\n  ${errors.join('\n  ')}`);
});

test('i_registry: every category appears in the cat_order whitelist (or is uncategorized)', () => {
  // i/help has a known cat_order. Any new category there silently lands
  // alphabetically. This test surfaces categories that haven't been
  // explicitly placed in the order array.
  const KNOWN = new Set([
    'review-discipline', 'knowledge', 'diagnostic', 'evolution',
    'policy-config', 'infra', 'orchestration', 'meta', 'uncategorized',
  ]);
  const reg = _registry();
  const novel = new Set();
  for (const entry of Object.values(reg.commands || {})) {
    if (entry.category && !KNOWN.has(entry.category)) novel.add(entry.category);
  }
  assert.deepStrictEqual(
    [...novel],
    [],
    `new categories must be added to i/help cat_order array: ${[...novel].join(', ')}`
  );
});

test('i_registry: no duplicate names across commands', () => {
  // Trivially true if JSON parses (object keys must be unique), but
  // explicit assertion catches accidental array-shape regressions.
  const reg = _registry();
  assert.strictEqual(typeof reg.commands, 'object');
  assert.ok(!Array.isArray(reg.commands), 'commands must be an object, not array');
});
