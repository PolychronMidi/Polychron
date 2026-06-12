'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const _fs = require('node:fs');
const _path = require('node:path');
const { requireEnv } = require('../../proxy/shared/load_env');

const root = requireEnv('PROJECT_ROOT');

function loadJson(rel) {
  return JSON.parse(_fs.readFileSync(_path.join(root, rel), 'utf8'));
}

function exists(rel) {
  return _fs.existsSync(_path.join(root, rel));
}

function pathLike(value) {
  return typeof value === 'string'
    && /^tools\//.test(value)
    && !value.includes('*')
    && !/\s/.test(value);
}

function firstCommandPath(value) {
  if (Array.isArray(value)) return value[0];
  if (pathLike(value)) return value;
  return '';
}

test('services.json command paths resolve on disk', () => {
  const services = loadJson('tools/HME/config/services.json').services || [];
  const missing = [];
  for (const svc of services) {
    for (const field of ['start', 'fix']) {
      const rel = firstCommandPath(svc && svc[field]);
      if (rel && !exists(rel)) missing.push(`${svc.id}.${field}: ${rel}`);
    }
  }
  assert.deepEqual(missing, [], `services.json references missing command targets:\n${missing.join('\n')}`);
});

test('state-files.json owner/reader/writer/repair command paths resolve on disk', () => {
  const entries = loadJson('tools/HME/config/state-files.json').single_owner || [];
  const missing = [];
  entries.forEach((entry, idx) => {
    for (const field of ['owner', 'repair']) {
      const rel = firstCommandPath(entry && entry[field]);
      if (rel && !exists(rel)) missing.push(`#${idx}.${field}: ${rel}`);
    }
    for (const field of ['readers', 'writers']) {
      const values = Array.isArray(entry && entry[field]) ? entry[field] : [];
      for (const rel of values.filter(pathLike)) {
        if (!exists(rel)) missing.push(`#${idx}.${field}: ${rel}`);
      }
    }
  });
  assert.deepEqual(missing, [], `state-files.json references missing disk targets:\n${missing.join('\n')}`);
});
