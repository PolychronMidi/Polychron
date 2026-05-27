'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT,
  'tools/HME/config/hme-tool-descriptor.schema.json');
const REGISTRY = path.join(REPO_ROOT, 'tools/HME/proxy/hme_tool_registry');

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const REQUIRED = new Set(schema.required || []);
const PROPS = schema.properties || {};
const ALLOW_ADDITIONAL = schema.additionalProperties !== false;

const TYPE_CHECK = {
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number',
};

function describeMismatch(prefix, value, spec) {
  if (spec.type && !TYPE_CHECK[spec.type](value)) {
    return `${prefix}: expected ${spec.type}, got ${typeof value} (${JSON.stringify(value)})`;
  }
  if (spec.minLength !== undefined && typeof value === 'string' && value.length < spec.minLength) {
    return `${prefix}: string shorter than minLength ${spec.minLength}`;
  }
  return null;
}

function validate(descriptor) {
  const errors = [];
  const keys = new Set(Object.keys(descriptor));
  for (const required of REQUIRED) {
    if (!keys.has(required)) errors.push(`missing required key: ${required}`);
  }
  if (!ALLOW_ADDITIONAL) {
    for (const k of keys) {
      if (!(k in PROPS)) errors.push(`additional property not allowed: ${k}`);
    }
  }
  for (const [k, spec] of Object.entries(PROPS)) {
    if (!keys.has(k)) continue;
    const msg = describeMismatch(k, descriptor[k], spec);
    if (msg) errors.push(msg);
  }
  return errors;
}

test('canonicalLangChainTools() emits descriptors that conform to the schema', () => {
  const { canonicalLangChainTools } = require(REGISTRY);
  const tools = canonicalLangChainTools();
  assert.ok(Array.isArray(tools), 'canonicalLangChainTools must return an array');
  assert.ok(tools.length > 0, 'expected at least one canonical tool');
  for (let i = 0; i < tools.length; i++) {
    const errors = validate(tools[i]);
    assert.equal(errors.length, 0,
      `descriptor[${i}] (name=${tools[i] && tools[i].name}) violates schema:\n  ${errors.join('\n  ')}`);
  }
});

test('every descriptor name is non-empty and unique across the set', () => {
  const { canonicalLangChainTools } = require(REGISTRY);
  const tools = canonicalLangChainTools();
  const names = tools.map((t) => t && t.name).filter((n) => typeof n === 'string');
  assert.equal(names.length, tools.length, 'every tool must have a string name');
  for (const n of names) assert.ok(n.length > 0, `empty name detected`);
  const seen = new Set();
  for (const n of names) {
    assert.ok(!seen.has(n), `duplicate descriptor name: ${n}`);
    seen.add(n);
  }
});
